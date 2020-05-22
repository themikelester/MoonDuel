import { Id, BufferView, PrimitiveType, Type, CullMode } from './gfx/GfxTypes';

export interface IRenderPrimitive {
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

export class RenderPrimitive implements IRenderPrimitive {
    resourceTable: Id;
    vertexTable: Id;
    renderPipeline: Id;
    elementCount: number;
    type: PrimitiveType;

    indexBuffer?: BufferView;
    indexType?: Type

    depthMode?: Id;
    cullMode?: CullMode;

    instanceCount?: number;

    constructor(renderPipeline: Id, vertexTable: Id, resourceTable: Id) {
        this.resourceTable = resourceTable;
        this.vertexTable = vertexTable; 
        this.renderPipeline = renderPipeline;

        this.elementCount = 0;
        this.type = PrimitiveType.Triangles;
    }
}