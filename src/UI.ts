import vertShader from './shaders/ui.vert';
import fragShader from './shaders/ui.frag';

import { vec2 } from "gl-matrix";
import { renderLists } from "./RenderList";
import { RenderPrimitive } from "./RenderPrimitive";
import { Renderer, RenderFormat, VertexLayout, StepMode, Type, BufferLayout, ResourceLayout, ShaderResourceLayout, BindingType, BufferType, Usage, Id } from "./gfx/GfxTypes";
import { UniformBuffer } from './UniformBuffer';

interface UIElementOptions {
  name: string;
  pos: vec2;
  size: vec2;
}

const kMaxElements = 64;
const kInstanceStride = 16;
const kInstanceLayout: BufferLayout = {
  a_origin: { type: Type.Float2, offset: 0 },
  a_size: { type: Type.Float2, offset: 8 },
};

const kUniformLayout: BufferLayout = {
  u_screenSize: { type: Type.Ushort2, offset: 0 },
}

export class UI {
  elements: UIElementOptions[] = [];

  private instanceData = new Float32Array(kInstanceStride * kMaxElements / 4);

  private primitive: RenderPrimitive;
  private instanceBuffer: Id;
  private textureAtlas: Id;
  private uniformBuffer: UniformBuffer;

  initialize({ gfxDevice }: { gfxDevice: Renderer }) {
    const renderFormat: RenderFormat = { blendingEnabled: true };
    const vertexLayout: VertexLayout = { buffers: [
      { stepMode: StepMode.Vertex, stride: 2, layout: { a_pos: { type: Type.Uchar2, offset: 0 } } },
      { stepMode: StepMode.Instance, stride: kInstanceStride, layout: kInstanceLayout },
    ]}

    const resourceLayout: ShaderResourceLayout = {
      uniforms: { index: 0, type: BindingType.UniformBuffer, layout: kUniformLayout },
      atlas: { index: 1, type: BindingType.Texture },
    }

    const shader = gfxDevice.createShader({ name: 'UI', vertSource: vertShader.sourceCode, fragSource: fragShader.sourceCode });
    const pipeline = gfxDevice.createRenderPipeline(shader, renderFormat, vertexLayout, resourceLayout);
    const resourceTable = gfxDevice.createResourceTable(resourceLayout);
    const vertexTable = gfxDevice.createVertexTable(pipeline);

    const quadVertBuf = gfxDevice.createBuffer('UiQuadVerts', BufferType.Vertex, Usage.Static, new Uint8Array([
      0, 0,
      1, 0, 
      0, 1, 
      1, 1
    ]));

    const quadIdxBuf = gfxDevice.createBuffer('UiQuadIndices', BufferType.Index, Usage.Static, new Uint16Array([
      0, 1, 2, 2, 1, 3
    ]));

    const instanceBufSize = kMaxElements * kInstanceStride;
    this.instanceBuffer = gfxDevice.createBuffer('UiInstances', BufferType.Vertex, Usage.Dynamic, instanceBufSize);

    this.uniformBuffer = new UniformBuffer('UiUniforms', gfxDevice, kUniformLayout);

    gfxDevice.setVertexBuffer(vertexTable, 0, { buffer: quadVertBuf });
    gfxDevice.setVertexBuffer(vertexTable, 1, { buffer: this.instanceBuffer });

    gfxDevice.setBuffer(resourceTable, 0, this.uniformBuffer.getBufferView());
    gfxDevice.setTexture(resourceTable, 1, this.textureAtlas);

    this.primitive = new RenderPrimitive(pipeline, vertexTable, resourceTable);
    this.primitive.elementCount = 6;
    this.primitive.indexType = Type.Ushort;
    this.primitive.indexBuffer = { buffer: quadIdxBuf };
    this.primitive.instanceCount = 0;
  }

  update({ gfxDevice }: { gfxDevice: Renderer }) {
    const elementCount = this.elements.length;
    
    for (let i = 0; i < elementCount; i++) {
      const element = this.elements[i];
      this.instanceData.set(element.pos, 0);
      this.instanceData.set(element.size, 2);
    }

    gfxDevice.writeBufferData(this.instanceBuffer, 0, this.instanceData.subarray(0, elementCount * kInstanceStride));
    this.primitive.instanceCount = elementCount;
  }

  render({}) {
    renderLists.ui.push(this.primitive);
  }

  addElement(options: UIElementOptions) {
    this.elements.push(options);
  }
}