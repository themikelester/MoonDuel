import { GltfResource, GltfTechnique, GltfPrimitive } from "./resources/Gltf";
import { Model, Material, SkinnedModel } from "./Mesh";
import * as Gfx from './gfx/GfxTypes';
import { renderLists } from "./RenderList";

import { UniformBuffer, computePackedBufferLayout, BufferPackedLayout } from "./UniformBuffer";
import { vec4, mat4 } from "gl-matrix";
import { defaultValue, assertDefined, defined, assert } from "./util";
import { Skeleton, drawSkeleton } from "./Skeleton";
import { Object3D } from "./Object3D";
import { Camera } from "./Camera";
import { Avatar } from "./Avatar";
import { DebugMenu } from "./DebugMenu";
import { Environment } from "./Environment";

interface AvatarRenderData {
    models: Model[];
    skinnedModels: SkinnedModel[];
}

/**
 * Handle uniform updates and rendering for all avatars
 */
export class AvatarRender {
    private avatars: Avatar[];
    data: AvatarRenderData[] = [];

    drawSkeleton: boolean = false;

    initialize(avatars: Avatar[], debugMenu: DebugMenu) {
        this.avatars = avatars;
        for (let i = 0; i < avatars.length; i++) {
            this.data[i] = {
                models: [],
                skinnedModels: [],
            }
        }
        
        const debug = debugMenu.addFolder('Avatar');
        debug.add(this, 'drawSkeleton');
    }

    onResourcesLoaded(gltf: GltfResource, gfxDevice: Gfx.Renderer) {
        for (let avatarIdx = 0; avatarIdx < this.avatars.length; avatarIdx++) {
            const avatar = this.avatars[avatarIdx];

            // Load models
            for (let i = 0; i < avatar.nodes.length; i++) {
                const node = avatar.nodes[i];

                if (defined(node.skinId)) {
                    const meshId = assertDefined(node.meshId);
                    assert(node.skinId === 0);
                    this.loadSkinnedModel(gfxDevice, gltf, node, meshId, avatar.skeleton, avatarIdx);
                } else if (defined(node.meshId)) {
                    this.loadModel(gfxDevice, gltf, node, node.meshId, avatarIdx);
                }
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

            return resourceLayout;
        }

        const primMaterial = gltf.materials[prim.materialIndex!];
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
                } else if (uniform.type === Gfx.Type.Float) {
                    ubo.setFloat(name, value);
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

    loadSkinnedModel(gfxDevice: Gfx.Renderer, gltf: GltfResource, parent: Object3D, meshId: number, skeleton: Skeleton, avatarIdx: number) {
        const gltfMesh = gltf.meshes[meshId];

        for (let prim of gltfMesh.primitives) {
            const material = this.createMaterial(gfxDevice, prim, gltf);
            const model = new SkinnedModel(gfxDevice, renderLists.opaque, prim.mesh, material);
            model.bindSkeleton(gfxDevice, skeleton);
            material.setTexture(gfxDevice, 'u_jointTex', model.boneTex);
            this.data[avatarIdx].skinnedModels.push(model);
            parent.add(model);
        }
    }

    loadModel(gfxDevice: Gfx.Renderer, gltf: GltfResource, parent: Object3D, meshId: number, avatarIdx: number) {
        const gltfMesh = gltf.meshes[meshId];

        for (let prim of gltfMesh.primitives) {
            const material = this.createMaterial(gfxDevice, prim, gltf);
            const model = new Model(gfxDevice, renderLists.opaque, prim.mesh, material);
            this.data[avatarIdx].models.push(model);
            parent.add(model);
        }
    }

    render(gfxDevice: Gfx.Renderer, camera: Camera, env: Environment) {
        for (let avatarIdx = 0; avatarIdx < this.avatars.length; avatarIdx++) {
            if (!this.avatars[avatarIdx].isActive) continue;
            const data = this.data[avatarIdx];

            for (let i = 0; i < data.skinnedModels.length; i++) {
                const model = data.skinnedModels[i];
                const uniforms = model.material.getUniformBuffer('uniforms');
                
                model.writeBonesToTex(gfxDevice);

                const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;

                // @TODO: UniformBuffer.hasUniform()
                // @TODO: UniformBuffer.trySet()
                if (defined(uniforms.getBufferLayout()['u_modelViewProjection'])) {
                    uniforms.setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, matrixWorld));
                }

                if (defined(uniforms.getBufferLayout()['u_modelViewProjection'])) {
                    uniforms.setMat4('u_model', matrixWorld);
                }

                uniforms.setVec4('u_Color0', env.actorColor.ambient);
                uniforms.setVec4('u_KonstColor0', env.actorColor.diffuse);

                uniforms.write(gfxDevice);

                model.renderList.push(model.primitive);
            }

            for (let i = 0; i < data.models.length; i++) {
                const model = data.models[i];

                const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;

                const uniforms = model.material.getUniformBuffer('uniforms');
                uniforms.setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, matrixWorld));
                uniforms.setVec4('u_Color0', env.actorColor.ambient);
                uniforms.setVec4('u_KonstColor0', env.actorColor.diffuse);
                uniforms.write(gfxDevice);

                model.renderList.push(model.primitive);
            }

            // Debug
            if (this.drawSkeleton) {
                drawSkeleton(this.avatars[avatarIdx].skeleton);
                if (window.server) {
                    const serverSkeleton = window.server.avatar.avatars[avatarIdx].skeleton;
                    drawSkeleton(serverSkeleton, vec4.fromValues(1, 1, 0, 1));
                }
            }
        }
    }
}