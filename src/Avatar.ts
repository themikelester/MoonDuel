import { ResourceManager } from "./resources/ResourceLoading";
import { GltfResource, GltfAnimation, Sampler, GltfTechnique, GltfPrimitive } from "./resources/Gltf";
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
import { Skeleton, Bone } from "./Skeleton";
import { Object3D, Quaternion, Vector3, Matrix4 } from "./Object3D";
import { Clock } from "./Clock";
import { delerp, clamp } from "./MathHelpers";
import { Camera } from "./Camera";
import { AnimationMixer, AnimationClip } from "./resources/Animation";

const kMaxAvatarBoneCount = 32;

const scratchQuatA = quat.create();
const scratchVec3A = vec3.create();

class AvatarShader implements Gfx.ShaderDescriptor {
    private static vert = skinnedVertSource;
    private static frag = frag_source;

    public static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
        u_color: { type: Gfx.Type.Float4 },
        u_joints: { type: Gfx.Type.Float4x4, count: kMaxAvatarBoneCount },
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

    models: Model[] = [];
    skinnedModels: SkinnedModel[] = [];
    skeletons: Skeleton[];

    nodes: Object3D[] | Bone[];
    rootNodes: Object3D[] = [];
    animations: AnimationClip[] = [];

    mixer: AnimationMixer;

    initialize({ gfxDevice, resources, globalUniforms }: { gfxDevice: Gfx.Renderer, resources: ResourceManager, globalUniforms: GlobalUniforms }) {
        this.gfxDevice = gfxDevice;
        this.globalUniforms = globalUniforms;

        this.shader = gfxDevice.createShader(new AvatarShader());
        this.modelShader = gfxDevice.createShader(new ModelShader());

        resources.load('data/Tn.glb', 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }

            const gltf = resource as GltfResource;

            // @HACK:
            this.animations = gltf.animations;

            // Create Object3Ds for each node
            this.nodes = gltf.nodes;

            // Create skeletons for each skin
            this.skeletons = gltf.skins.map(skin => {
                const bones = skin.joints.map(jointId => this.nodes[jointId]);
                const ibms = skin.inverseBindMatrices?.map(ibm => { const m = new Matrix4(); m.elements = Array.from(ibm); return m; });
                return new Skeleton(bones as Bone[], ibms);
            });

            // Load models
            for (let i = 0; i < gltf.nodes.length; i++) {
                const src = gltf.nodes[i];
                const node = this.nodes[i];

                if (defined(src.skinId)) {
                    const meshId = assertDefined(src.meshId);
                    this.loadSkinnedModel(gltf, node, meshId, src.skinId);
                } else if (defined(src.meshId)) {
                    this.loadModel(gltf, node, src.meshId);
                }
            }

            this.rootNodes = gltf.rootNodeIds.map(nodeId => this.nodes[nodeId]);

            this.rootNodes.forEach(node => {
                node.updateMatrix();
                node.updateMatrixWorld();
            });

            // @HACK:
            this.mixer = new AnimationMixer(this.rootNodes[0]);
            const clip = assertDefined(this.animations[12]);
            const action = this.mixer.clipAction(clip);
            action.play()
        });
    }

    createMaterial(prim: GltfPrimitive, gltf: GltfResource) {
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
        const technique =  primMaterial.technique;

        const shader = technique ? technique.shaderId : this.shader;
        const resourceLayout = technique ? buildResourceLayout(technique) : AvatarShader.resourceLayout;
        const material = new Material(this.gfxDevice, primMaterial.name, shader, resourceLayout);

        // Bind resources to the material
        const uniformLayout = (resourceLayout.uniforms as Gfx.UniformBufferResourceBinding).layout;
        const ubo = new UniformBuffer(primMaterial.name, this.gfxDevice, uniformLayout);
        material.setUniformBuffer(this.gfxDevice, 'uniforms', ubo);
        if (defined(resourceLayout.globalUniforms)) {
            material.setUniformBuffer(this.gfxDevice, 'globalUniforms', this.globalUniforms.buffer);
        }

        if (technique) {
            const values = assertDefined(primMaterial.values);

            // Set static uniforms from the values provided in the GLTF material
            for (const name of Object.keys(technique.uniforms)) {
                const uniform = technique.uniforms[name];
                const value = defaultValue(values[name], uniform.value);
                if (!defined(value)) continue;

                if (uniform.type === Gfx.Type.Texture2D) {
                    const texId = gltf.textures[value.index].id;
                    material.setTexture(this.gfxDevice, name, texId);
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

    loadSkinnedModel(gltf: GltfResource, parent: Object3D, meshId: number, skinId: number) {
        const gltfMesh = gltf.meshes[meshId];

        for (let prim of gltfMesh.primitives) {
            const material = this.createMaterial(prim, gltf);
            const model = new SkinnedModel(this.gfxDevice, renderLists.opaque, prim.mesh, material);
            model.bindSkeleton(this.skeletons[skinId]);
            this.skinnedModels.push(model);
            parent.add(model);
        }
    }

    loadModel(gltf: GltfResource, parent: Object3D, meshId: number) {
        const gltfMesh = gltf.meshes[meshId];

        for (let prim of gltfMesh.primitives) {
            const material = this.createMaterial(prim, gltf);
            const model = new Model(this.gfxDevice, renderLists.opaque, prim.mesh, material);
            this.models.push(model);
            parent.add(model);
        }
    }
    
    update({ clock }: { clock: Clock }) {
        if (this.mixer) {
            this.mixer.update(clock.dt / 1000.0);
        }
    }

    render({ gfxDevice, camera, clock }: { gfxDevice: Gfx.Renderer, camera: Camera, clock: Clock }) {
        for (const node of this.rootNodes) {
            node.updateMatrixWorld();
        }

        for (let i = 0; i < this.skinnedModels.length; i++) {
            const model = this.skinnedModels[i];
            const uniforms = model.material.getUniformBuffer('uniforms');

            // const bone = assertDefined(model.skeleton.bones.find(bone => bone.name === 'j_tn_atama1'));
            // bone.rotateX(clock.dt / 1000.0 * Math.PI / 32.0);

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