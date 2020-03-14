import { RenderPrimitive } from './RenderPrimitive';
import { Id, CullMode, DepthStateDescriptor, RenderFormat } from './gfx/GfxTypes';

export class RenderList {
    primitives: RenderPrimitive[] = [];
    defaultDepthStateId?: Id;

    constructor(public defaultCullMode: CullMode, public defaultDepthState: DepthStateDescriptor, public renderFormat: RenderFormat) {}
    push(primitive: RenderPrimitive) { this.primitives.push(primitive); }
}

export const renderLists: { [name: string]: RenderList } = {
    opaque: new RenderList(CullMode.Back, { depthWriteEnabled: true, depthTestEnabled: true }, { blendingEnabled: false }),
}