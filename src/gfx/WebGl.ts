// -------------------------------------------------------------------------------
// Notes: WebGL renderer that conforms to a generic Renderer interface
//
// Author: Mike Lester
// Date C: 03-23-2019
// --------------------------------------------------------------------------------
import * as Gfx from './GfxTypes'

// --------------------------------------------------------------------------------
// Globals
// -------------------------------------------------------------------------------*/
const kAbortOnError = true;
let gl: any; // @NOTE: Keep the WebGL context global for easy type translation

// --------------------------------------------------------------------------------
// GL Types
// -------------------------------------------------------------------------------*/
type GLInt = number;
type GLUniformLocation = any;

// --------------------------------------------------------------------------------
// Translation Functions (Gfx -> WebGL)
// -------------------------------------------------------------------------------*/
function TranslateGfxBufferType(bufferType: Gfx.BufferType): GLInt {
  switch (bufferType) {
    case Gfx.BufferType.Undefined: return 0;
    case Gfx.BufferType.Uniform: return gl.UNIFORM_BUFFER;
    case Gfx.BufferType.Vertex: return gl.ARRAY_BUFFER;
    case Gfx.BufferType.Index: return gl.ELEMENT_ARRAY_BUFFER;
    case Gfx.BufferType.Readback: return gl.TRANSFORM_FEEDBACK_BUFFER;
  }
}

function TranslateGlType(glType: GLInt): Gfx.Type {
  switch (glType) {
    // WebGL 1
    case gl.FLOAT: return Gfx.Type.Float;
    case gl.FLOAT_VEC2: return Gfx.Type.Float2;
    case gl.FLOAT_VEC3: return Gfx.Type.Float3;
    case gl.FLOAT_VEC4: return Gfx.Type.Float4;
    case gl.INT: return Gfx.Type.Int;
    case gl.INT_VEC2: return Gfx.Type.Int2;
    case gl.INT_VEC3: return Gfx.Type.Int3;
    case gl.INT_VEC4: return Gfx.Type.Int4;
    case gl.FLOAT_MAT3: return Gfx.Type.Float3x3;
    case gl.FLOAT_MAT4: return Gfx.Type.Float4x4;

    case gl.SAMPLER_2D: return Gfx.Type.Texture2D;
    case gl.SAMPLER_3D: return Gfx.Type.Texture3D;
    case gl.SAMPLER_CUBE: return Gfx.Type.TextureCube;

    // WebGL 2
    case gl.UNSIGNED_INT: return Gfx.Type.Uint;
    case gl.UNSIGNED_INT_VEC2: return Gfx.Type.Uint2;
    case gl.UNSIGNED_INT_VEC3: return Gfx.Type.Uint3;
    case gl.UNSIGNED_INT_VEC4: return Gfx.Type.Uint4;

    default: return error(`Unsupported WebGL type: ${glType}`);
  }
}

function TranslateTypeToComponentCount(type: Gfx.Type): GLInt {
  const rootType = type & 0xFF;
  switch (rootType) {
    case Gfx.Type.Float:   return 1;
    case Gfx.Type.Float2:  return 2;
    case Gfx.Type.Float3:  return 3;
    case Gfx.Type.Float4:  return 4;
    case Gfx.Type.Int:     return 1;
    case Gfx.Type.Int2:    return 2;
    case Gfx.Type.Int3:    return 3;
    case Gfx.Type.Int4:    return 4;
    case Gfx.Type.Uint:    return 1;
    case Gfx.Type.Uint2:   return 2;
    case Gfx.Type.Uint3:   return 3;
    case Gfx.Type.Uint4:   return 4;
    case Gfx.Type.Short:   return 1;
    case Gfx.Type.Short2:  return 2;
    case Gfx.Type.Short3:  return 3;
    case Gfx.Type.Short4:  return 4;
    case Gfx.Type.Ushort:  return 1;
    case Gfx.Type.Ushort2: return 2;
    case Gfx.Type.Ushort3: return 3;
    case Gfx.Type.Ushort4: return 4;
    case Gfx.Type.Char:    return 1;
    case Gfx.Type.Char2:   return 2;
    case Gfx.Type.Char3:   return 3;
    case Gfx.Type.Char4:   return 4;
    case Gfx.Type.Uchar:   return 1;
    case Gfx.Type.Uchar2:  return 2;
    case Gfx.Type.Uchar3:  return 3;
    case Gfx.Type.Uchar4:  return 4;
    case Gfx.Type.Half:    return 1;
    case Gfx.Type.Half2:   return 2;
    case Gfx.Type.Half3:   return 3;
    case Gfx.Type.Half4:   return 4;
    default: return error(`Unsupported type: ${type}`);
  }
}

function TranslateTypeToBaseGlType(type: Gfx.Type): GLInt {
  const rootType = type & 0xFF;
  switch (rootType) {
    case Gfx.Type.Float:   return gl.FLOAT;
    case Gfx.Type.Float2:  return gl.FLOAT;
    case Gfx.Type.Float3:  return gl.FLOAT;
    case Gfx.Type.Float4:  return gl.FLOAT;
    case Gfx.Type.Int:     return gl.INT;
    case Gfx.Type.Int2:    return gl.INT;
    case Gfx.Type.Int3:    return gl.INT;
    case Gfx.Type.Int4:    return gl.INT;
    case Gfx.Type.Uint:    return gl.UNSIGNED_INT;
    case Gfx.Type.Uint2:   return gl.UNSIGNED_INT;
    case Gfx.Type.Uint3:   return gl.UNSIGNED_INT;
    case Gfx.Type.Uint4:   return gl.UNSIGNED_INT;
    case Gfx.Type.Short:   return gl.SHORT;
    case Gfx.Type.Short2:  return gl.SHORT;
    case Gfx.Type.Short3:  return gl.SHORT;
    case Gfx.Type.Short4:  return gl.SHORT;
    case Gfx.Type.Ushort:  return gl.UNSIGNED_SHORT;
    case Gfx.Type.Ushort2: return gl.UNSIGNED_SHORT;
    case Gfx.Type.Ushort3: return gl.UNSIGNED_SHORT;
    case Gfx.Type.Ushort4: return gl.UNSIGNED_SHORT;
    case Gfx.Type.Char:    return gl.BYTE;
    case Gfx.Type.Char2:   return gl.BYTE;
    case Gfx.Type.Char3:   return gl.BYTE;
    case Gfx.Type.Char4:   return gl.BYTE;
    case Gfx.Type.Uchar:   return gl.UNSIGNED_BYTE;
    case Gfx.Type.Uchar2:  return gl.UNSIGNED_BYTE;
    case Gfx.Type.Uchar3:  return gl.UNSIGNED_BYTE;
    case Gfx.Type.Uchar4:  return gl.UNSIGNED_BYTE;
    case Gfx.Type.Half:    return gl.HALF_FLOAT;
    case Gfx.Type.Half2:   return gl.HALF_FLOAT;
    case Gfx.Type.Half3:   return gl.HALF_FLOAT;
    case Gfx.Type.Half4:   return gl.HALF_FLOAT;
    default: return error(`Unsupported type: ${type}`);
  }
}

function TranslatePrimitiveType(primType: Gfx.PrimitiveType) {
  switch(primType) {
    case Gfx.PrimitiveType.Points: return gl.POINTS;
    case Gfx.PrimitiveType.Lines: return gl.LINES;
    case Gfx.PrimitiveType.LineLoop: return gl.LINE_LOOP;
    case Gfx.PrimitiveType.LineStrip: return gl.LINE_STRIP;
    case Gfx.PrimitiveType.Triangles: return gl.TRIANGLES;
    case Gfx.PrimitiveType.TriangleStrip: return gl.TRIANGLE_STRIP;
    case Gfx.PrimitiveType.TriangleFan: return gl.TRIANGLE_FAN
    default: return error(`Unsupported primitive type: ${primType}`);
  }
}

function TranslateTypeToGlType(type: Gfx.Type): GLInt {
  const rootType = type & 0xFF;
  switch (type) {
    case Gfx.Type.Float:   return gl.FLOAT;
    case Gfx.Type.Float2:  return gl.FLOAT_VEC2;
    case Gfx.Type.Float3:  return gl.FLOAT_VEC3;
    case Gfx.Type.Float4:  return gl.FLOAT_VEC4;
    case Gfx.Type.Int:     return gl.INT;
    case Gfx.Type.Int2:    return gl.INT_VEC2;
    case Gfx.Type.Int3:    return gl.INT_VEC3;
    case Gfx.Type.Int4:    return gl.INT_VEC4;
    case Gfx.Type.Uint:    return gl.UNSIGNED_INT;
    case Gfx.Type.Uint2:   return gl.UNSIGNED_INT_VEC2;
    case Gfx.Type.Uint3:   return gl.UNSIGNED_INT_VEC3;
    case Gfx.Type.Uint4:   return gl.UNSIGNED_INT_VEC4;
    case Gfx.Type.Short:   return gl.SHORT;
    case Gfx.Type.Short2:  return gl.SHORT_VEC2;
    case Gfx.Type.Short3:  return gl.SHORT_VEC3;
    case Gfx.Type.Short4:  return gl.SHORT_VEC4;
    case Gfx.Type.Ushort:  return gl.UNSIGNED_SHORT;
    case Gfx.Type.Ushort2: return gl.UNSIGNED_SHORT_VEC2;
    case Gfx.Type.Ushort3: return gl.UNSIGNED_SHORT_VEC3;
    case Gfx.Type.Ushort4: return gl.UNSIGNED_SHORT_VEC4;
    case Gfx.Type.Char:    return gl.BYTE;
    case Gfx.Type.Char2:   return gl.BYTE_VEC2;
    case Gfx.Type.Char3:   return gl.BYTE_VEC3;
    case Gfx.Type.Char4:   return gl.BYTE_VEC4;
    case Gfx.Type.Uchar:   return gl.UNSIGNED_BYTE;
    case Gfx.Type.Uchar2:  return gl.UNSIGNED_BYTE_VEC2;
    case Gfx.Type.Uchar3:  return gl.UNSIGNED_BYTE_VEC3;
    case Gfx.Type.Uchar4:  return gl.UNSIGNED_BYTE_VEC4;
    case Gfx.Type.Half:    return gl.HALF_FLOAT;
    case Gfx.Type.Half2:   return gl.HALF_FLOAT_VEC2;
    case Gfx.Type.Half3:   return gl.HALF_FLOAT_VEC3;
    case Gfx.Type.Half4:   return gl.HALF_FLOAT_VEC4;
    default: return error(`Unsupported type: ${type}`);
  }
}

function isTypeNormalized(type: Gfx.Type): boolean {
  switch (type) {
    case Gfx.Type.Short_Norm:   return true;
    case Gfx.Type.Short2_Norm:  return true;
    case Gfx.Type.Short3_Norm:  return true;
    case Gfx.Type.Short4_Norm:  return true;
    case Gfx.Type.Ushort_Norm:  return true;
    case Gfx.Type.Ushort2_Norm: return true;
    case Gfx.Type.Ushort3_Norm: return true;
    case Gfx.Type.Ushort4_Norm: return true;
    case Gfx.Type.Char_Norm:    return true;
    case Gfx.Type.Char2_Norm:   return true;
    case Gfx.Type.Char3_Norm:   return true;
    case Gfx.Type.Char4_Norm:   return true;
    case Gfx.Type.Uchar_Norm:   return true;
    case Gfx.Type.Uchar2_Norm:  return true;
    case Gfx.Type.Uchar3_Norm:  return true;
    case Gfx.Type.Uchar4_Norm:  return true;
    default: return false;
  }
}

function TranslateIndexTypeToGlType(type: Gfx.Type): GLInt {
  switch (type) {
    case Gfx.Type.Uchar:   return gl.UNSIGNED_BYTE;
    case Gfx.Type.Uint:    return gl.UNSIGNED_INT;
    case Gfx.Type.Ushort:  return gl.UNSIGNED_SHORT;
    default: return error(`Unsupported index type: ${type}`);
  }
}

function TranslateCompareFunc(func: Gfx.CompareFunc): GLInt {
  switch (func) {
    case Gfx.CompareFunc.Never: return gl.NEVER;
    case Gfx.CompareFunc.Less: return gl.LESS; 
    case Gfx.CompareFunc.Equal: return gl.EQUAL;
    case Gfx.CompareFunc.LessEqual: return gl.LEQUAL;
    case Gfx.CompareFunc.Greater: return gl.GREATER;
    case Gfx.CompareFunc.NotEqual: return gl.NOTEQUAL;
    case Gfx.CompareFunc.GreaterEqual: return gl.GEQUAL;
    case Gfx.CompareFunc.Always: return gl.ALWAYS;
    default: return error(`Unsupported compare func: ${func}`);
  }
}

function TranslateGfxTextureType(gfxType: Gfx.TextureType): GLInt {
  switch (gfxType) {
    case Gfx.TextureType.Texture2D: return gl.TEXTURE_2D;
    case Gfx.TextureType.Texture3D: return gl.TEXTURE_3D;
    case Gfx.TextureType.TextureCube: return gl.TEXTURE_CUBE_MAP;
    default: return error(`Unsupported texture type: ${gfxType}`);
  }
}

function TranslateGfxTexelFormatWebGl1(format: Gfx.TexelFormat) {
  switch (format) {
    case Gfx.TexelFormat.U565: return gl.RGB;
    case Gfx.TexelFormat.U8: return gl.ALPHA;
    case Gfx.TexelFormat.U8x3: return gl.RGB;
    case Gfx.TexelFormat.U8x3_sRGB: return gl.RGB;
    case Gfx.TexelFormat.U8x4: return gl.RGBA;
    case Gfx.TexelFormat.U8x4_sRGB: return gl.RGBA;
    case Gfx.TexelFormat.F16: return gl.ALPHA;
    case Gfx.TexelFormat.F16x4: return gl.RGBA;
    case Gfx.TexelFormat.F32x4: return gl.RGBA;
    case Gfx.TexelFormat.Depth32: return gl.DEPTH_COMPONENT;
    case Gfx.TexelFormat.Depth24Stencil8: return gl.DEPTH_STENCIL;
    default: return error(`Unsupported texel format: ${format}`);    
  }
}

function TranslateGfxTexelFormat(format: Gfx.TexelFormat) {
  switch (format) {
    case Gfx.TexelFormat.U565: return gl.RGB;
    case Gfx.TexelFormat.U8: return gl.RED;
    case Gfx.TexelFormat.U8_sRGB: return gl.RED;
    case Gfx.TexelFormat.U8x2: return gl.RG;
    case Gfx.TexelFormat.U8x2_sRGB: return gl.RG;
    case Gfx.TexelFormat.U8x3: return gl.RGB;
    case Gfx.TexelFormat.U8x3_sRGB: return gl.RGB;
    case Gfx.TexelFormat.U8x4: return gl.RGBA;
    case Gfx.TexelFormat.U8x4_sRGB: return gl.RGBA;
    case Gfx.TexelFormat.U10_10_10_2: return gl.RGBA;
    case Gfx.TexelFormat.F16: return gl.RED;
    case Gfx.TexelFormat.F16x2: return gl.RG;
    case Gfx.TexelFormat.F16x4: return gl.RGBA;
    case Gfx.TexelFormat.F32x2: return gl.RG;
    case Gfx.TexelFormat.F32x4: return gl.RGBA;
    case Gfx.TexelFormat.F11_11_10: return gl.RGB;
    case Gfx.TexelFormat.Depth32: return gl.DEPTH_COMPONENT;
    case Gfx.TexelFormat.Depth24Stencil8: return gl.DEPTH_STENCIL;
    default: return error(`Unsupported texel format: ${format}`);    
  }
}

function TranslateGfxTexelFormatToInternalFormat(format: Gfx.TexelFormat) {
  switch (format) {
    case Gfx.TexelFormat.U565: return gl.RGB565;
    case Gfx.TexelFormat.U8: return gl.R8;
    case Gfx.TexelFormat.U8_sRGB: return gl.R8;
    case Gfx.TexelFormat.U8x2: return gl.RG8;
    case Gfx.TexelFormat.U8x2_sRGB: return gl.RG8;
    case Gfx.TexelFormat.U8x3: return gl.RGB8;
    case Gfx.TexelFormat.U8x3_sRGB: return gl.RGB8;
    case Gfx.TexelFormat.U8x4: return gl.RGBA8;
    case Gfx.TexelFormat.U8x4_sRGB: return gl.RGBA8;
    case Gfx.TexelFormat.U10_10_10_2: return gl.RGB10_A2;
    case Gfx.TexelFormat.F16: return gl.R16F;
    case Gfx.TexelFormat.F16x2: return gl.RG16F;
    case Gfx.TexelFormat.F16x3: return gl.RGB16F;
    case Gfx.TexelFormat.F16x4: return gl.RGBA16F;
    case Gfx.TexelFormat.F32x2: return gl.RG32F;
    case Gfx.TexelFormat.F32x3: return gl.RGB32F;
    case Gfx.TexelFormat.F32x4: return gl.RGBA32F;
    case Gfx.TexelFormat.Depth32: return gl.DEPTH_COMPONENT32F;
    case Gfx.TexelFormat.Depth24Stencil8: return gl.DEPTH24_STENCIL8;
    default: return error(`Unsupported texel format: ${format}`);  
  }
}

function TranslateGfxTexelFormatToType(format: Gfx.TexelFormat): GLInt {
  switch (format) {
    case Gfx.TexelFormat.Undefined: return 0;
    case Gfx.TexelFormat.U565: return gl.UNSIGNED_SHORT_5_6_5;
    case Gfx.TexelFormat.U8: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U8_sRGB: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U8x2: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U8x2_sRGB: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U8x3: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U8x3_sRGB: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U8x4: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U8x4_sRGB: return gl.UNSIGNED_BYTE;
    case Gfx.TexelFormat.U10_10_10_2: return gl.RGBA;
    case Gfx.TexelFormat.F11_11_10: return gl.FLOAT;
    case Gfx.TexelFormat.F16: return gl.HALF_FLOAT;
    case Gfx.TexelFormat.F16x2: return gl.HALF_FLOAT;
    case Gfx.TexelFormat.F16x4: return gl.HALF_FLOAT;
    case Gfx.TexelFormat.F32x2: return gl.FLOAT;
    case Gfx.TexelFormat.F32x4: return gl.FLOAT;
    case Gfx.TexelFormat.Depth32: return gl.FLOAT;
    case Gfx.TexelFormat.Depth24Stencil8: return gl.UNSIGNED_INT_24_8;
    default: return error(`Unsupported texel format: ${format}`);   
  }
}

function TranslateGfxTextureFilter(filter: Gfx.TextureFilter) {
  switch (filter) {
    case Gfx.TextureFilter.Nearest: return gl.NEAREST;
    case Gfx.TextureFilter.Linear: return gl.LINEAR;
    default: return error(`Unsupported texture filter: ${filter}`);
  }
}

function TranslateGfxTextureWrap(wrap: Gfx.TextureWrap) {
  switch (wrap) {
    case Gfx.TextureWrap.Clamp: return gl.CLAMP_TO_EDGE;
    case Gfx.TextureWrap.Repeat: return gl.REPEAT;
    default: return error(`Unsupported texture wrap: ${wrap}`);
  }
}

function TranslateGfxCullMode(cullMode: Gfx.CullMode): GLInt {
  switch (cullMode) {
    case Gfx.CullMode.None: return gl.NONE;
    case Gfx.CullMode.Back: return gl.BACK;
    case Gfx.CullMode.Front: return gl.FRONT;
    default: return error(`Unsupported culling mode: ${cullMode}`);   
  }
}

function TranslateBlendFactor(blendFactor: Gfx.BlendFactor): GLInt {
  switch (blendFactor) {
    case Gfx.BlendFactor.Zero: return gl.ZERO;
    case Gfx.BlendFactor.One: return gl.ONE;
    case Gfx.BlendFactor.Source: return gl.SRC_ALPHA;
    case Gfx.BlendFactor.OneMinusSource: return gl.ONE_MINUS_SRC_ALPHA;
    default: return error(`Unsupported blend factor: ${blendFactor}`);   
  }
}

// --------------------------------------------------------------------------------
// Objects
// -------------------------------------------------------------------------------*/
interface ShaderReflection {
  attributes: {
    [name: string]: {
      count: number,
      components: number,
      location: number,
      type: Gfx.Type,
      glType: GLInt,
    };
  }

  uniforms: Array<{
    name: string,
    count: number,
    size: number,
    type: Gfx.Type,
    location: GLUniformLocation,
  }>

  textures: {
    [name: string]: {
      name: string,
      count: number,
      type: Gfx.Type,
      location: number,
      locationGl: GLUniformLocation,
    }
  }
  textureArray: Array<ShaderReflection['textures'][0]>,
  textureCount: number,
}

interface Shader {
  name: string,
  glProgram: GLInt,
  reflection: ShaderReflection,
  uniformVals: { [name: string]: Float32Array },
}

interface UniformLayout {
  [name: string]: {
    index: number,
    offset: number,
  }
}

interface Buffer {
  name: string,
  target: GLInt,
  usage: Gfx.Usage,
  type: Gfx.BufferType,
  size: number,
  glId?: GLInt 

  // On WebGL1, Uniform buffers are emulated with CPU memory
  cpuBuffer?: Uint8Array,
}

interface BufferView {
  buffer: Buffer,
  offset: number,
}

interface Texture {
  target: GLInt,
  format: GLInt,
  internalFormat: GLInt,
  type: GLInt,
  usage: Gfx.Usage,
  width: number,
  height: number,
  glId: GLInt,
}

interface RenderPipeline {
  shader: Shader,
  renderFormat: Gfx.RenderFormat, 
  vertexLayout: Gfx.VertexLayout,
  resourceLayout: Gfx.ShaderResourceLayout,
  uniformLayout: UniformLayout,
}

interface VertexTable {
  pipeline: RenderPipeline,
  vao?: GLInt, 

  buffers: BufferView[],
}

interface ResourceTable {
  layout: Gfx.ResourceLayout,

  buffers: BufferView[],
  textures: (Texture | null)[],
}

interface RenderPass {
  name: string,
  glFramebuffer?: GLInt,
  width: number,
  height: number,
}

interface DepthStencilState {
  depthTestEnabled: boolean,
  depthWriteEnabled: boolean,
  depthCompareFunc: GLInt,
}

// --------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------*/
function assert(predicate: boolean, msg = 'Assert failed'): never | void {
  if (!predicate) error(msg);
}

function error(message: string): never {
  console.error(message);
  throw new Error(message);
}

function defaultValue<T>(v: T | undefined, fallback: T): T {
    return (v !== undefined) ? v : fallback;
}

function defined<T>(x: (T | undefined | null)): x is T {
  return x !== undefined && x !== null;
}

function isImage(v: any): v is (HTMLImageElement | HTMLCanvasElement | ImageBitmap) {
  return v.height !== undefined;
}

function checkErrors() {
  // Do something
}

function reflectShader(program: GLInt): ShaderReflection {
  const textures: ShaderReflection["textures"] = {}; 
  const textureArray: ShaderReflection["textureArray"] = []; 
  const uniforms: ShaderReflection["uniforms"] = []; 
  const attributes: ShaderReflection["attributes"] = {}; 

  let texTableOffset = 0;

  // Discover attributes
  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  assert(attributeCount < Gfx.kMaxShaderAttributes);
  for (let i = 0; i < attributeCount; i++) {
    const info = gl.getActiveAttrib(program, i);
    const type = TranslateGlType(info.type);
    attributes[info.name] = {
      location: i,
      count: info.size,
      components: TranslateTypeToComponentCount(type),
      glType: TranslateTypeToBaseGlType(type),
      type,
    }
  }

  // Discover uniforms and textures
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  assert(uniformCount < Gfx.kMaxShaderUniforms);
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(program, i);
    const type = TranslateGlType(info.type);

    // For array uniforms, WebGL will suffix the name with "[0]". Remove it for easier parsing
    const name = info.name.replace('[0]', '');

    // Store textures separately so that they can be bound to consecutive texture units based on their index
    const isTexture = type >= Gfx.TextureType.Texture2D && type <= Gfx.TextureType.TextureCube;
    if (isTexture) {
      const tex = {
        name: name,
        count: info.size,
        type: type,
        location: texTableOffset,
        locationGl: gl.getUniformLocation(program, info.name),
      };

      // Handle texture array uniforms. This property maps the uniform and array indices to a texture unit
      texTableOffset += info.size;

      textures[name] = tex;
      textureArray.push(tex);
    } else {
      const desc = {
        name: name,
        count: info.size,
        type: type,
        size: Gfx.TranslateTypeToSize(type) * info.size,
        location: gl.getUniformLocation(program, info.name),
      };

      uniforms.push(desc);
    }
  }

  const reflection = { attributes, uniforms, textures, textureArray, textureCount: texTableOffset };
  return reflection;
}

function addLineNumbersToString(str: string) {
  return str.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n');
}

function compileShader(name: string, type: GLInt, source: string): GLInt {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const typeString = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
    const sourceWithLineNumbers = addLineNumbersToString(source);
    console.error(sourceWithLineNumbers);
    error(`${typeString} compilation failed for shader ${name}:\n  ${gl.getShaderInfoLog(shader)}. See source above.`);
  }
  return shader;
}

function createProgramFromSource(name: string, vsSource: string, fsSource: string): GLInt {
  const vs = compileShader(name, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(name, gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram(); 
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    error(`Linking failed for shader ${name}:\n  ${gl.getProgramInfoLog(program)}`);
  }

  return program;
}

function bindBufferVertexAttributes(pipeline: RenderPipeline, bufferWithOffset: BufferView, index: number) {
  const vertLayout = pipeline.vertexLayout;
  const bufferDesc = vertLayout.buffers[index];
  const shaderRefl = pipeline.shader.reflection;

  const bufferAttribNames = Object.keys(bufferDesc.layout);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufferWithOffset.buffer.glId);

  for (let i = 0; i < bufferAttribNames.length; i++) {
    const bufferAttrib = bufferDesc.layout[bufferAttribNames[i]];
    const shaderAttrib = shaderRefl.attributes[bufferAttribNames[i]];
    
    // Ignore attributes in this buffer if they aren't needed by the shader
    if (!defined(shaderAttrib)) continue;

    // The buffer is being unset, so disable all attributes that it supplies
    if (!bufferWithOffset.buffer) {
      gl.disableVertexAttribArray(shaderAttrib.location);     
    } else {
      const type = TranslateTypeToBaseGlType(bufferAttrib.type);
      const normalized = isTypeNormalized(bufferAttrib.type);

      gl.enableVertexAttribArray(shaderAttrib.location);
      gl.vertexAttribPointer(shaderAttrib.location, shaderAttrib.components, type, normalized, bufferDesc.stride, bufferAttrib.offset + bufferWithOffset.offset);

      if (bufferDesc.stepMode === Gfx.StepMode.Instance) {
        if (gl.instancedArrays) gl.instancedArrays.vertexAttribDivisorANGLE(shaderAttrib.location, 1);
        else gl.vertexAttribDivisor(shaderAttrib.location, 1);
      }
    }
  }
}

function detectSupportedFeatures(webGlVersion: number) {
  let featureFlags = 0;
  let ext: any;

  // Detect supported features by attempting to enable each GL extension
  if (ext = gl.getExtension('OES_vertex_array_object')) {
    featureFlags |= Gfx.Feature.VertexArrayObject;
    gl.createVertexArray = ext.createVertexArrayOES.bind(ext);
    gl.deleteVertexArray = ext.deleteVertexArrayOES.bind(ext);
    gl.bindVertexArray = ext.bindVertexArrayOES.bind(ext);
  }
  
  if (ext = gl.getExtension('OES_texture_half_float')) { 
    featureFlags |= Gfx.Feature.TextureHalf;
    gl.HALF_FLOAT = ext.HALF_FLOAT_OES;
  }

  if (ext = (
    gl.getExtension('EXT_texture_filter_anisotropic') ||
    gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
    gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
  )) {
    featureFlags |= Gfx.Feature.AnistropicFiltering;
    gl.MAX_TEXTURE_MAX_ANISOTROPY_EXT = ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT;
    gl.TEXTURE_MAX_ANISOTROPY_EXT = ext.TEXTURE_MAX_ANISOTROPY_EXT;
  }

  if (gl.getExtension('OES_texture_float')) featureFlags |= Gfx.Feature.TextureFloat;
  if (gl.getExtension('OES_texture_float_linear')) featureFlags |= Gfx.Feature.TextureFloatLinearFiltering;
  if (gl.getExtension('OES_texture_half_float_linear')) featureFlags |= Gfx.Feature.TextureHalfLinearFiltering;

  if (gl.getExtension('OES_standard_derivatives')) featureFlags |= Gfx.Feature.ShaderDerivatives;

  if (gl.texSubImage2D) { featureFlags |= Gfx.Feature.TextureWrite; }

  if (gl.instancedArrays = gl.getExtension('ANGLE_instanced_arrays')) {
    featureFlags |= Gfx.Feature.Instancing;
  }

  // Add features that are supported by default in our WebGL version
  featureFlags |= Gfx.Feature.ShaderGlsl100;
  if( webGlVersion >= 2 ) {
    featureFlags |= Gfx.Feature.VertexArrayObject;
    featureFlags |= Gfx.Feature.TextureFloat;
    featureFlags |= Gfx.Feature.TextureHalf;
    featureFlags |= Gfx.Feature.Instancing;
    featureFlags |= Gfx.Feature.ShaderGlsl300;
  }

  return featureFlags;
}

function isTextureResourceBinding(binding: Gfx.ResourceBinding): binding is Gfx.TextureResourceBinding {
    return (binding as Gfx.TextureResourceBinding).type === Gfx.BindingType.Texture;
}

// --------------------------------------------------------------------------------
// Pool
// -------------------------------------------------------------------------------*/
class Pool<ObjectType> {
  objects: ObjectType[] = [];
  freeList: Gfx.Id[] = [];
  count: number = 0;

  get(id: Gfx.Id): ObjectType {
    const obj = this.objects[id];
    assert(obj !== undefined, 'Invalid ID');
    return obj;
  }

  create(obj: ObjectType): Gfx.Id {
    ++this.count;
    if (this.freeList.length > 0) {
      const id = this.freeList.pop()!;
      this.objects[id] = obj;
      return id;
    } else {
      this.objects.push(obj);
      return this.objects.length - 1;
    }
  }

  delete(id: Gfx.Id): void {
    --this.count;
    delete this.objects[id];
    this.freeList.push(id);
  }
}

// --------------------------------------------------------------------------------
// WebGL Renderer
// -------------------------------------------------------------------------------*/
export class WebGlRenderer implements Gfx.Renderer {
  debugEnabled: boolean = false;

  buffers: Pool<Buffer> = new Pool();
  textures: Pool<Texture> = new Pool();
  shaders: Pool<Shader> = new Pool();
  renderPipelines: Pool<RenderPipeline> = new Pool();
  resourceTables: Pool<ResourceTable> = new Pool();
  vertexTables: Pool<VertexTable> = new Pool();
  renderPasses: Pool<RenderPass> = new Pool();
  depthStencilStates: Pool<DepthStencilState> = new Pool();

  defaultRenderPass: Gfx.Id;
  defaultTexture: Texture;

  webGlVersion: number;
  featureFlags: number;

  maxAnisotropy: number;

  pipeline: RenderPipeline;
  current: {
    shader?: Shader,
    cullMode?: GLInt,
    blending?: boolean,
    srcBlendFactor?: Gfx.BlendFactor,
    dstBlendFactor?: Gfx.BlendFactor,
    depthStencil?: DepthStencilState,
  }

  initialize(canvas: HTMLCanvasElement): boolean {
    const canvasOptions = { alpha: false, antialias: false, preserveDrawingBuffer: false };

    // Attempt to use WebGL2, buf fallback to WebGL if needed
    gl = canvas.getContext('webgl2', canvasOptions);
    if (!gl) gl = canvas.getContext('webgl', canvasOptions);
    if (!gl) return false;

    this.webGlVersion = (gl instanceof WebGLRenderingContext) ? 1 : 2;
    console.debug(`Initialized WebGL${this.webGlVersion} context`);

    // Detect supported features
    this.featureFlags = detectSupportedFeatures(this.webGlVersion);

    // Create the default RenderPass which draws to the backbuffer
    // @NOTE: The width and height will be set on resize
    this.defaultRenderPass = this.renderPasses.create({ name: 'Default', width: canvas.width, height: canvas.height });
    assert(this.defaultRenderPass === Gfx.kDefaultRenderPass);

    // Shadow GL state to avoid unnecessary API calls
    this.current = {}!

    // Set a default clear color
    gl.clearColor(0, 0, 0, 1);

    // Create a default texture to use when null is assigned to a resource table
    const black = new Uint8Array([0, 0, 0, 1]);
    const defaultTexDesc = {
      usage: Gfx.Usage.Static,
      type: Gfx.TextureType.Texture2D,
      format: Gfx.TexelFormat.U8x4,
      width: 1,
      height: 1,
    }
    const defaultTextureId = this.createTexture('DefaultTexture', defaultTexDesc, black);
    this.defaultTexture = this.textures.get(defaultTextureId);

    // If anistropic filtering is supported, discover what the limit is
    if (this.isGfxFeatureSupported(Gfx.Feature.AnistropicFiltering)) {
      this.maxAnisotropy = gl.getParameter(gl.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    }

    // Disable automatic PNG/JPEG color space conversion
    // See https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#images
    // and https://www.khronos.org/webgl/public-mailing-list/public_webgl/1010/msg00037.php
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    return true;
  }

  isGfxFeatureSupported(featureId: Gfx.Feature): boolean {
    return !!(this.featureFlags & featureId);
  }

  setDebugEnabled(enabled: boolean) {
    this.debugEnabled = enabled;
  }

  resize(width: number, height: number) {
    const renderPass = this.renderPasses.get(this.defaultRenderPass);
    renderPass.width = width;
    renderPass.height = height;
  }

  beginFrame(): void {
  }

  endFrame(): void {
  }

  bindRenderPass(renderPassId: Gfx.Id): void {
    const pass = this.renderPasses.get(renderPassId);

    gl.bindFramebuffer(gl.FRAMEBUFFER, pass.glFramebuffer);
    gl.viewport(0, 0, pass.width, pass.height);

    // @TODO: Support custom clear colors, depths, and stencil
    // @TODO: The below...
    // @NOTE: Color and Depth writes must be enabled for clear calls to work
    // setColorWrite(&m_currentPipelineState, true, true);
    // setDepthWrite(&m_currentDynamicState, true);

    // Clear Color, Depth, and Stencil buffers
    // @TODO: Clear flags in the RenderPass
    const clearMask = gl.COLOR_BUFFER_BIT;
    // if (pass.clearDepth) clearMask |= gl.DEPTH_BUFFER_BIT;
    // if (pass.clearStencil) clearMask |= gl.STENCIL_BUFFER_BIT;
    gl.clear(clearMask);
  }

  bindPipeline(pipelineId: Gfx.Id): void {
    const pipeline = this.renderPipelines.get(pipelineId);
    this.pipeline = pipeline;
    if (this.current.shader !== pipeline.shader) {
      gl.useProgram(pipeline.shader.glProgram);
      this.current.shader = pipeline.shader;
    }

    // Enable/Disable alpha blending
    if (pipeline.renderFormat.blendingEnabled != this.current.blending) {
      this.current.blending = pipeline.renderFormat.blendingEnabled;
      if(pipeline.renderFormat.blendingEnabled) { gl.enable( gl.BLEND ); }
      else { gl.disable( gl.BLEND ); }
    }

    // ... and set blending factors
    if (this.current.blending && (this.current.srcBlendFactor != pipeline.renderFormat.srcBlendFactor ||
                                  this.current.dstBlendFactor != pipeline.renderFormat.dstBlendFactor)) 
    {
      this.current.srcBlendFactor = defaultValue(pipeline.renderFormat.srcBlendFactor, Gfx.BlendFactor.One);
      this.current.dstBlendFactor = defaultValue(pipeline.renderFormat.dstBlendFactor, Gfx.BlendFactor.OneMinusSource);
      gl.blendFunc(TranslateBlendFactor(this.current.srcBlendFactor), TranslateBlendFactor(this.current.dstBlendFactor));
    }

    // @TODO: Support more Blending properties and Color Writes
    // setColorWrite(&m_currentPipelineState, pipeline.state.colorWrite, pipeline.state.alphaWrite);
    // setBlendEquation(&m_currentPipelineState, pipeline.state.blendModeRGB, pipeline.state.blendModeAlpha);
  }

  draw(primitiveType: Gfx.PrimitiveType, indexBufferId: Gfx.Id, indexType: Gfx.Type, indexOffset: number, indexCount: number) {
    const glPrimType = TranslatePrimitiveType(primitiveType);
    const glIndexType = TranslateIndexTypeToGlType(indexType);
    const glIndexSize = Gfx.TranslateTypeToSize(indexType);

    const indexBuf = this.buffers.get(indexBufferId);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf.glId);
    gl.drawElements(glPrimType, indexCount, glIndexType, indexOffset * glIndexSize);
  }

  drawInstanced(primitiveType: Gfx.PrimitiveType, indexBufferId: Gfx.Id, indexType: Gfx.Type, indexOffset: number, indexCount: number, instanceCount: number) {
    const glPrimType = TranslatePrimitiveType(primitiveType);
    const glIndexType = TranslateIndexTypeToGlType(indexType);
    const glIndexSize = Gfx.TranslateTypeToSize(indexType);

    const indexBuf = this.buffers.get(indexBufferId);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf.glId);
    if (gl.instancedArrays) gl.instancedArrays.drawElementsInstancedANGLE(glPrimType, indexCount, glIndexType, indexOffset * glIndexSize, instanceCount);
    else gl.drawElementsInstanced(glPrimType, indexCount, glIndexType, indexOffset * glIndexSize, instanceCount);
  }

  drawNonIndexed(primitiveType: Gfx.PrimitiveType, vertOffset: number, vertCount: number) {
    const glPrimType = TranslatePrimitiveType(primitiveType);
    gl.drawArrays(glPrimType, vertOffset, vertCount);
  }

  setDepthStencilState(stateId: Gfx.Id): void {
    const newState = this.depthStencilStates.get(stateId);
    const oldState = this.current.depthStencil;

    if (!oldState || newState.depthWriteEnabled != oldState.depthWriteEnabled) { gl.depthMask(newState.depthWriteEnabled); }
    if (!oldState || newState.depthCompareFunc != oldState.depthCompareFunc) { gl.depthFunc(newState.depthCompareFunc); }
    if (!oldState || newState.depthTestEnabled != oldState.depthTestEnabled) { 
      newState.depthTestEnabled ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
    }

    this.current.depthStencil = newState;
  }

  setCullMode(cullMode: Gfx.CullMode) {
    if (this.current.cullMode != cullMode) {
      this.current.cullMode = cullMode;
      if( cullMode == Gfx.CullMode.None ) { gl.disable( gl.CULL_FACE ); }
      else { gl.enable( gl.CULL_FACE ); gl.cullFace( TranslateGfxCullMode( cullMode ) ); }
    }
  }

  createDepthStencilState(desc: Gfx.DepthStateDescriptor) {
    // @TODO: Support stencil state
    const glCompareFunc = TranslateCompareFunc(defaultValue(desc.depthCompareFunc, Gfx.CompareFunc.Less));
    return this.depthStencilStates.create({ 
      depthTestEnabled: desc.depthTestEnabled, 
      depthWriteEnabled: desc.depthWriteEnabled, 
      depthCompareFunc: glCompareFunc });
  }

  createVertexTable(pipelineId: Gfx.Id): Gfx.Id {
    const pipeline = this.renderPipelines.get(pipelineId);

    let vao = null;
    if (this.isGfxFeatureSupported(Gfx.Feature.VertexArrayObject)) {
      vao = gl.createVertexArray();
    }

    return this.vertexTables.create({ pipeline, vao, buffers: [] });
  }

  removeVertexTable(tableId: Gfx.Id): void {
    if (this.isGfxFeatureSupported(Gfx.Feature.VertexArrayObject)) {
      const table = this.vertexTables.get(tableId);
      gl.deleteVertexArray(table.vao);
    }

    this.vertexTables.delete(tableId);
  }

  createResourceTable(layout: Gfx.ResourceLayout): Gfx.Id {
    return this.resourceTables.create({ layout, buffers: [], textures: [] });
  }

  removeResourceTable(tableId: Gfx.Id): void {
    this.resourceTables.delete(tableId);
  }

  bindVertices(vertexTableId: Gfx.Id): void {
    const table = this.vertexTables.get(vertexTableId);
    
    if (this.debugEnabled) {
      const shaderName = table.pipeline.shader.name;

      // Ensure that all necessary vertex buffers are set
      const bufCount = table.pipeline.vertexLayout.buffers.length;
      for (let i = 0; i < bufCount; i++) {
        assert(defined(table.buffers[i]), `Shader ${shaderName} expects a vertex buffer bound at slot ${i}`);
      }
    }

    // Bind Vertex Attributes
    if (this.isGfxFeatureSupported(Gfx.Feature.VertexArrayObject)) 
    {
      gl.bindVertexArray(table.vao);
    } else {
      for (let i = 0; i < table.buffers.length; i++) {
        bindBufferVertexAttributes(table.pipeline, table.buffers[i], i);
      }
    }
  }
  
  bindResources(resourceTableId: Gfx.Id): void {
    const table = this.resourceTables.get(resourceTableId);
    const uniLayout = this.pipeline.uniformLayout;
    const shaderRefl = this.pipeline.shader.reflection;
    const shaderName = this.pipeline.shader.name;
  
    // Bind Uniforms
    for (let i = 0; i < shaderRefl.uniforms.length; i++) {
      const def = shaderRefl.uniforms[i];
      const layout = uniLayout[def.name];
      const cpuBuf = table.buffers[layout.index].buffer.cpuBuffer;
      assert(defined(cpuBuf));

      const value = new Float32Array(cpuBuf!.buffer, layout.offset, def.size / 4); 

      // GL Uniform calls are very expensive, but uniforms are saved per shader program.
      const oldVal = this.pipeline.shader.uniformVals[def.name];
      let changed = !value.every((valI, i) => valI === oldVal[i]);

      // Only re-set the uniform if the value has changed from the current GL uniform value
      if (changed) {
        this.pipeline.shader.uniformVals[def.name].set(value);
        switch ( def.type )
        {
          case Gfx.Type.Float: gl.uniform1fv(def.location, value ); break;
          case Gfx.Type.Float2: gl.uniform2fv(def.location, value ); break;
          case Gfx.Type.Float3: gl.uniform3fv(def.location, value ); break;
          case Gfx.Type.Float4: gl.uniform4fv(def.location, value ); break;
          case Gfx.Type.Float3x3: gl.uniformMatrix3fv(def.location, false, value ); break;
          case Gfx.Type.Float4x4: gl.uniformMatrix4fv(def.location, false, value ); break;
          default: error('Unknown shader uniform type'); break;
        }
      }
    }
    
    // Bind Textures
    for (let i = 0; i < shaderRefl.textureArray.length; i++) {
      const texRefl = shaderRefl.textureArray[i];
      const slot = uniLayout[texRefl.name].index;

      if (table.textures[slot] === undefined) {
        console.warn(`Shader ${shaderName} expects texture "${texRefl.name}" (index ${slot}) to be bound`);
      }

      // Assume a texture array, bind to sequential texture units starting at the assigned unit
      for (let i = 0; i < texRefl.count; i++) {
        // @NOTE: Binding null will bind the default texture
        const tex = table.textures[slot + i] || this.defaultTexture;
        const unit = texRefl.location + i;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(tex.target, tex.glId);
      }
    }
  }

  setVertexBuffer(vertexTableId: Gfx.Id, index: number, view: Gfx.BufferView): void {
    const table = this.vertexTables.get(vertexTableId);
    const buffer = this.buffers.get(view.buffer);
    const bufferWithOffset: BufferView = { buffer, offset: view.byteOffset || 0 };
    assert(index < Gfx.kMaxShaderVertexBuffers);

    table.buffers[index] = bufferWithOffset;

    // Configure the VAO if supported. It will then be rebound before drawing by BindResources()
    if (this.isGfxFeatureSupported(Gfx.Feature.VertexArrayObject)) {
      gl.bindVertexArray(table.vao);
      bindBufferVertexAttributes(table.pipeline, bufferWithOffset, index);
    }
  }

  setBuffer(resourceTableId: Gfx.Id, index: number, view: Gfx.BufferView) {
    const table = this.resourceTables.get(resourceTableId) as ResourceTable;
    const buffer = this.buffers.get(view.buffer);
    table.buffers[index] = { buffer, offset: view.byteOffset || 0 };
  }

  setTexture(resourceTableId: Gfx.Id, index: number, textureId: Gfx.Id) {
    const table = this.resourceTables.get(resourceTableId) as ResourceTable;
    const texture = textureId ? this.textures.get(textureId) : null;
    table.textures[index] = texture;
  }

  setTextures(resourceTableId: Gfx.Id, index: number, textureIds: Gfx.Id[]) {
    const table = this.resourceTables.get(resourceTableId) as ResourceTable;
    for (let i = 0; i < textureIds.length; i++) {
      const texture = textureIds[i] ? this.textures.get(textureIds[i]) : null;
      table.textures[index + i] = texture;    
    }
  }
    

  writeBufferData(bufferId: Gfx.Id, dstOffset: number, srcData: (ArrayBuffer | ArrayBufferView)) {
    const buffer = this.buffers.get(bufferId);

    if (buffer.type === Gfx.BufferType.Uniform) {
      const srcBuffer = ArrayBuffer.isView(srcData) ? srcData.buffer : srcData;
      const srcBytes = new Uint8Array(srcBuffer);
      if (defined(buffer.cpuBuffer)) buffer.cpuBuffer.set(srcBytes, dstOffset);
      else error(`No CPU buffer assigned to uniform buffer`);
    } else {
      gl.bindBuffer(buffer.target, buffer.glId);
      gl.bufferSubData(buffer.target, dstOffset, srcData);
    }
  }

  createRenderPipeline(shaderId: Gfx.Id, renderFormat: Gfx.RenderFormat, vertexLayout: Gfx.VertexLayout, resourceLayout: Gfx.ShaderResourceLayout): Gfx.Id {
    const shader = this.shaders.get(shaderId);

    // For convenience, extract the resource bindings as an array
    const resourceNames = Object.keys(resourceLayout);
    const resourceList = resourceNames.map(name => resourceLayout[name]);
    const reflection = shader.reflection;

    if (this.debugEnabled) {
      // Ensure that a full ShaderResourceLayout has been passed and provides uniform locations within each uniform buffer
      for (const name of resourceNames) {
        const resourceBinding = resourceLayout[name];
        if (resourceBinding.type === Gfx.BindingType.UniformBuffer) {
          assert((resourceBinding as Gfx.UniformBufferResourceBinding).layout !== undefined, 
            `A BufferLayout must be provided for UniformBuffer "${name}" in the ResourceLayout passed to createRenderPipeline()` +
            'to define uniform binding locations. In WebGL2/GLSL300 it may be possible to define binding locations completely within the shader'
          );    
        }
      }

      // Ensure that all uniforms are defined in the resourceLayout
      for (let i = 0; i < reflection.uniforms.length; i++) {
        const uniform = reflection.uniforms[i];
        const binding = resourceList.find(l => !isTextureResourceBinding(l) && l.layout && l.layout[uniform.name]) as Gfx.UniformBufferResourceBinding;
        assert(binding !== undefined, `Shader '${shader.name}' expects uniform '${uniform.name}' to be set in a uniform buffer`);
        const type = binding.layout[uniform.name].type;
        assert(type === uniform.type, `Shader '${shader.name}' expects uniform '${uniform.name}' to be type ${uniform.type} but the ShaderResourceLayout specifies type ${type}`);
        if (uniform.count > 1) {
          const count = binding.layout[uniform.name].count;
          assert(count !== undefined, `Shader '${shader.name}' expects uniform '${uniform.name}' to be an array but the ShaderResourceLayout specifies a scalar value`);
          assert(count! >= uniform.count, `Shader '${shader.name}' expects uniform '${uniform.name}' to be an array of length ${uniform.count} but the ShaderResourceLayout specifies a length of ${count}`);
        }
      }

      // Ensure that all textures are defined in the resourceLayout
      // @TODO: ShaderReflection should treat textures and uniforms the same
      for (let i = 0; i < reflection.textureArray.length; i++) {
        const uniRefl = reflection.textureArray[i];
        const binding = resourceList.find((l, i) => isTextureResourceBinding(l) && resourceNames[i] === uniRefl.name) as Gfx.TextureResourceBinding;
        assert(binding !== undefined, `Shader '${shader.name}' expects texture '${uniRefl.name}', but it is not defined in the ShaderResourceLayout`);
        assert((binding.count || 1) === uniRefl.count, `Shader '${shader.name}' expects texture '${uniRefl.name}' to be an array of length ${uniRefl.count}, but the ResourceLayout specifies length ${binding.count}`);
      }

      // Ensure the vertexLayout supplies all Attributes required by the Shader
      const requiredAttrs = Object.keys(reflection.attributes);
      requiredAttrs.forEach(a => {
        const attrBuf = vertexLayout.buffers.find(buffer => buffer && buffer.layout[a] !== undefined);
        assert(attrBuf !== undefined, `VertexLayout does not supply attribute ${a} required by Shader '${shader.name}'`);
      });

      if (!this.isGfxFeatureSupported(Gfx.Feature.Instancing)) {
        vertexLayout.buffers.forEach(buffer => {
          assert(buffer.stepMode !== Gfx.StepMode.Instance, "Instancing is not supported by this WebGL context")
        })
      } 
    }

    // Map individual uniforms to the locations in the bound uniform buffers
    const uniformLayout = {} as UniformLayout;
    for (let i = 0; i < reflection.uniforms.length; i++) {
      const uniform = reflection.uniforms[i];
      const binding = resourceList.find(l => !isTextureResourceBinding(l) && l.layout && l.layout[uniform.name]) as Gfx.UniformBufferResourceBinding;
      uniformLayout[uniform.name] = { offset: binding.layout[uniform.name].offset, index: binding.index };
    }
    for (let i = 0; i < reflection.textureArray.length; i++) {
      const uniform = reflection.textureArray[i];
      const binding = resourceLayout[uniform.name];
      uniformLayout[uniform.name] = { offset: 0, index: binding.index };
    }

    return this.renderPipelines.create({ shader, renderFormat, vertexLayout, resourceLayout, uniformLayout });
  }

  removeRenderPipeline(pipelineId: Gfx.Id): void  {
    this.renderPipelines.delete(pipelineId);
  }

  createShader(desc: Gfx.ShaderDescriptor) {
    return this._createShader(desc.name, desc.vertSource, desc.fragSource);
  }

  _createShader(name: string, vsIn: string | string[], fsIn: string | string[]): number {
    // If the sources are arrays, join them with line directives so that error line numbers are still readable
    const vs = vsIn instanceof Array ? vsIn.join('\n#line 0\n') : vsIn;
    const fs = fsIn instanceof Array ? fsIn.join('\n#line 0\n') : fsIn;

    // Compile and link the shader
    const glProgram = createProgramFromSource(name, vs, fs);
    const reflection = reflectShader(glProgram);

    // Allocate space to shadow each uniform value
    const uniformVals = {} as { [name: string]: Float32Array };
    for (let i = 0; i < reflection.uniforms.length; i++) {
      const def = reflection.uniforms[i];
      uniformVals[def.name] = new Float32Array(def.size / 4);
    }

    // Assign each texture uniform to a consecutive texture unit (later set by glActiveTexture + glBindTexture).
    gl.useProgram( glProgram );
    const texUniformNames = Object.keys(reflection.textures);
    for (let i = 0; i < texUniformNames.length; i++) {
      const desc = reflection.textures[texUniformNames[i]];
      const tableIdxs = Array.from(Array(desc.count).keys()).map((_, idx) => desc.location + idx);
      gl.uniform1iv(desc.locationGl, tableIdxs);
    }

    // Update our shadow state to ensure that the correct shader gets re-bound
    this.current.shader = undefined;
    
    return this.shaders.create({ name, glProgram, reflection, uniformVals });
  }

  removeShader(shaderId: Gfx.Id): void {
    const shader = this.shaders.get(shaderId);
    gl.deleteProgram(shader.glProgram);
    this.shaders.delete(shaderId);
  }

  createTexture(name: string, desc: Gfx.TextureDescriptor, image?: HTMLImageElement | HTMLCanvasElement | ArrayBufferView | ImageBitmap): Gfx.Id {
    const isArrayBuffer = !image || (image as ArrayBufferView).buffer instanceof ArrayBuffer && (image as ArrayBufferView).byteLength !== undefined;
    const translateFormat = this.webGlVersion === 1 ? TranslateGfxTexelFormatWebGl1 : TranslateGfxTexelFormat;

    const tex = {
      target: TranslateGfxTextureType(desc.type),
      format: translateFormat(desc.format),
      internalFormat: this.webGlVersion > 1 ? TranslateGfxTexelFormatToInternalFormat(desc.format) : translateFormat(desc.format),
      type: TranslateGfxTexelFormatToType(desc.format),
      usage: desc.usage,
      width: isArrayBuffer ? defaultValue(desc.width, 1) : (image as HTMLImageElement).width,
      height: isArrayBuffer ? defaultValue(desc.height, 1) : (image as HTMLImageElement).height,
      depth: desc.depth || 1,
      minFilter: TranslateGfxTextureFilter((desc.defaultMinFilter !== undefined) ? desc.defaultMinFilter : Gfx.TextureFilter.Linear),
      magFilter: TranslateGfxTextureFilter((desc.defaultMagFilter !== undefined) ? desc.defaultMagFilter : Gfx.TextureFilter.Linear),
      wrapS: TranslateGfxTextureWrap((desc.defaultWrapS !== undefined) ? desc.defaultWrapS : Gfx.TextureWrap.Repeat),
      wrapT: TranslateGfxTextureWrap((desc.defaultWrapT !== undefined) ? desc.defaultWrapT : Gfx.TextureWrap.Repeat),
      glId: gl.createTexture(),
    }

    gl.bindTexture(tex.target, tex.glId);
    gl.texParameteri(tex.target, gl.TEXTURE_MIN_FILTER, tex.minFilter );
    gl.texParameteri(tex.target, gl.TEXTURE_MAG_FILTER, tex.magFilter );
    gl.texParameteri(tex.target, gl.TEXTURE_WRAP_S, tex.wrapS );
    gl.texParameteri(tex.target, gl.TEXTURE_WRAP_T, tex.wrapT );

    if (defined(desc.maxAnistropy) && desc.maxAnistropy > 1 && this.isGfxFeatureSupported(Gfx.Feature.AnistropicFiltering)) {
      const max = Math.min(this.maxAnisotropy, desc.maxAnistropy);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAX_ANISOTROPY_EXT, max);
    }

    // WebGL2 wants sized formats, but WebGL1 just wants RGB/RGBA
    const internalFormat = this.webGlVersion > 1 ? tex.internalFormat : tex.format; 

    if (desc.type === Gfx.TextureType.Texture3D) {
      gl.texImage3D(tex.target, 0, internalFormat, tex.width, tex.height, tex.depth, 0, tex.format, tex.type, image);
    } else {
      if (isArrayBuffer) {
        if (image instanceof ArrayBuffer) image = new Uint8Array(image);
        gl.texImage2D(tex.target, 0, internalFormat, tex.width, tex.height, 0, tex.format, tex.type, image);
      } else if (image !== undefined) {
        gl.texImage2D(tex.target, 0, internalFormat, tex.format, tex.type, image);
      } else {
        const hasSize = tex.width !== undefined && tex.height !== undefined;
        assert(hasSize, 'Image is null. If attempting to create an empty texture, width and height must be specified');
        gl.texImage2D(tex.target, 0, internalFormat, desc.width, desc.height, 0, tex.format, tex.type, null);
      }
    }

    return this.textures.create(tex);
  }

  writeTextureData(textureId: Gfx.Id, image: HTMLImageElement | HTMLCanvasElement | ArrayBuffer | ImageBitmap): void {
    const tex = this.textures.get(textureId);

    // assert(tex.usage !== Gfx.Usage.Static, 'Only non-static textures may be written to');
    assert(tex.target === gl.TEXTURE_2D, 'Currently only 2D textures may be written to');

    gl.bindTexture(tex.target, tex.glId);

    // If the size of the texture is being changed (which cannot happen via an ArrayBuffer input), 
    // Use texImage2D to re-initialize the storage
    const sizeChange = 
      isImage(image) ? image.width !== tex.width : false ||
      isImage(image) ? image.height !== tex.height : false;

    // Ideally we'd like to avoid creating a completely new resource (which texImage2D will do), but only if supported
    if (this.isGfxFeatureSupported(Gfx.Feature.TextureWrite) && !sizeChange) {
      if (!isImage(image)) {
        gl.texSubImage2D(tex.target, 0, 0, 0, tex.width, tex.height, tex.format, tex.type, image);
      } else {
        gl.texSubImage2D(tex.target, 0, 0, 0, tex.format, tex.type, image);
      }
    } else {
      gl.texImage2D(tex.target, 0, tex.internalFormat, tex.format, tex.type, image);
    }
  }

  removeTexture(textureId: Gfx.Id): void {
    const texture = this.textures.get(textureId);
    gl.deleteTexture(texture.glId);
    this.textures.delete(textureId);
  }

  createBuffer(name: string, type: Gfx.BufferType, usage: Gfx.Usage, dataOrSize: (ArrayBuffer | ArrayBufferView | number)) {
    assert( usage != Gfx.Usage.None );

    let cpuBuffer;    
    let glId;
    const target = TranslateGfxBufferType(type);

    // Typescript type guards
    const isSize = (dataOrSize: any): dataOrSize is number => Number.isInteger(dataOrSize as number);
    const isArrayBuffer = (dataOrSize: any): dataOrSize is ArrayBuffer => dataOrSize instanceof ArrayBuffer;

    const data = isSize(dataOrSize) ? null : dataOrSize;
    const size = isSize(dataOrSize) ? dataOrSize : dataOrSize.byteLength;
    assert( size > 0 || data !== null, `Either an ArrayBuffer or size must be provided`);

    if (type != Gfx.BufferType.Uniform) {
      glId = gl.createBuffer();
      gl.bindBuffer(target, glId);
      gl.bufferData(target, dataOrSize, usage == Gfx.Usage.Dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW );
    }
    else {
      // Uniform buffers are handled specially. Allocate the buffer on the CPU (map and unmap are nops),
      // and set the uniforms one by one at bind time.
      if (data) {
        const buffer = isArrayBuffer(data) ? data : data.buffer;
        const offset = isArrayBuffer(data) ? 0 : data.byteOffset;
        cpuBuffer = new Uint8Array(buffer, offset, size);
      } else {
        cpuBuffer = new Uint8Array(size);
      }
    }

    return this.buffers.create({ name, type, target, usage, size, glId, cpuBuffer });
  }

  removeBuffer(bufferId: Gfx.Id): void {
    const buffer = this.buffers.get(bufferId);
    if( buffer.type != Gfx.BufferType.Uniform ) {
      gl.deleteBuffer(buffer.glId);
    }
    
    this.buffers.delete(bufferId);
  }

  readPixels(offsetX: number, offsetY: number, width: number, height: number, result: Uint8Array): void {
    gl.readPixels(offsetX, offsetY, width, height, gl.RGBA, gl.UNSIGNED_BYTE, result);
  }
}