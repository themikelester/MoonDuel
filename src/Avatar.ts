import { ResourceManager } from "./resources/ResourceLoading";
import { GltfResource } from "./resources/Gltf";
import { Mesh, Model, Material, SkinnedModel } from "./Mesh";
import * as Gfx from './gfx/GfxTypes';
import { renderLists } from "./RenderList";
import { GlobalUniforms } from "./GlobalUniforms";

import simple_vert from './shaders/simple.vert';
import simple_frag from './shaders/simple.frag';
import { UniformBuffer } from "./UniformBuffer";
import { vec4, vec3 } from "gl-matrix";
import { defaultValue, assert, assertDefined } from "./util";
import { Skin, Skeleton } from "./Skeleton";

class AvatarShader implements Gfx.ShaderDescriptor {
    private static vert = simple_vert;
    private static frag = simple_frag;
    
    public static uniformLayout: Gfx.BufferLayout = {
        u_color: { offset: 0, type: Gfx.Type.Float4 },
    };

    public static resourceLayout = {
        uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: AvatarShader.uniformLayout },
        globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    };

    name = 'AvatarShader';
    vertSource = AvatarShader.vert.sourceCode;
    fragSource = AvatarShader.frag.sourceCode;
    resourceLayout = AvatarShader.resourceLayout;
    id: Gfx.Id;
}

export class AvatarManager {
    shader: Gfx.Id;
    materialUniforms: UniformBuffer;
    models: Model[] = [];

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
                const skin = assertDefined((gltf.skins.length > 0) ? Skin.fromGltf(gltf.skins[0]) : undefined);

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

    render() {
        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];
            model.renderList.push(model.primitive);
        }
    }
}