import { ResourceManager } from "./resources/ResourceLoading";
import { GltfResource, GltfAnimation, Sampler } from "./resources/Gltf";
import { Mesh, Model, Material, SkinnedModel } from "./Mesh";
import * as Gfx from './gfx/GfxTypes';
import { renderLists } from "./RenderList";
import { GlobalUniforms } from "./GlobalUniforms";

import vert_source from './shaders/skinned.vert';
import frag_source from './shaders/simple.frag';
import { UniformBuffer, computePackedBufferLayout } from "./UniformBuffer";
import { vec4, vec3, mat4, quat } from "gl-matrix";
import { defaultValue, assert, assertDefined } from "./util";
import { Skin, Skeleton } from "./Skeleton";

const kAvatarBoneCount = 19;

class AvatarShader implements Gfx.ShaderDescriptor {
    private static vert = vert_source;
    private static frag = frag_source;
    
    public static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
        u_color: { type: Gfx.Type.Float4 },
        u_bones: { type: Gfx.Type.Float4x4, count: kAvatarBoneCount },
    });

    public static resourceLayout = {
        uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: AvatarShader.uniformLayout },
        globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    };

    name = 'AvatarShader';
    defines = `#define k_MaxBones ${kAvatarBoneCount}\n`;
    vertSource = [this.defines, AvatarShader.vert.sourceCode];
    fragSource = AvatarShader.frag.sourceCode;
    resourceLayout = AvatarShader.resourceLayout;
    id: Gfx.Id;
}
export class AvatarManager {
    shader: Gfx.Id;
    materialUniforms: UniformBuffer;
    models: SkinnedModel[] = [];
    skin: Skin;

    animations: GltfAnimation[] = [];

    initialize({ gfxDevice, resources, globalUniforms }: { gfxDevice: Gfx.Renderer, resources: ResourceManager, globalUniforms: GlobalUniforms }) {
        this.shader = gfxDevice.createShader(new AvatarShader());

        // @TODO: UniformBuffer should support x instances 
        this.materialUniforms = new UniformBuffer('AvatarMaterial', gfxDevice, AvatarShader.uniformLayout);
        this.materialUniforms.setVec4('u_color', vec4.fromValues(0, 1, 0, 1));
        this.materialUniforms.write(gfxDevice);
        
        resources.load('data/CesiumMan.glb', 'gltf', (error, resource) => {
            if (error) { console.error(`Failed to load resource`, error); }
            else {
                const gltf = resource as GltfResource;

                // @HACK:
                this.animations = gltf.animations;

                // Parse skeleton
                const skin = assertDefined((gltf.skins.length > 0) ? Skin.fromGltf(gltf, 0) : undefined);
                this.skin = skin;
                assert(skin.bones.length === kAvatarBoneCount);

                for (let gltfMesh of gltf.meshes) {
                    for (let prim of gltfMesh.primitives) {
                        const mesh = new Mesh({
                            vertexLayout: prim.vertexLayout,
                            vertexBuffers: prim.vertexBuffers.map(buf => buf.id),
                            elementCount: prim.elementCount,
                            indexBuffer: prim.indexBuffer ? prim.indexBuffer.id : undefined,
                            indexType: prim.indexType,
                            primitiveType: prim.type,
                        });

                        const material = new Material(gfxDevice, this.shader);
                        const model = new SkinnedModel(gfxDevice, renderLists.opaque, mesh, material);
                        model.bindSkeleton(new Skeleton(skin), skin.inverseBindMatrices);
                        
                        model.material.setUniformBuffer(gfxDevice, 'uniforms', this.materialUniforms.getBuffer());
                        model.material.setUniformBuffer(gfxDevice, 'globalUniforms', globalUniforms.buffer);
                        this.models.push(model);
                    }
                }
            }
        });
    }

    update({ realTime }: { realTime: number }) {
        const anim = this.animations[0];
        if (anim) {
            const t = (realTime / 1000.0) % anim.maxTime;
    
            for (let i = 0; i < anim.rotations.length; i++) {
                const data = anim.rotations[i];
                const bone = assertDefined(this.models[0].skeleton.bones.find(b => b.nodeId === data.nodeId));
                evalRotation(t, data, bone.rotation);
            }
    
            for (let i = 0; i < anim.translations.length; i++) {
                const data = anim.translations[i];
                const bone = assertDefined(this.models[0].skeleton.bones.find(b => b.nodeId === data.nodeId));
                evalTranslation(t, data, bone.position);
            }
    
            for (let i = 0; i < anim.scales.length; i++) {
                const data = anim.scales[i];
                const bone = assertDefined(this.models[0].skeleton.bones.find(b => b.nodeId === data.nodeId));
                evalTranslation(t, data, bone.scale);
            }
        }
    }

    render({ gfxDevice }: { gfxDevice: Gfx.Renderer }) {
        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];

            // const headJoint = assertDefined(model.skeleton.bones.find(b => b.name === 'Skeleton_arm_joint_L__4_'));
            // headJoint.rotation = quat.rotateX(headJoint.rotation, headJoint.rotation, Math.PI * 0.01);

            model.skeleton.evaluate();

            const boneFloats = this.materialUniforms.getFloatArray('u_bones');
            model.skeleton.writeToBuffer(boneFloats);
            this.materialUniforms.write(gfxDevice);

            model.renderList.push(model.primitive);
        }
    }
}

function evalRotation(time: number, sampler: Sampler, result: quat): quat {
    const keyCount = sampler.times.length;
    let t = 1.0;
    let a = keyCount-1;
    let b = keyCount-1;
  
    // Naive linear search for frame on either side of time
    for (let i = 0; i < keyCount; i++) {
      const t1 = sampler.times[i];
      if (t1 > time) {
        const t0 = sampler.times[Math.max(i-1, 0)];
        t = time - t0;
        b = i;
        a = Math.max(i-1, 0);
        break;
      }
    }  
  
    let va = sampler.values.subarray(a * 4, a * 4 + 4) as quat;
    let vb = sampler.values.subarray(b * 4, b * 4 + 4) as quat;
    const r = quat.lerp(result, va, vb, t);
    return r;
  }
  
  function evalTranslation(time: number, sampler: Sampler, result: vec3): vec3 {
    const keyCount = sampler.times.length;
    let t = 1.0;
    let a = keyCount-1;
    let b = keyCount-1;
  
    // Naive linear search for frame on either side of time
    for (let i = 0; i < keyCount; i++) {
      const t1 = sampler.times[i];
      if (t1 > time) {
        const t0 = sampler.times[Math.max(i-1, 0)];
        t = time - t0;
        b = i;
        a = Math.max(i-1, 0);
        break;
      }
    }  
  
    let va = sampler.values.subarray(a * 3, a * 3 + 3) as vec3;
    let vb = sampler.values.subarray(b * 3, b * 3 + 3) as vec3;
    const r = vec3.lerp(result, va, vb, t);
    return r;
  }
  