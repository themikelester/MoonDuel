import { Id, PrimitiveType, Type, CullMode } from './gfx/GfxTypes';

export interface BufferChunk {
    bufferId: Id;
    byteOffset?: number;
    byteLength?: number;
}

export interface RenderPrimitive {
    resourceTable: Id;
    renderPipeline: Id;
    elementCount: number;
    type: PrimitiveType;

    indexBuffer?: BufferChunk;
    indexType?: Type

    depthMode?: Id;
    cullMode?: CullMode;
}