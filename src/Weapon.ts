import { Model } from "./Mesh";
import { Resource } from "./resources/Resource";
import { GltfResource, GltfPrimitive, GltfTechnique, GltfNode } from "./resources/Gltf";
import { BufferPackedLayout, computePackedBufferLayout, UniformBuffer } from "./UniformBuffer";
import { assertDefined, defaultValue, assert } from "./util";
import * as Gfx from './gfx/GfxTypes';
import { vec4, mat4 } from "gl-matrix";
import { Material, Mesh } from './Mesh';
import { renderLists } from "./RenderList";
import { Object3D } from './Object3D';
import { Camera } from './Camera';

export class Weapon {
    model: Model;

}

export class Sword extends Weapon {
    static shader: Gfx.Id;
    static mesh: Mesh;
    static resourceLayout: Gfx.ResourceLayout;
    static matUniformBuf: UniformBuffer;
    static matTextures: Record<string, Gfx.Id> = {};
    static meshNode: GltfNode;

    model: Model;
    material: Material;
    uniforms: UniformBuffer;

    static onResourcesLoaded(resource: Resource, { gfxDevice }: { gfxDevice: Gfx.Renderer }) {
        const gltf = resource as GltfResource;

        const prim = gltf.meshes[0].primitives[0];
        const material = gltf.materials[prim.materialIndex];
        const technique = assertDefined(material.technique);
        this.shader = technique.shaderId;
        this.mesh = prim.mesh;
        this.meshNode = assertDefined(gltf.nodes.find(n => n.meshId === 0));

        // @TODO: Depth/Cull modes?

        const kModelUniforms = [
            //'u_LightColors', 'u_LightCosAttens', 'u_LightDistAttens', 'u_LightTransforms',
            'u_model', 'u_modelViewProjection'];

        // Separate GLTF uniforms into:
        // - Static material uniforms (which can be shared between instances)
        // - Dynamic model uniforms (set per frame based on model data)
        // - Textures
        const matUniforms: BufferPackedLayout = {};
        const modelUniforms: BufferPackedLayout = {};
        const textures: string[] = [];
        for (const name of Object.keys(technique.uniforms)) {
            const uni = technique.uniforms[name];

            if (kModelUniforms.includes(name)) { modelUniforms[name] = uni; }
            else if (uni.type === Gfx.Type.Texture2D) { textures.push(name); }
            else { matUniforms[name] = uni; }
        }

        // Build a resource layout based on the required uniforms
        const matUniLayout: Gfx.BufferLayout = computePackedBufferLayout(matUniforms);
        const modelUniLayout: Gfx.BufferLayout = computePackedBufferLayout(modelUniforms);
        const resourceLayout: Gfx.ShaderResourceLayout = {
            model: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: modelUniLayout },
            material: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: matUniLayout },
        };
        for (let i = 0; i < textures.length; i++) {
            const texName = textures[i];
            resourceLayout[texName] = { index: i, type: Gfx.BindingType.Texture };
        }

        // This resource layout is shared between all instances
        Sword.resourceLayout = resourceLayout;

        // Construct a material uniform buffer that can be shared between instances
        this.matUniformBuf = new UniformBuffer(material.name, gfxDevice, matUniLayout);

        // Set static uniforms from the values provided in the GLTF material
        const values = assertDefined(material.values);
        for (const name of Object.keys(matUniforms).concat(textures)) {
            const uniform = technique.uniforms[name];
            const value = assertDefined(defaultValue(values[name], uniform.value),
                `Expected material uniform '${name}' to have a value in the material or technique`);

            if (uniform.type === Gfx.Type.Texture2D) {
                const texId = gltf.textures[value.index].id;
                this.matTextures[name] = texId;
            } else if (uniform.type === Gfx.Type.Float) {
                this.matUniformBuf.setFloat(name, value);
            } else {
                this.matUniformBuf.setFloats(name, value);
            }
        }

        // @HACK:
        this.matUniformBuf.setVec4('u_Color0', vec4.fromValues(0.4266, 0.4171, 0.5057, 1));
    }

    static create(gfxDevice: Gfx.Renderer) {
        // @TODO: Defer resource creation until onResourceLoaded is called (which triggers callbacks at the end).
        assertDefined(this.shader);

        const sword = new Sword();
        sword.material = new Material(gfxDevice, name, this.shader, this.resourceLayout);
        sword.model = new Model(gfxDevice, renderLists.opaque, this.mesh, sword.material);

        // Clone the node hierarchy (so that we can manipulate without modifying other instances)
        let lastAncestor: Object3D = sword.model;
        Sword.meshNode.traverseAncestors(ancestor => {
            const a = ancestor.clone(false);
            a.add(lastAncestor);
            lastAncestor = ancestor;
        });
        sword.model.updateWorldMatrix(true, false);

        // Set shared resources
        Object.keys(this.matTextures).forEach(name => sword.material.setTexture(gfxDevice, name, this.matTextures[name]));
        sword.material.setUniformBuffer(gfxDevice, 'material', this.matUniformBuf);

        // Create a new uniform buffer for the per-instance data
        const bufLayout = (this.resourceLayout['model'] as Gfx.UniformBufferResourceBinding).layout;
        sword.uniforms = new UniformBuffer('SwordModelUniforms', gfxDevice, bufLayout);
        sword.material.setUniformBuffer(gfxDevice, 'model', sword.uniforms);

        return sword;
    }

    render({ gfxDevice, camera }: { gfxDevice: Gfx.Renderer, camera: Camera }) {
        const model = this.model;
        const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;

        const uniforms = model.material.getUniformBuffer('model');
        uniforms.setMat4('u_model', matrixWorld);
        uniforms.setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, matrixWorld));
        uniforms.write(gfxDevice);

        model.renderList.push(model.primitive);
    }
}