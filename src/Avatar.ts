import { ResourceManager } from "./resources/ResourceLoading";
import { GltfResource, GltfAnimation, Sampler } from "./resources/Gltf";
import { Mesh, Model, Material, SkinnedModel } from "./Mesh";
import * as Gfx from './gfx/GfxTypes';
import { renderLists } from "./RenderList";
import { GlobalUniforms } from "./GlobalUniforms";

import skinnedVertSource from './shaders/skinned.vert';
import simpleVertSource from './shaders/simple.vert';
import frag_source from './shaders/simple.frag';
import { UniformBuffer, computePackedBufferLayout, BufferPackedLayout } from "./UniformBuffer";
import { vec4, vec3, mat4, quat } from "gl-matrix";
import { defaultValue, assert, assertDefined, defined } from "./util";
import { Skin, Skeleton } from "./Skeleton";
import { Object3D } from "./Object3D";
import { Clock } from "./Clock";
import { delerp, clamp } from "./MathHelpers";
import { Camera } from "./Camera";

const kMaxAvatarBoneCount = 32;

class AvatarShader implements Gfx.ShaderDescriptor {
    private static vert = skinnedVertSource;
    private static frag = frag_source;

    public static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
        u_color: { type: Gfx.Type.Float4 },
        u_bones: { type: Gfx.Type.Float4x4, count: kMaxAvatarBoneCount },
    });

    public static resourceLayout = {
        uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: AvatarShader.uniformLayout },
        globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    };

    name = 'AvatarShader';
    defines = `#define k_MaxBones ${kMaxAvatarBoneCount}\n`;
    vertSource = [this.defines, AvatarShader.vert.sourceCode];
    fragSource = AvatarShader.frag.sourceCode;
    id: Gfx.Id;
}

class ModelShader implements Gfx.ShaderDescriptor {
    private static vert = simpleVertSource;
    private static frag = frag_source;

    public static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
        u_color: { type: Gfx.Type.Float4 },
        u_model: { type: Gfx.Type.Float4x4 },
    });

    public static resourceLayout = {
        uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: ModelShader.uniformLayout },
        globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    };

    name = 'ModelShader';
    vertSource = ModelShader.vert.sourceCode;
    fragSource = ModelShader.frag.sourceCode;
    id: Gfx.Id;
}

export class AvatarManager {
    gfxDevice: Gfx.Renderer;
    globalUniforms: GlobalUniforms;

    shader: Gfx.Id;
    modelShader: Gfx.Id;

    skinnedUniforms: UniformBuffer;
    modelUniforms: UniformBuffer[] = [];
    models: Model[] = [];
    skinnedModels: SkinnedModel[] = [];
    skin: Skin;

    rootNodes: Object3D[];
    animations: GltfAnimation[] = [];

    initialize({ gfxDevice, resources, globalUniforms }: { gfxDevice: Gfx.Renderer, resources: ResourceManager, globalUniforms: GlobalUniforms }) {
        this.gfxDevice = gfxDevice;
        this.globalUniforms = globalUniforms;

        this.shader = gfxDevice.createShader(new AvatarShader());
        this.modelShader = gfxDevice.createShader(new ModelShader());

        // @TODO: UniformBuffer should support x instances 
        this.skinnedUniforms = new UniformBuffer('AvatarMaterial', gfxDevice, AvatarShader.uniformLayout);

        resources.load('data/Avatar.glb', 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }

            const gltf = resource as GltfResource;

            // @HACK:
            this.animations = gltf.animations;

            this.rootNodes = gltf.rootNodeIds.map(nodeId => this.loadNode(gltf, nodeId));
            this.rootNodes.forEach(node => {
                node.updateMatrix();
                node.updateMatrixWorld(false, true);
            });
        });
    }

    loadSkinnedModel(gltf: GltfResource, meshId: number, skinId: number): Object3D {
        const gltfMesh = gltf.meshes[meshId];
        const skin = gltf.skins[skinId];
        const obj = new Object3D();

        for (let prim of gltfMesh.primitives) {
            const mesh = new Mesh({
                vertexLayout: prim.vertexLayout,
                vertexBuffers: prim.vertexBuffers.map(buf => buf.id),
                elementCount: prim.elementCount,
                indexBuffer: prim.indexBuffer ? prim.indexBuffer.id : undefined,
                indexType: prim.indexType,
                primitiveType: prim.type,
            });

            const technique = assertDefined(prim.material.technique);
            const values = defaultValue(prim.material.values, []);

            // Split textures from uniforms
            const uniforms: BufferPackedLayout = {};
            const textures: string[] = [];
            for (const name of Object.keys(technique.uniforms)) {
                const uni = technique.uniforms[name];
                if (uni.type === Gfx.Type.Texture2D) { textures.push(name); }
                else { uniforms[name] = uni; }
            }

            // Build a resource layout based on the required uniform
            const uniformLayout: Gfx.BufferLayout = computePackedBufferLayout(uniforms);
            const resourceLayout: Gfx.ShaderResourceLayout = {
                uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: uniformLayout }
            };
            for (let i = 0; i < textures.length; i++) { 
                const texName = textures[i];
                resourceLayout[texName] = { index: i, type: Gfx.BindingType.Texture };
            }

            const material = new Material(this.gfxDevice, prim.material.name, technique.shader.id, resourceLayout);
            const model = new Model(this.gfxDevice, renderLists.opaque, mesh, material);

            // Set static uniforms from the values provided in the GLTF material
            const ubo = new UniformBuffer(prim.material.name, this.gfxDevice, uniformLayout);
            for (const name of Object.keys(uniforms)) {
                if (defined(values[name])) { ubo.setFloats(name, values[name]); }
            }
            ubo.write(this.gfxDevice);


            model.material.setUniformBuffer(this.gfxDevice, 'uniforms', ubo);
            for (const texName of textures) {
                const texId = gltf.textures[prim.material.values![texName].index].id;
                model.material.setTexture(this.gfxDevice, texName, texId);
            }

            this.modelUniforms.push(ubo);
            this.models.push(model);
            obj.add(model);
        }

        return obj;
    }

    loadModel(gltf: GltfResource, meshId: number): Object3D {
        const gltfMesh = gltf.meshes[meshId];
        const obj = new Object3D();

        for (let prim of gltfMesh.primitives) {
            const mesh = new Mesh({
                vertexLayout: prim.vertexLayout,
                vertexBuffers: prim.vertexBuffers.map(buf => buf.id),
                elementCount: prim.elementCount,
                indexBuffer: prim.indexBuffer ? prim.indexBuffer.id : undefined,
                indexType: prim.indexType,
                primitiveType: prim.type,
            });

            const technique = assertDefined(prim.material.technique);
            const values = defaultValue(prim.material.values, []);

            // Split textures from uniforms
            // @TODO: This in the GLTF loader
            const uniforms: BufferPackedLayout = {};
            const textures: string[] = [];
            for (const name of Object.keys(technique.uniforms)) {
                const uni = technique.uniforms[name];
                if (uni.type === Gfx.Type.Texture2D) { textures.push(name); }
                else { uniforms[name] = uni; }
            }

            // Build a resource layout based on the required uniform
            const uniformLayout: Gfx.BufferLayout = computePackedBufferLayout(uniforms);
            const resourceLayout: Gfx.ShaderResourceLayout = {
                uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: uniformLayout }
            };
            for (let i = 0; i < textures.length; i++) { 
                const texName = textures[i];
                resourceLayout[texName] = { index: i, type: Gfx.BindingType.Texture };
            }

            const material = new Material(this.gfxDevice, prim.material.name, technique.shader.id, resourceLayout);
            const model = new Model(this.gfxDevice, renderLists.opaque, mesh, material);

            // Set static uniforms from the values provided in the GLTF material
            const ubo = new UniformBuffer(prim.material.name, this.gfxDevice, uniformLayout);
            for (const name of Object.keys(uniforms)) {
                if (defined(values[name])) { ubo.setFloats(name, values[name]); }
            }
            ubo.write(this.gfxDevice);

            // Bind the uniform buffers and textures to the material
            model.material.setUniformBuffer(this.gfxDevice, 'uniforms', ubo);
            for (const texName of textures) {
                const texId = gltf.textures[prim.material.values![texName].index].id;
                model.material.setTexture(this.gfxDevice, texName, texId);
            }
            this.modelUniforms.push(ubo);
            
            this.models.push(model);
            obj.add(model);
        }

        return obj;
    }

    loadNode(gltf: GltfResource, nodeId: number): Object3D {
        const node = gltf.nodes[nodeId];
        let obj: Object3D;

        if (defined(node.skinId)) {
            const meshId = assertDefined(node.meshId);
            obj = this.loadSkinnedModel(gltf, meshId, node.skinId);
        } else if (defined(node.meshId)) {
            obj = this.loadModel(gltf, node.meshId);
        } else {
            obj = new Object3D();
        }

        obj.name = defaultValue(node.name, `Node${nodeId}`);
        vec3.copy(obj.position, node.translation);
        quat.copy(obj.rotation, node.rotation);
        vec3.copy(obj.scale, node.scale);
        obj.updateMatrix();

        if (node.children) {
            for (const childId of node.children) {
                const childObj = this.loadNode(gltf, childId);
                childObj.parent = obj;
                obj.add(childObj);
            }
        }

        return obj;
    }

    update({ clock }: { clock: Clock }) {
        const anim = this.animations[0];
        if (anim) {
            const t = (clock.time / 1000.0) % anim.maxTime;

            for (let i = 0; i < anim.rotations.length; i++) {
                const data = anim.rotations[i];
                const bone = assertDefined(this.skinnedModels[0].skeleton.bones.find(b => b.nodeId === data.nodeId));
                evalRotation(t, data, bone.rotation);
            }

            for (let i = 0; i < anim.translations.length; i++) {
                const data = anim.translations[i];
                const bone = assertDefined(this.skinnedModels[0].skeleton.bones.find(b => b.nodeId === data.nodeId));
                evalTranslation(t, data, bone.position);
            }

            for (let i = 0; i < anim.scales.length; i++) {
                const data = anim.scales[i];
                const bone = assertDefined(this.skinnedModels[0].skeleton.bones.find(b => b.nodeId === data.nodeId));
                evalTranslation(t, data, bone.scale);
            }
        }
    }

    render({ gfxDevice, camera }: { gfxDevice: Gfx.Renderer, camera: Camera }) {
        for (let i = 0; i < this.skinnedModels.length; i++) {
            const model = this.skinnedModels[i];

            model.updateMatrixWorld(true, true);
            model.skeleton.evaluate(model.matrixWorld);

            const boneFloats = this.skinnedUniforms.getFloatArray('u_bones');
            model.skeleton.writeToBuffer(boneFloats);
            this.skinnedUniforms.write(gfxDevice);

            model.renderList.push(model.primitive);
        }

        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];

            model.updateMatrixWorld(true, true);

            this.modelUniforms[i].setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, model.matrixWorld));
            this.modelUniforms[i].write(gfxDevice);

            model.renderList.push(model.primitive);
        }
    }
}

function evalRotation(time: number, sampler: Sampler, result: quat): quat {
    const keyCount = sampler.times.length;
    let t = 1.0;
    let a = keyCount - 1;
    let b = keyCount - 1;

    // Clamp time to our animation min and max, to avoid NaNs
    time = clamp(time, sampler.times[0], sampler.times[keyCount - 1]);

    // Naive linear search for frame on either side of time
    for (let i = 0; i < keyCount; i++) {
        const t1 = sampler.times[i];
        if (t1 > time) {
            const t0 = sampler.times[Math.max(i - 1, 0)];
            t = delerp(t0, t1, time);
            b = i;
            a = Math.max(i - 1, 0);
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
    let a = keyCount - 1;
    let b = keyCount - 1;

    time = clamp(time, sampler.times[0], sampler.times[keyCount - 1]);

    // Naive linear search for frame on either side of time
    for (let i = 1; i < keyCount; i++) {
        const t1 = sampler.times[i];
        if (t1 > time) {
            const t0 = sampler.times[Math.max(i - 1, 0)];
            t = delerp(t0, t1, time);
            b = i;
            a = Math.max(i - 1, 0);
            break;
        }
    }

    let va = sampler.values.subarray(a * 3, a * 3 + 3) as vec3;
    let vb = sampler.values.subarray(b * 3, b * 3 + 3) as vec3;
    const r = vec3.lerp(result, va, vb, t);
    return r;
}
