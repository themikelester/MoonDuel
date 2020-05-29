import { RenderPrimitive } from './RenderPrimitive';
import { Id, CullMode, DepthStateDescriptor, RenderFormat, BlendFactor } from './gfx/GfxTypes';

export class RenderList {
    primitives: RenderPrimitive[] = [];
    defaultDepthStateId?: Id;

    constructor(public defaultCullMode: CullMode, public defaultDepthState: DepthStateDescriptor, public renderFormat: RenderFormat) {}
    push(primitive: RenderPrimitive) { 
        // @TODO: Validate primitive
        this.primitives.push(primitive); 
    }
}

export const renderLists: { [name: string]: RenderList } = {
    opaque: new RenderList(CullMode.Back, { depthWriteEnabled: true, depthTestEnabled: true }, { blendingEnabled: false }),
    skybox: new RenderList(CullMode.None, { depthWriteEnabled: false, depthTestEnabled: true }, { blendingEnabled: true, srcBlendFactor: BlendFactor.Source, dstBlendFactor: BlendFactor.OneMinusSource }),
    effects: new RenderList(CullMode.None, { depthWriteEnabled: false, depthTestEnabled: true }, { blendingEnabled: true, srcBlendFactor: BlendFactor.Source, dstBlendFactor: BlendFactor.OneMinusSource }),
    debug: new RenderList(CullMode.None, { depthWriteEnabled: false, depthTestEnabled: false }, { blendingEnabled: false }),
}