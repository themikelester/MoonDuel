import * as Gfx from './gfx/GfxTypes';
import vertShaderSource from './shaders/grid.vert';
import fragShaderSource from './shaders/grid.frag';
import { GlobalUniforms } from './GlobalUniforms';
import { renderLists } from './RenderList';
import { RenderPrimitive } from './RenderPrimitive';
import { computePackedBufferLayout, UniformBuffer } from './UniformBuffer';
import { DebugMenu } from './DebugMenu';
import { vec4 } from 'gl-matrix';

class GridShader implements Gfx.ShaderDescriptor {
    private static vert = vertShaderSource;
    private static frag = fragShaderSource;

    public static UniformLayout = computePackedBufferLayout({
        u_baseColor: { type: Gfx.Type.Float4 },
        u_lineColor: { type: Gfx.Type.Float4 },
        u_gridUnit: { type: Gfx.Type.Float },
        u_gridRadius: { type: Gfx.Type.Float },
    });

    public static resourceLayout = {
        globalUniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
        uniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GridShader.UniformLayout }
    };

    name = 'GridShader';
    vertSource = GridShader.vert.sourceCode;
    fragSource = GridShader.frag.sourceCode;
    id: Gfx.Id;
}

export class DebugGrid {
    baseColor = vec4.fromValues(0.3, 0.3, 0.3, 1.0);
    lineColor = vec4.fromValues(1.0, 1.0, 1.0, 1.0);
    gridUnit = 100.0;
    gridRadius = 5000.0;
    enabled = false;

    private primitive: RenderPrimitive;
    private uniforms: UniformBuffer;

    initialize({ gfxDevice, globalUniforms, debugMenu }: { gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, debugMenu: DebugMenu}) {
        // Safari does not support WebGL2, so no version 300 GLSL which we use for derivatives
        // This could be written as a 100 shader with an extension, but its just a debug feature
        if (!gfxDevice.isGfxFeatureSupported(Gfx.Feature.ShaderGlsl300)) {
            console.warn('GLSL version 300 not supported, disabling DebugGrid');
            this.enabled = false;
            return;
        }

        const shader = gfxDevice.createShader(new GridShader());
        const renderFormat: Gfx.RenderFormat = { blendingEnabled: false };
        const resourceLayout = GridShader.resourceLayout;
        const vertexLayout: Gfx.VertexLayout = {
            buffers: [{
                stride: 2,
                layout: {
                    a_pos: { type: Gfx.Type.Char2, offset: 0 }
                }
            }]
        }

        const pipeline = gfxDevice.createRenderPipeline(shader, renderFormat, vertexLayout, resourceLayout);
        
        const vertexBuffer = gfxDevice.createBuffer('GridVertices', Gfx.BufferType.Vertex, Gfx.Usage.Static, new Int8Array([-1, -1, 1, -1, -1, 1, 1, 1]));
        const indexBuffer = gfxDevice.createBuffer('GridIndices', Gfx.BufferType.Index, Gfx.Usage.Static, new Uint16Array([0, 2, 1, 1, 2, 3]));

        const resources = gfxDevice.createResourceTable(resourceLayout);
        this.uniforms = new UniformBuffer('GridUniforms', gfxDevice, GridShader.UniformLayout);
        gfxDevice.setBuffer(resources, 0, globalUniforms.bufferView);
        gfxDevice.setBuffer(resources, 1, this.uniforms.getBufferView());

        const vertexTable = gfxDevice.createVertexTable(pipeline);
        gfxDevice.setVertexBuffer(vertexTable, 0, { buffer: vertexBuffer });

        this.primitive = new RenderPrimitive(pipeline, vertexTable, resources);
        this.primitive.indexBuffer = { buffer: indexBuffer };
        this.primitive.indexType = Gfx.Type.Ushort;
        this.primitive.elementCount = 6;

        const menu = debugMenu.addFolder('DebugGrid');
        menu.add(this, 'enabled');
        menu.add(this, 'gridUnit', 1, 100, 10);
        menu.add(this, 'gridRadius');
    }

    render({ gfxDevice }: { gfxDevice: Gfx.Renderer }) {
        if (this.enabled) {
            this.uniforms.setVec4('u_baseColor', this.baseColor);
            this.uniforms.setVec4('u_lineColor', this.lineColor);
            this.uniforms.setFloat('u_gridUnit', this.gridUnit);
            this.uniforms.setFloat('u_gridRadius', this.gridRadius);
            this.uniforms.write(gfxDevice);
    
            renderLists.opaque.push(this.primitive);
        }
    }
}