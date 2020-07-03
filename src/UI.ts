import vertShader from './shaders/ui.vert';
import fragShader from './shaders/ui.frag';

import { vec2, vec4 } from "gl-matrix";
import { renderLists } from "./RenderList";
import { RenderPrimitive } from "./RenderPrimitive";
import { Renderer, RenderFormat, VertexLayout, StepMode, Type, BufferLayout, ResourceLayout, ShaderResourceLayout, BindingType, BufferType, Usage, Id } from "./gfx/GfxTypes";
import { UniformBuffer } from './UniformBuffer';
import { ResourceManager } from './resources/ResourceLoading';
import { TextureResource } from './resources/Texture';

interface UIElementOptions {
  name: string;
  pos: vec2;
  size: vec2;
  
  texRegion?: vec4;
  hidden?: boolean;

  onClick?: () => void;
}

const kAtlasFilename = 'data/uiAtlas.png';
const kMaxElements = 64;
const kInstanceStride = 20;
const kZero4 = [0, 0, 0, 0];

const kInstanceLayout: BufferLayout = {
  a_origin: { type: Type.Float2, offset: 0 },
  a_size: { type: Type.Float2, offset: 8 },
  a_uv: { type: Type.Uchar4, offset: 16 },
};

const kUniformLayout: BufferLayout = {
  u_invAtlasSize: { type: Type.Float, offset: 0 },
}

export class UI {
  elements: UIElementOptions[] = [];

  private minPos = vec2.fromValues(Infinity, Infinity);
  private maxPos = vec2.fromValues(-Infinity, -Infinity);

  private instanceBytes = new Uint8Array(kInstanceStride * kMaxElements);
  private instanceFloats = new Float32Array(this.instanceBytes.buffer);

  private primitive: RenderPrimitive;
  private instanceBuffer: Id;
  private textureAtlas: Id;
  private uniformBuffer: UniformBuffer;

  initialize({ gfxDevice, resources }: { gfxDevice: Renderer, resources: ResourceManager }) {
    const renderFormat: RenderFormat = { blendingEnabled: true };
    const vertexLayout: VertexLayout = { buffers: [
      { stepMode: StepMode.Vertex, stride: 2, layout: { a_pos: { type: Type.Uchar2, offset: 0 } } },
      { stepMode: StepMode.Instance, stride: kInstanceStride, layout: kInstanceLayout },
    ]}

    const resourceLayout: ShaderResourceLayout = {
      uniforms: { index: 0, type: BindingType.UniformBuffer, layout: kUniformLayout },
      u_atlas: { index: 1, type: BindingType.Texture },
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

    // Begin loading the texture atlas
    resources.load(kAtlasFilename, 'texture', (error?: string, resource?: TextureResource) => {
      this.textureAtlas = resource?.texture!;
      gfxDevice.setTexture(this.primitive.resourceTable, 1, this.textureAtlas);
      this.uniformBuffer.setFloat('u_invAtlasSize', 1.0 / resource!.width);
      this.uniformBuffer.write(gfxDevice);
    });
  }

  update({ gfxDevice }: { gfxDevice: Renderer }) {
    const elementCount = this.elements.length;
    
    for (let i = 0; i < elementCount; i++) {
      const element = this.elements[i];
      this.instanceFloats.set(element.pos, 0);
      this.instanceFloats.set(element.size, 2);
      this.instanceBytes.set(element.texRegion ? element.texRegion : kZero4, 16);
    }

    gfxDevice.writeBufferData(this.instanceBuffer, 0, this.instanceBytes.subarray(0, elementCount * kInstanceStride));
    this.primitive.instanceCount = elementCount;
  }

  render({}) {
    renderLists.ui.push(this.primitive);
  }

  onClick(px: number, py: number) {
    // Convert to NDC
    const x = px / window.innerWidth * 2.0 - 1.0;
    const y = -(py / window.innerHeight * 2.0 - 1.0);

    // Early out if not within the UI bounds
    if (!within(x, y, this.minPos, this.maxPos)) {
      return;
    }

    // Search for hits within elements which have a click listener
    for (const e of this.elements) {
      if (e.onClick && withinSize(x, y, e.pos, e.size)) {
        return e.onClick();
      }
    }
  }

  addElement(options: UIElementOptions) {
    this.elements.push(options);

    this.minPos[0] = Math.min(this.minPos[0], options.pos[0]);
    this.minPos[1] = Math.min(this.minPos[1], options.pos[1]);
    this.maxPos[0] = Math.max(this.maxPos[0], options.pos[0] + options.size[0]);
    this.maxPos[1] = Math.max(this.maxPos[1], options.pos[1] + options.size[1]);
  }
}

function within(x: number, y: number, min: vec2, max: vec2) {
  return (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1]);
}

function withinSize(x: number, y: number, min: vec2, size: vec2) {
  const lx = x - min[0];
  const ly = y - min[1];
  return (lx >= 0 && lx <= size[0] && ly >= 0 && ly <= size[1]);
}