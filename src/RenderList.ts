import { RenderPrimitive } from './RenderPrimitive';

export type RenderList = Array<RenderPrimitive>

export const renderLists: { [name: string]: RenderList } = {
    opaque: [],
}