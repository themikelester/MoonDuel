import { Id, BufferView, PrimitiveType, Type, CullMode } from './gfx/GfxTypes';

export interface RenderPrimitive {
    resourceTable: Id;
    vertexTable: Id;
    renderPipeline: Id;
    elementCount: number;
    type: PrimitiveType;

    indexBuffer?: BufferView;
    indexType?: Type

    depthMode?: Id;
    cullMode?: CullMode;
}