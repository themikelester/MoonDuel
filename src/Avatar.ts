import { ResourceManager } from "./resources/ResourceLoading";
import { GltfResource } from "./resources/Gltf";
import { Mesh, Model, Material } from "./Mesh";
import * as Gfx from './gfx/GfxTypes';
import { renderLists } from "./RenderList";
import { GlobalUniforms } from "./GlobalUniforms";

import simple_vert from './shaders/simple.vert';
import simple_frag from './shaders/simple.frag';
import { UniformBuffer } from "./UniformBuffer";

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
        
        resources.load('data/Duck.glb', 'gltf', (error, resource) => {
            if (error) { console.error(`Failed to load resource`, error); }
            else {
                const gltf = resource as GltfResource;
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
                        const model = new Model(gfxDevice, renderLists.opaque, mesh, material);
                        
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