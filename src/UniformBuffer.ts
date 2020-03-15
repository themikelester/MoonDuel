import * as Gfx from './gfx/GfxTypes';
import { vec2, vec3, vec4 } from 'gl-matrix';
import { assertDefined, defaultValue } from './util';

// --------------------------------------------------------------------------------
// Defining a PackedBuffer is a lot easier than manually computing offsets. E.g:
//   public static bufferLayout: Gfx.BufferLayout = computePackedBufferLayout({
//     g_camPos: { type: Gfx.Type.Float3 },
//     g_proj: { type: Gfx.Type.Float4x4 },
//     g_viewProj: { type: Gfx.Type.Float4x4 },
//   });
// --------------------------------------------------------------------------------
export interface BufferPackedLayout {
  [name: string]: {
    type: Gfx.Type,
    count?: number,
  }
}

export function computePackedBufferLayout(packedLayout: BufferPackedLayout): Gfx.BufferLayout {
  const layout: Gfx.BufferLayout = {};

  let bufferSize = 0;
  const names = Object.keys(packedLayout);
  for (let i = 0; i < names.length; i++) {
      const attrib = packedLayout[names[i]];
      layout[names[i]] = {
        ...attrib,
        offset: bufferSize,
      };
      bufferSize += Gfx.TranslateTypeToSize(attrib.type) * defaultValue(attrib.count, 1);
  }

  return layout;
}

// --------------------------------------------------------------------------------
// A convenience class which allocates a uniform buffer based on a BufferLayout, 
// and also provides functions to write data to that buffer based on a uniform name.
// NOTE: !!! Data will not be written to the GPU buffer until you call write() !!!
// --------------------------------------------------------------------------------

export class UniformBuffer {
  private readonly bufferLayout: Gfx.BufferLayout;

  private bufferSize: number = 0;
  private bufferData: ArrayBuffer;
  private bufferBytes: Uint8Array;
  private bufferFloats: Float32Array;
  private bufferView: DataView;
  private buffer: Gfx.Id;

  getBuffer() { return this.buffer }
  getBufferLayout() { return this.bufferLayout; }

  constructor(name: string, renderer: Gfx.Renderer, bufferLayout: Gfx.BufferLayout) {
    this.bufferLayout = bufferLayout;

    // Compute size and offsets
    // @NOTE: If a uniform offset is undefined, it will be set to the next available byte in the buffer
    const names = Object.keys(this.bufferLayout);
    let lastUniform = this.bufferLayout[names[0]];
    for (let i = 1; i < names.length; i++) {
      const uniform = this.bufferLayout[names[i]];
      if (uniform.offset > lastUniform.offset) lastUniform = uniform;
    }
    this.bufferSize = lastUniform.offset + Gfx.TranslateTypeToSize(lastUniform.type) * defaultValue(lastUniform.count, 1);

    this.bufferData = new ArrayBuffer(this.bufferSize);
    this.bufferBytes = new Uint8Array(this.bufferData);
    this.bufferFloats = new Float32Array(this.bufferData);
    this.bufferView = new DataView(this.bufferData);
    this.buffer = renderer.createBuffer(name, Gfx.BufferType.Uniform, Gfx.Usage.Dynamic, this.bufferSize);
  }

  setFloat(name: string, value: number) {
    const uniform = assertDefined(this.bufferLayout[name], `Attempted to set unknown uniform ${name}`);
    this.bufferView.setFloat32(uniform.offset, value, true); 
  }

  setVec2(name: string, v: vec2) {
    const uniform = assertDefined(this.bufferLayout[name], `Attempted to set unknown uniform ${name}`);
    this.bufferView.setFloat32(uniform.offset + 0, v[0], true); 
    this.bufferView.setFloat32(uniform.offset + 4, v[1], true); 
  }

  setVec3(name: string, v: vec3) {
    const uniform = assertDefined(this.bufferLayout[name], `Attempted to set unknown uniform ${name}`);
    this.bufferView.setFloat32(uniform.offset + 0, v[0], true); 
    this.bufferView.setFloat32(uniform.offset + 4, v[1], true); 
    this.bufferView.setFloat32(uniform.offset + 8, v[2], true); 
  }

  setVec4(name: string, v: vec4) {
    const uniform = assertDefined(this.bufferLayout[name], `Attempted to set unknown uniform ${name}`);
    this.bufferView.setFloat32(uniform.offset + 0, v[0], true); 
    this.bufferView.setFloat32(uniform.offset + 4, v[1], true); 
    this.bufferView.setFloat32(uniform.offset + 8, v[2], true); 
    this.bufferView.setFloat32(uniform.offset + 12, v[3], true); 
  }

  setBytes(name: string, value: Uint8Array) {
    const uniform = this.bufferLayout[name];
    if (!uniform) throw new Error(`Attempted to set unknown uniform ${name}`);
    if (value.byteLength !== Gfx.TranslateTypeToSize(uniform.type) * (uniform.count || 1)) throw new Error('Invalid size');
    this.bufferBytes.set(value, uniform.offset);
  }

  setFloats(name: string, value: Float32Array) {
    const uniform = this.bufferLayout[name];
    if (!uniform) throw new Error(`Attempted to set unknown uniform ${name}`);
    if (value.byteLength !== Gfx.TranslateTypeToSize(uniform.type) * (uniform.count || 1)) throw new Error('Invalid size');
    this.bufferFloats.set(value, uniform.offset / 4);
  }

  getFloatArray(name: string) {
    const uniform = this.bufferLayout[name];
    if (!uniform) throw new Error(`Attempted to set unknown uniform ${name}`);
    return new Float32Array(this.bufferData, uniform.offset, Gfx.TranslateTypeToSize(uniform.type) / 4);
  }

  write(renderer: Gfx.Renderer) {
    renderer.writeBufferData(this.buffer, 0, this.bufferBytes);
  }

  terminate(renderer: Gfx.Renderer) {
    renderer.removeBuffer(this.buffer);
  }
}