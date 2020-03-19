declare module "*.glsl" {
    const content:  import('webpack-glsl-minify').GlslShader;
    export default content;
}
declare module "*.vert" {
    const content:  import('webpack-glsl-minify').GlslShader;
    export default content;
}
declare module "*.frag" {
    const content:  import('webpack-glsl-minify').GlslShader;
    export default content;
}
declare type Nullable<T> = T | null;