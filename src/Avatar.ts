import { ResourceManager } from "./resources/ResourceLoading";
import { GltfResource } from "./resources/Gltf";
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

                // Parse skeleton
                const skin = assertDefined((gltf.skins.length > 0) ? Skin.fromGltf(gltf, 0) : undefined);
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
                        model.bindSkeleton(new Skeleton(skin.bones), skin.inverseBindMatrices);
                        
                        model.material.setUniformBuffer(gfxDevice, 'uniforms', this.materialUniforms.getBuffer());
                        model.material.setUniformBuffer(gfxDevice, 'globalUniforms', globalUniforms.buffer);
                        this.models.push(model);
                    }
                }
            }
        });
    }

    update() {
    }

    render({ gfxDevice }: { gfxDevice: Gfx.Renderer }) {
        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];

            model.skeleton.evaluate();

            const boneFloats = this.materialUniforms.getFloatArray('u_bones');
            for (let i = 0; i < model.skeleton.bones.length; i++) {
                const bone = model.skeleton.bones[i];
                mat4.multiply(boneFloats.subarray(i * 16, i * 16 + 16), bone.model, model.ibms[i]);
            }
            this.materialUniforms.write(gfxDevice);

            model.renderList.push(model.primitive);
        }
    }
}