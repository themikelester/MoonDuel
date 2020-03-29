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

export class AvatarRender {
    public animationMixer: AnimationMixer;
    public animations: AnimationClip[] = [];
    public skeleton: Skeleton;

    private models: Model[] = [];
    private skinnedModels: SkinnedModel[] = [];

    private nodes: Object3D[] | Bone[];
    private rootNodes: Object3D[] = [];

    initialize({ gfxDevice, resources }: { gfxDevice: Gfx.Renderer, resources: ResourceManager }) {
        resources.load('data/Tn.glb', 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }

            const gltf = resource as GltfResource;

            // Create Object3Ds for each node
            this.nodes = gltf.nodes;

            // Create skeletons for the first GLTF skin
            this.skeleton = (skin => {
                const bones = skin.joints.map(jointId => this.nodes[jointId]);
                const ibms = skin.inverseBindMatrices?.map(ibm => { const m = new Matrix4(); m.elements = Array.from(ibm); return m; });
                return new Skeleton(bones as Bone[], ibms);
            })(gltf.skins[0]);

            // Load models
            for (let i = 0; i < gltf.nodes.length; i++) {
                const src = gltf.nodes[i];
                const node = this.nodes[i];

                if (defined(src.skinId)) {
                    const meshId = assertDefined(src.meshId);
                    this.loadSkinnedModel(gfxDevice, gltf, node, meshId, src.skinId);
                } else if (defined(src.meshId)) {
                    this.loadModel(gfxDevice, gltf, node, src.meshId);
                }
            }

            this.rootNodes = gltf.rootNodeIds.map(nodeId => this.nodes[nodeId]);

            this.rootNodes.forEach(node => {
                node.updateMatrix();
                node.updateMatrixWorld();
            });

            this.animationMixer = new AnimationMixer(this.rootNodes[0]);
            this.animations = gltf.animations;

            // @HACK:
            const clip = assertDefined(this.animations[12]);
            const action = this.animationMixer.clipAction(clip);
            action.play()
        });
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
            model.bindSkeleton(this.skeleton);
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
    
    update({ clock }: { clock: Clock }) {
        if (this.animationMixer) {
            this.animationMixer.update(clock.dt / 1000.0);
        }
    }

    render({ gfxDevice, camera }: { gfxDevice: Gfx.Renderer, camera: Camera }) {
        for (const node of this.rootNodes) {
            node.updateMatrixWorld();
        }

        for (let i = 0; i < this.skinnedModels.length; i++) {
            const model = this.skinnedModels[i];
            const uniforms = model.material.getUniformBuffer('uniforms');

            model.updateMatrixWorld();
            const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;

            model.skeleton.update();

            const boneFloats = uniforms.getFloatArray('u_joints');
            boneFloats.set(model.skeleton.boneMatrices);
            
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

            model.updateMatrixWorld();
            const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;

            const uniforms = model.material.getUniformBuffer('uniforms');
            uniforms.setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, matrixWorld));
            uniforms.write(gfxDevice);

            model.renderList.push(model.primitive);
        }
    }
}