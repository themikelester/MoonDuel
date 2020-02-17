import * as Gfx from './gfx/GfxTypes';
import { RenderPrimitive, BufferChunk } from './RenderPrimitive';
import { UniformBuffer } from './UniformBuffer';

export interface Model {
    materials: Material[];
    meshes: Mesh[];
}

export interface Material {
    uniforms: UniformBuffer;
    textures: { [name: string]: Gfx.Id };
}

export interface Mesh {
    name: string;
    primitives: MeshPrimitive[];
    morphWeights?: number[];
    uniforms: UniformBuffer;
}

export interface MeshPrimitive extends RenderPrimitive {
    material?: Material;
}