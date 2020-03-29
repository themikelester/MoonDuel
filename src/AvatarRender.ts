import { ResourceManager } from "./resources/ResourceLoading";
import { GltfResource, GltfTechnique, GltfPrimitive } from "./resources/Gltf";
import { Model, Material, SkinnedModel } from "./Mesh";
import * as Gfx from './gfx/GfxTypes';
import { renderLists } from "./RenderList";

import { UniformBuffer, computePackedBufferLayout, BufferPackedLayout } from "./UniformBuffer";
import { vec4, mat4 } from "gl-matrix";
import { defaultValue, assertDefined, defined, assert } from "./util";
import { Skeleton, Bone } from "./Skeleton";
import { Object3D, Matrix4 } from "./Object3D";
import { Clock } from "./Clock";
import { Camera } from "./Camera";
import { AnimationMixer, AnimationClip } from "./resources/Animation";
import { Avatar } from "./Avatar";

export class AvatarRender {
    private avatars: Avatar[];
    private models: Model[] = [];
    private skinnedModels: SkinnedModel[] = [];

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
    }

    onResourcesLoaded(gltf: GltfResource, { gfxDevice }: { gfxDevice: Gfx.Renderer}) {
        // Load models
        for (let i = 0; i < gltf.nodes.length; i++) {
            const node = gltf.nodes[i];

            if (defined(node.skinId)) {
                const meshId = assertDefined(node.meshId);
                this.loadSkinnedModel(gfxDevice, gltf, node, meshId, node.skinId);
            } else if (defined(node.meshId)) {
                this.loadModel(gfxDevice, gltf, node, node.meshId);
            }
        }
    }

    createMaterial(gfxDevice: Gfx.Renderer, prim: GltfPrimitive, gltf: GltfResource) {
        function buildResourceLayout(technique: GltfTechnique): Gfx.ShaderResourceLayout {
            // Split textures from uniforms
            const uniforms: BufferPackedLayout = {};
            const textures: string[] = [];
            for (const name of Object.keys(technique.uniforms)) {
                const uni = technique.uniforms[name];
                if (uni.type === Gfx.Type.Texture2D) { textures.push(name); }
                else { uniforms[name] = uni; }
            }

            // Build a resource layout based on the required uniforms
            const uniformLayout: Gfx.BufferLayout = computePackedBufferLayout(uniforms);
            const resourceLayout: Gfx.ShaderResourceLayout = {
                uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: uniformLayout }
            };
            for (let i = 0; i < textures.length; i++) { 
                const texName = textures[i];
                resourceLayout[texName] = { index: i, type: Gfx.BindingType.Texture };
            }
            
            return  resourceLayout;
        }

        const primMaterial = gltf.materials[prim.materialIndex];
        const technique = assertDefined(primMaterial.technique);

        const shader = technique.shaderId;
        const resourceLayout = buildResourceLayout(technique);
        const material = new Material(gfxDevice, primMaterial.name, shader, resourceLayout);

        // Bind resources to the material
        const uniformLayout = (resourceLayout.uniforms as Gfx.UniformBufferResourceBinding).layout;
        const ubo = new UniformBuffer(primMaterial.name, gfxDevice, uniformLayout);
        material.setUniformBuffer(gfxDevice, 'uniforms', ubo);

        if (technique) {
            const values = assertDefined(primMaterial.values);

            // Set static uniforms from the values provided in the GLTF material
            for (const name of Object.keys(technique.uniforms)) {
                const uniform = technique.uniforms[name];
                const value = defaultValue(values[name], uniform.value);
                if (!defined(value)) continue;

                if (uniform.type === Gfx.Type.Texture2D) {
                    const texId = gltf.textures[value.index].id;
                    material.setTexture(gfxDevice, name, texId);
                } else { 
                    ubo.setFloats(name, value);
                }
            }

            // @HACK:
            ubo.setVec4('u_Color0', vec4.fromValues(0.4266, 0.4171, 0.5057, 1));
        } else {
            ubo.setVec4('u_color', vec4.fromValues(0, 1, 0, 1));
        }

        return material;
    }

    loadSkinnedModel(gfxDevice: Gfx.Renderer, gltf: GltfResource, parent: Object3D, meshId: number, skinId: number) {
        const gltfMesh = gltf.meshes[meshId];
        assert(skinId === 0);

        for (let prim of gltfMesh.primitives) {
            const material = this.createMaterial(gfxDevice, prim, gltf);
            const model = new SkinnedModel(gfxDevice, renderLists.opaque, prim.mesh, material);
            model.bindSkeleton(this.avatars[0].skeleton); // @TODO
            this.skinnedModels.push(model);
            parent.add(model);
        }
    }

    loadModel(gfxDevice: Gfx.Renderer, gltf: GltfResource, parent: Object3D, meshId: number) {
        const gltfMesh = gltf.meshes[meshId];

        for (let prim of gltfMesh.primitives) {
            const material = this.createMaterial(gfxDevice, prim, gltf);
            const model = new Model(gfxDevice, renderLists.opaque, prim.mesh, material);
            this.models.push(model);
            parent.add(model);
        }
    }
    
    render({ gfxDevice, camera }: { gfxDevice: Gfx.Renderer, camera: Camera }) {
        for (let i = 0; i < this.skinnedModels.length; i++) {
            const model = this.skinnedModels[i];
            const uniforms = model.material.getUniformBuffer('uniforms');

            const boneFloats = uniforms.getFloatArray('u_joints');
            boneFloats.set(model.skeleton.boneMatrices);

            const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;
            
            // @TODO: UniformBuffer.hasUniform()
            // @TODO: UniformBuffer.trySet()
            if (defined(uniforms.getBufferLayout()['u_modelViewProjection'])) {
                uniforms.setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, matrixWorld));
            } 

            if (defined(uniforms.getBufferLayout()['u_modelViewProjection'])) {
                uniforms.setMat4('u_model', matrixWorld);
            }      

            uniforms.write(gfxDevice);

            model.renderList.push(model.primitive);
        }

        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];

            const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;

            const uniforms = model.material.getUniformBuffer('uniforms');
            uniforms.setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, matrixWorld));
            uniforms.write(gfxDevice);

            model.renderList.push(model.primitive);
        }
    }
}