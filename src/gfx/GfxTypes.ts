// -------------------------------------------------------------------------------
// Notes: Custom constants that are graphics API agnostic. All rendering is done 
//        using these, and they are converted to the correspoinding API-specific
//        constants in the renderer implementation (e.g. WebGL). These need to be
//        kept in sync with their C counterparts.
//
// Author: Mike Lester
// Date C: 03-23-2019
// --------------------------------------------------------------------------------

// --------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------*/
export const kMaxShaderAttributes = 16;
export const kMaxShaderUniforms = 64;
export const kMaxShaderVertexBuffers = 16;

export const kDefaultRenderPass = 0;

// --------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------*/
export type Id = number;

export interface BufferLayout {
  [name: string]: {
    type: Type,
    offset: number,
    count?: number,
  }
}

export interface VertexLayout {
  buffers: Array<{
    stride: number,
    layout: BufferLayout
    stepMode?: StepMode,
  }>
}

export interface TextureDescriptor {
  type: TextureType,
  format: TexelFormat,
  usage: Usage,
  width?: number,
  height?: number,
  depth?: number,
  defaultMinFilter?: TextureFilter,
  defaultMagFilter?: TextureFilter,
  defaultWrapS?: TextureWrap,
  defaultWrapT?: TextureWrap,
  maxAnistropy?: number,
}

export interface DepthStateDescriptor {
  depthTestEnabled: boolean;
  depthWriteEnabled: boolean;
  depthCompareFunc?: CompareFunc;
}

export interface RenderFormat {
  blendingEnabled: boolean,
  srcBlendFactor?: BlendFactor,
  dstBlendFactor?: BlendFactor,
}

export interface BufferView {
  buffer: Id;
  byteOffset?: number;
  byteLength?: number;
}

export type TextureView = Id;

export interface ResourceBinding {
  index: number,
  type: BindingType,
}
export type ResourceLayout = { [resourceName: string]: ResourceBinding };

export interface ShaderDescriptor {
  name: string,
  vertSource: string | string[],
  fragSource: string | string[],
}

// --------------------------------------------------------------------------------------------------
// ShaderResourceLayout
// Note: For backends that do not support defining resource layouts within the shader (WebGL1), the
//       resource locations may be specified at shader-creation time.      
// ------------------------------------------------------------------------------------------------*/
export interface TextureResourceBinding extends ResourceBinding {
  count?: number,
}

export interface UniformBufferResourceBinding extends ResourceBinding {
  layout: BufferLayout,
}

// @NOTE: This is a superset of ResourceBinding. It may be passed to createRenderPipeline directly
export type ShaderResourceLayout = { [resourceName: string]: (TextureResourceBinding | UniformBufferResourceBinding) };

// --------------------------------------------------------------------------------
// Enums
// -------------------------------------------------------------------------------*/
export enum Feature {
  VertexArrayObject = 1 << 0, // @TODO: This should be WebGL only. It doesn't belong in Gfx
  TextureFloat = 1 << 1, // F32 format textures
  TextureHalf = 1 << 2,  // F16 format textures
  TextureFloatLinearFiltering = 1 << 3, // Linear minification filtering for F32 textures
  TextureHalfLinearFiltering = 1 << 4, // Linear minification filtering for F16 textures
  TextureWrite = 1 << 5, // Write directly to texture memory without re-allocating it
  ShaderDerivatives = 1 << 6, // Standard derivative functions like fwidth or dx/dy
  Instancing = 1 << 7, // Instanced vertex arrays, for instanced draw calls
  AnistropicFiltering = 1 << 8, // Hardware support for anisotropic texture filtering
  ShaderGlsl100 = 1 << 9, // GLSL version 100 shader source can be compiled
  ShaderGlsl300 = 1 << 10, // GLSL version "300 es" shader source can be compiled
}

export enum Type {
  Undefined = 0,
  Float,
  Float2,
  Float3,
  Float4,
  Int,
  Int2,
  Int3,       
  Int4,       
  Uint,       
  Uint2,      
  Uint3,      
  Uint4,      
  Short,      
  Short2,     
  Short3,     
  Short4,     
  Ushort,    
  Ushort2,    
  Ushort3,    
  Ushort4,    
  Char,     
  Char2,      
  Char3,      
  Char4,      
  Uchar,      
  Uchar2,     
  Uchar3,     
  Uchar4,     
  Half,       
  Half2,      
  Half3,      
  Half4,      
  Float3x3,   
  Float3x4,   
  Float4x4,

  Texture2D = 0xF0,  
  Texture3D = 0xF1,  
  TextureCube = 0xF2,

  Short_Norm = 0x100,      
  Short2_Norm,     
  Short3_Norm,     
  Short4_Norm,     
  Ushort_Norm,    
  Ushort2_Norm,    
  Ushort3_Norm,    
  Ushort4_Norm,    
  Char_Norm,     
  Char2_Norm,      
  Char3_Norm,      
  Char4_Norm,      
  Uchar_Norm,      
  Uchar2_Norm,     
  Uchar3_Norm,     
  Uchar4_Norm,    
}

export enum TextureType {
  Texture2D = 0xF0,  
  Texture3D = 0xF1,  
  TextureCube = 0xF2,
}

export enum TexelFormat {
  Undefined = 0,      
  U565,           
  U8,             
  U8_sRGB,        
  U8x2,           
  U8x2_sRGB,      
  U8x3,           
  U8x3_sRGB,      
  U8x4,           
  U8x4_sRGB,      
  U10_10_10_2,    
  F11_11_10,      
  F16,            
  F16x2,         
  F16x3,        
  F16x4,          
  F32x2,
  F32x3,          
  F32x4,          
  Depth32,        
  Depth24Stencil8,
}

export enum TextureFilter {
  Nearest,
  Linear,
}

export enum TextureWrap {
  Clamp,
  Repeat,
}

export enum CompareFunc {
  Never = 0,       
  Less,        
  Equal,       
  LessEqual,   
  Greater,     
  NotEqual,    
  GreaterEqual,
  Always,      
}

export enum PrimitiveType {
  Points,       
  Lines,        
  LineLoop,     
  LineStrip,    
  Triangles,    
  TriangleStrip,
  TriangleFan,  
}

export enum BufferType {
  Undefined = 0,
  Uniform,
  Vertex,
  Index,
  Readback,
}

export enum BindingType {
  Undefined = 0,
  UniformBuffer,
  Texture,
}

export enum Usage {
  None = 0,
  Static,
  Dynamic,
}

export enum CullMode {
  None = 0,
  Back,
  Front,
}

export enum BlendFactor {
  Zero = 0,
  One,
  Source,
  OneMinusSource,
}

export enum StepMode {
  Vertex = 0,
  Instance,
}

// --------------------------------------------------------------------------------
// Translations
// -------------------------------------------------------------------------------*/
export function TranslateTypeToSize(type: Type): number {
  switch (type) {
    case Type.Float:   return 4;
    case Type.Float2:  return 8;
    case Type.Float3:  return 12;
    case Type.Float4:  return 16;
    case Type.Int:     return 4;
    case Type.Int2:    return 8;
    case Type.Int3:    return 12;
    case Type.Int4:    return 16;
    case Type.Uint:    return 4;
    case Type.Uint2:   return 8;
    case Type.Uint3:   return 12;
    case Type.Uint4:   return 16;
    case Type.Short:   return 2;
    case Type.Short2:  return 4;
    case Type.Short3:  return 6;
    case Type.Short4:  return 8;
    case Type.Ushort:  return 2;
    case Type.Ushort2: return 4;
    case Type.Ushort3: return 6;
    case Type.Ushort4: return 8;
    case Type.Char:    return 1;
    case Type.Char2:   return 2;
    case Type.Char3:   return 3;
    case Type.Char4:   return 4;
    case Type.Uchar:   return 1;
    case Type.Uchar2:  return 2;
    case Type.Uchar3:  return 3;
    case Type.Uchar4:  return 4;
    case Type.Half:    return 2;
    case Type.Half2:   return 4;
    case Type.Half3:   return 6;
    case Type.Half4:   return 8;
    case Type.Float3x3: return 36;
    case Type.Float4x4: return 64;
    default: throw new Error(`Unsupported type: ${type}`);
  }
}

export interface Renderer {    
    initialize(canvas: HTMLCanvasElement): boolean;
    
    isGfxFeatureSupported(featureId: Feature): boolean;
    setDebugEnabled(debug: boolean): void;
    
    resize(width: number, height: number): void;
    beginFrame(): void;
    endFrame(): void;
    
    bindRenderPass(renderPassId: Id): void;
    bindPipeline(pipelineId: Id): void;
    bindResources(resourceTableId: Id): void;
    bindVertices(vertexTable: Id): void;
    draw(primitiveType: PrimitiveType, indexBufferId: Id, indexType: Type, indexOffset: number, indexCount: number): void;
    drawInstanced(primitiveType: PrimitiveType, indexBufferId: Id, indexType: Type, indexOffset: number, indexCount: number, instanceCount: number): void;
    drawNonIndexed(primitiveType: PrimitiveType, vertOffset: number, vertCount: number): void;
    
    setDepthStencilState(stateId: Id): void;
    setCullMode(cullMode: CullMode): void;
    
    setVertexBuffer(vertexTable: Id, index: number, view: BufferView): void;
    setBuffer(resourceTableId: Id, index: number, view: BufferView): void;
    setTexture(resourceTableId: Id, index: number, textureId: Id): void;
    setTextures(resourceTableId: Id, index: number, textureIds: Id[]): void;
    
    createDepthStencilState(desc: DepthStateDescriptor): number;
    createResourceTable(resourceLayout: ResourceLayout): Id;
    createVertexTable(pipelineId: Id): Id;
    createRenderPipeline(shaderId: Id, renderFormat: RenderFormat, vertexLayout: VertexLayout, resourceLayout: ResourceLayout): Id;
    createShader(desc: ShaderDescriptor): number;
    createTexture(name: string, desc: TextureDescriptor, image?: HTMLImageElement | HTMLCanvasElement | ArrayBufferView | ImageBitmap): Id;
    createBuffer(name: string, type: BufferType, usage: Usage, dataOrSize: (ArrayBuffer | number)): number;
    removeBuffer(bufferId: Id): void;
    removeTexture(textureId: Id): void;
    removeShader(shaderId: Id): void;
    removeRenderPipeline(pipelineId: Id): void;
    removeResourceTable(tableId: Id): void;
    removeVertexTable(tableId: Id): void;
    
    writeBufferData(bufferId: Id, dstOffset: number, srcBytes: (ArrayBuffer | ArrayBufferView)): void;
    writeTextureData(textureId: Id, image: HTMLImageElement | HTMLCanvasElement | ArrayBuffer | ImageBitmap): void;

    readPixels(offsetX: number, offsetY: number, width: number, height: number, result: Uint8Array): void;
}