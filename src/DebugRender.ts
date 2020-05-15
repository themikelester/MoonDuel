import { UniformBuffer, computePackedBufferLayout } from './UniformBuffer';
import * as Gfx from './gfx/GfxTypes';
import { vec3, vec4, mat4, mat3 } from 'gl-matrix';
import { GlobalUniforms } from './GlobalUniforms';
import { defined, assert } from './util';
import { RenderPrimitive } from './RenderPrimitive';
import { renderLists } from './RenderList';

// ----------------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------------
interface Primitive {
  shader: Gfx.Id;
  pipeline: Gfx.Id;
  resources: Gfx.Id;
  vertTable: Gfx.Id;
  indexBuffer: Gfx.Id;
  vertexBuffer: Gfx.Id;
  depthState: Gfx.Id;
  uniforms: UniformBuffer;

  count: number;
}

// ----------------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------------
const kMaxPoints = 32 * 1024;
const kMaxObbs = 32;

const defaultObbColor = vec4.fromValues(1, 0, 0, 1);

const obbPrim = {} as Primitive;
const frustumPrim = {} as Primitive;
const pointsPrim = {} as Primitive;
const spherePrim = {} as Primitive;

// ----------------------------------------------------------------------------------
// Scratch
// ----------------------------------------------------------------------------------
const mat3Scratch = mat3.create();
const mat4Scratch = new Float32Array(16);
const vec3Scratch = vec3.create();
const floatScratch = new Float32Array(kMaxPoints * 6);

// ----------------------------------------------------------------------------------
// Shaders
// ----------------------------------------------------------------------------------
const obbVs = `
  precision highp float;

  attribute vec3 a_pos;

  uniform mat3 u_extents;
  uniform vec3 u_center;

  uniform mat4 g_viewProj;

  void main()
  {
    vec3 pos = u_center + u_extents * a_pos;
    gl_Position = g_viewProj * vec4(pos, 1.0);
  }
`;

const frustumVs = `
  precision highp float;

  attribute vec3 a_pos;

  uniform mat4 u_invViewProjRelativeToEye;
  uniform vec3 u_camPosHigh;
  uniform vec3 u_camPosLow;

  uniform mat4 g_viewProjRelativeToEye;
  uniform vec3 g_camPosHigh;
  uniform vec3 g_camPosLow;

  void main()
  {
    // Un-project back to world space
    vec4 worldPosRelativeToEye = u_invViewProjRelativeToEye * vec4(a_pos, 1.0);
    worldPosRelativeToEye /= worldPosRelativeToEye.w;

    // The position is relative to the old eye, transform it to the new eye space
    vec3 camDiffHigh = u_camPosHigh - g_camPosHigh;
    vec3 camDiffLow = u_camPosLow - g_camPosLow;
    worldPosRelativeToEye.xyz += camDiffHigh + camDiffLow;

    gl_Position = g_viewProjRelativeToEye * worldPosRelativeToEye;
  }
`;

const pointsVs = `
  precision highp float;

  attribute vec3 a_pos;
  attribute vec4 a_color;

  uniform mat4 g_viewProj;

  varying lowp vec4 v_color;

  void main()
  {
    v_color = a_color;

    gl_Position = g_viewProj * vec4(a_pos, 1.0);
    gl_PointSize = 4.0;
  }
`;

const pointsFs = `
  precision mediump float;
  varying lowp vec4 v_color;

  void main()
  {
    gl_FragColor = v_color;
  }
`;

const sphereVs = `
  precision highp float;

  attribute vec3 a_pos;

  uniform vec3 u_centerHigh;
  uniform vec3 u_centerLow;
  uniform float u_radius;

  uniform mat4 g_viewProjRelativeToEye;
  uniform vec3 g_camPosHigh;
  uniform vec3 g_camPosLow;

  void main()
  {
    vec3 centerPosRelativeToEye = (u_centerHigh - g_camPosHigh) + (u_centerLow - g_camPosLow);
    vec3 posRelativeToEye = centerPosRelativeToEye + u_radius * a_pos;
    gl_Position = g_viewProjRelativeToEye * vec4(posRelativeToEye, 1.0);
  }
`;

const colorFs = `
  precision mediump float;
  uniform lowp vec4 u_color;

  void main()
  {
    gl_FragColor = u_color;
  }
`;

// ----------------------------------------------------------------------------------
// DebugRenderUtils
// ----------------------------------------------------------------------------------
export class DebugRenderUtils {
  static renderer: Gfx.Renderer;
  static globalUniforms: GlobalUniforms;

  static setContext(renderer: Gfx.Renderer, globalUniforms: GlobalUniforms) {
    this.renderer = renderer;
    this.globalUniforms = globalUniforms;
  }

  /** Lazy initialization so that we don't waste time compiling shaders during production (unless we need to) */
  private static initialize() {
    //    6 - 7   Vertex Layout 
    //   /   /|    
    //  2 - 3 5   Y Z
    //  |   |/    |/
    //  0 - 1     * - X
    const unitCubeVerts = new Float32Array([
      -1, -1, -1,
      1, -1, -1,
      -1, 1, -1,
      1, 1, -1,

      -1, -1, 1,
      1, -1, 1,
      -1, 1, 1,
      1, 1, 1,
    ]);
    const unitCubeVertBuf = this.renderer.createBuffer('ObbVerts', Gfx.BufferType.Vertex, Gfx.Usage.Static, unitCubeVerts);

    const unitCubeIndices = new Uint16Array([
      // Lines
      0, 1, 1, 3, 3, 2, 2, 0, // Front face
      0, 4, 1, 5, 3, 7, 2, 6, // Front to Back edges
      4, 5, 5, 7, 7, 6, 6, 4, // Back face

      // Face triangles (CW)
      0, 2, 1, 1, 2, 3, // Front face
      1, 3, 5, 5, 3, 7, // Right face
      4, 6, 0, 0, 6, 2, // Left face
      2, 6, 3, 3, 6, 7, // Top face
      4, 0, 5, 5, 0, 1, // Bottom face
      5, 7, 4, 4, 7, 6, // Back face
    ]);
    const unitCubeIdxBuf = this.renderer.createBuffer('ObbIndices', Gfx.BufferType.Index, Gfx.Usage.Static, unitCubeIndices);

    const renderFormatBlending: Gfx.RenderFormat = { blendingEnabled: true, srcBlendFactor: Gfx.BlendFactor.Source, dstBlendFactor: Gfx.BlendFactor.OneMinusSource };
    const renderFormatNoBlending: Gfx.RenderFormat = { blendingEnabled: false };

    const unitCubeVertLayout: Gfx.BufferLayout = { a_pos: { type: Gfx.Type.Float3, offset: 0 } };
    const unitCubeVertBufLayout: Gfx.VertexLayout = { buffers: [{ stride: 4 * 3, layout: unitCubeVertLayout }] };

    const depthTestWrite = this.renderer.createDepthStencilState({ depthTestEnabled: true, depthWriteEnabled: true });
    const depthTest = this.renderer.createDepthStencilState({ depthTestEnabled: true, depthWriteEnabled: false });
    const depthDisabled = this.renderer.createDepthStencilState({ depthTestEnabled: false, depthWriteEnabled: false });

    // ----------------------------------------------------------------------------------
    // Oriented Bounding Box
    // ----------------------------------------------------------------------------------
    class ObbShader implements Gfx.ShaderDescriptor {
      static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
        u_extents: { type: Gfx.Type.Float3x3 },
        u_center: { type: Gfx.Type.Float3 },
        u_color: { type: Gfx.Type.Float4 },
      });

      static resourceLayout = {
        uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: ObbShader.uniformLayout },
        globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
      };

      name = 'Obb';
      vertSource = obbVs;
      fragSource = colorFs;
      resourceLayout = ObbShader.resourceLayout;
    }

    obbPrim.shader = this.renderer.createShader(new ObbShader());
    obbPrim.pipeline = this.renderer.createRenderPipeline(obbPrim.shader, renderFormatNoBlending, unitCubeVertBufLayout, ObbShader.resourceLayout);
    obbPrim.resources = this.renderer.createResourceTable(ObbShader.resourceLayout);
    obbPrim.vertTable = this.renderer.createVertexTable(obbPrim.pipeline);
    obbPrim.depthState = depthTestWrite;
    obbPrim.uniforms = new UniformBuffer('ObbUniforms', this.renderer, ObbShader.uniformLayout);
    obbPrim.indexBuffer = unitCubeIdxBuf;
    obbPrim.count = 0;

    this.renderer.setVertexBuffer(obbPrim.vertTable, 0, { buffer: unitCubeVertBuf });
    this.renderer.setBuffer(obbPrim.resources, 0, obbPrim.uniforms.getBufferView());
    this.renderer.setBuffer(obbPrim.resources, 1, this.globalUniforms.bufferView);

    // ----------------------------------------------------------------------------------
    // Frustum
    // ----------------------------------------------------------------------------------
    // class FrustumShader implements Gfx.ShaderDescriptor {
    //   static uniformLayout: Gfx.BufferLayout = {
    //     u_invViewProjRelativeToEye: { offset: 0, type: Gfx.Type.Float4x4 },
    //     u_camPosHigh: { offset: 64, type: Gfx.Type.Float3 },
    //     u_camPosLow: { offset: 76, type: Gfx.Type.Float3 },
    //     u_color: { offset: 88, type: Gfx.Type.Float4 },
    //   };

    //   static resourceLayout = {
    //     uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: FrustumShader.uniformLayout },
    //     globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: globalUniforms.getBufferLayout() },
    //   };

    //   name = 'Frustum';
    //   vertSource = frustumVs;
    //   fragSource = colorFs;
    //   resourceLayout = FrustumShader.resourceLayout;
    // }

    // frustumPrim.shader = this.renderer.createShader(new FrustumShader());
    // frustumPrim.pipeline = this.renderer.createRenderPipeline(frustumPrim.shader, renderFormatBlending, unitCubeVertBufLayout, FrustumShader.resourceLayout);
    // frustumPrim.resources = this.renderer.createResourceTable(frustumPrim.pipeline);
    // frustumPrim.depthState = depthTest;
    // frustumPrim.uniforms = new UniformBuffer('FrustumUniforms', this.renderer, FrustumShader.uniformLayout);
    // frustumPrim.indexBuffer = unitCubeIdxBuf;

    // this.renderer.setBuffer(frustumPrim.resources, unitCubeVertBuf);
    // this.renderer.setBuffer(frustumPrim.resources, frustumPrim.uniforms.getBuffer(), 0);
    // this.renderer.setBuffer(frustumPrim.resources, globalUniforms.getBuffer(), 1);

    // ----------------------------------------------------------------------------------
    // Points and Lines
    // ----------------------------------------------------------------------------------
    class PointsShader implements Gfx.ShaderDescriptor {
      static resourceLayout = {
        globalUniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
      };

      name = 'Points';
      vertSource = pointsVs;
      fragSource = pointsFs;
      resourceLayout = PointsShader.resourceLayout;
    }

    const pointsVertLayout: Gfx.VertexLayout = {
      buffers: [{
        stride: 32,
        layout: {
          a_pos: { offset: 0, type: Gfx.Type.Float3 },
          a_color: { offset: 16, type: Gfx.Type.Float4 },
        }
      }]
    }

    pointsPrim.shader = this.renderer.createShader(new PointsShader());
    pointsPrim.pipeline = this.renderer.createRenderPipeline(pointsPrim.shader, renderFormatBlending, pointsVertLayout, PointsShader.resourceLayout);
    pointsPrim.resources = this.renderer.createResourceTable(PointsShader.resourceLayout);
    pointsPrim.vertTable = this.renderer.createVertexTable(pointsPrim.pipeline);
    pointsPrim.depthState = depthDisabled;
    pointsPrim.vertexBuffer = this.renderer.createBuffer('PointsVerts', Gfx.BufferType.Vertex, Gfx.Usage.Dynamic, kMaxPoints * pointsVertLayout.buffers[0].stride);
    pointsPrim.count = 0;

    this.renderer.setVertexBuffer(pointsPrim.resources, 0, { buffer: pointsPrim.vertexBuffer });
    this.renderer.setBuffer(pointsPrim.resources, 0, this.globalUniforms.bufferView);

    // ----------------------------------------------------------------------------------
    // Sphere
    // ----------------------------------------------------------------------------------
  //   class SphereShader implements Gfx.ShaderDescriptor {
  //     static uniformLayout: Gfx.BufferLayout = {
  //       u_centerHigh: { offset: 0, type: Gfx.Type.Float3 },
  //       u_centerLow: { offset: 12, type: Gfx.Type.Float3 },
  //       u_radius: { offset: 24, type: Gfx.Type.Float },
  //       u_color: { offset: 32, type: Gfx.Type.Float4 },
  //     };

  //     static resourceLayout = {
  //       uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: SphereShader.uniformLayout },
  //       globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: globalUniforms.getBufferLayout() },
  //     };

  //     name = 'Sphere';
  //     vertSource = sphereVs;
  //     fragSource = colorFs;
  //     resourceLayout = SphereShader.resourceLayout;
  //   }

  //   spherePrim.shader = this.renderer.createShader(new SphereShader());
  //   spherePrim.pipeline = this.renderer.createRenderPipeline(spherePrim.shader, renderFormatNoBlending, unitCubeVertBufLayout, SphereShader.resourceLayout);
  //   spherePrim.resources = this.renderer.createResourceTable(spherePrim.pipeline);
  //   spherePrim.depthState = depthTestWrite;
  //   spherePrim.uniforms = new UniformBuffer('SphereUniforms', this.renderer, SphereShader.uniformLayout);
  //   spherePrim.indexBuffer = unitCubeIdxBuf;

  //   this.renderer.setBuffer(spherePrim.resources, unitCubeVertBuf);
  //   this.renderer.setBuffer(spherePrim.resources, spherePrim.uniforms.getBuffer(), 0);
  //   this.renderer.setBuffer(spherePrim.resources, globalUniforms.getBuffer(), 1);
  }

  static renderObbs(obbs: mat4[], drawFaces: boolean = false, color: vec4 = defaultObbColor) {
    if (!defined(obbPrim.pipeline)) this.initialize();

    // @HACK:
    assert(obbs.length === 1, 'Drawing multiple OBBs not yet supported. (Need to use multiple uniform buffers)');

    obbPrim.uniforms.setVec4('u_color', color);

    for (let obb of obbs) {
      const m = mat3.fromMat4(mat3Scratch, obb);
      obbPrim.uniforms.setFloats('u_extents', m);
      obbPrim.uniforms.setVec3('u_center', mat4.getTranslation(vec3Scratch, obb));
    }

    obbPrim.uniforms.write(this.renderer);

    const prim: RenderPrimitive = {
      renderPipeline: obbPrim.pipeline,
      vertexTable: obbPrim.vertTable,
      depthMode: obbPrim.depthState,
      resourceTable: obbPrim.resources,

      indexType: Gfx.Type.Ushort,
      indexBuffer: { buffer: obbPrim.indexBuffer, byteOffset: drawFaces ? 24 * 2 : 0 },
      type: drawFaces ? Gfx.PrimitiveType.Triangles : Gfx.PrimitiveType.Lines,
      elementCount: drawFaces ? 36 : 24,
    }

    renderLists.debug.push(prim);
  }

  // static renderFrustum(this.renderer: Gfx.Renderer, invViewProjRelativeToEye: Matrix4, camPos: vec3) {
  //   mat4Scratch.set(invViewProjRelativeToEye.m);
  //   frustumPrim.uniforms.setByteArray('u_invViewProjRelativeToEye', new Uint8Array(mat4Scratch.buffer));

  //   encodeVecHighToFloatArray(camPos, frustumPrim.uniforms.getFloatArray('u_camPosHigh'));
  //   encodeVecLowToFloatArray(camPos, frustumPrim.uniforms.getFloatArray('u_camPosLow'));

  //   this.renderer.bindPipeline(frustumPrim.pipeline);
  //   this.renderer.setDepthStencilState(frustumPrim.depthState);

  //   frustumPrim.uniforms.set('u_color', new vec4(1, 1, 1, 1));
  //   frustumPrim.uniforms.write(this.renderer);
  //   this.renderer.bindResources(frustumPrim.resources);
  //   this.renderer.draw(Gfx.PrimitiveType.Lines, frustumPrim.indexBuffer, Gfx.Type.Ushort, 0, 16);

  //   frustumPrim.uniforms.set('u_color', new vec4(0, 0, 1, 0.1));
  //   frustumPrim.uniforms.write(this.renderer);
  //   this.renderer.bindResources(frustumPrim.resources);
  //   this.renderer.draw(Gfx.PrimitiveType.Triangles, frustumPrim.indexBuffer, Gfx.Type.Ushort, 24, 30);
  // }

  // static renderPoints(this.renderer: Gfx.this.renderer, points: vec3[], color: vec4) {
  //   console.assert(points.length < kMaxPoints);

  //   // Encode positions as doubles and write to vertex buffer
  //   for (let i = 0; i < points.length; i++) {
  //     encodeVecHighToFloatArray(points[i], floatScratch, i * 6 + 0);
  //     encodeVecLowToFloatArray(points[i], floatScratch, i * 6 + 3);
  //   }
  //   this.renderer.writeBufferData(pointsPrim.vertexBuffer, 0, floatScratch.subarray(0, points.length * 6));

  //   // Write uniforms
  //   pointsPrim.uniforms.set('u_color', color);
  //   pointsPrim.uniforms.write(this.renderer);

  //   // Render
  //   this.renderer.bindPipeline(pointsPrim.pipeline);
  //   this.renderer.setDepthStencilState(pointsPrim.depthState);

  //   this.renderer.bindResources(pointsPrim.resources);
  //   this.renderer.drawNonIndexed(Gfx.PrimitiveType.Points, 0, points.length);
  // }

  static renderLines(pointPairs: vec3[], color: vec4) {
    if (!defined(pointsPrim.pipeline)) this.initialize();

    console.assert(pointPairs.length < kMaxPoints);

    // Encode positions and write to vertex buffer
    for (let i = 0; i < pointPairs.length; i++) {
      floatScratch.set(pointPairs[i], i * 8 + 0);
      floatScratch.set(color, i * 8 + 4);
    }
    this.renderer.writeBufferData(pointsPrim.vertexBuffer, pointsPrim.count * 32, 
        floatScratch.subarray(0, pointPairs.length * 8));

    pointsPrim.count += pointPairs.length;
  }

  // static renderSpheres(this.renderer: Gfx.Renderer, spheres: vec4[], color: vec4) {
  //   this.renderer.bindPipeline(spherePrim.pipeline);
  //   this.renderer.setDepthStencilState(spherePrim.depthState);
  //   for (let posRad of spheres) {
  //     encodeVecHighToFloatArray(posRad, spherePrim.uniforms.getFloatArray('u_centerHigh'));
  //     encodeVecLowToFloatArray(posRad, spherePrim.uniforms.getFloatArray('u_centerLow'));
  //     spherePrim.uniforms.set('u_color', color);
  //     spherePrim.uniforms.set('u_radius', posRad.w);
  //     spherePrim.uniforms.write(this.renderer);

  //     this.renderer.bindResources(spherePrim.resources);
  //     this.renderer.draw(Gfx.PrimitiveType.Lines, spherePrim.indexBuffer, Gfx.Type.Ushort, 0, 24);
  //   }
  // }

  static flush() {
    if (pointsPrim.count > 0) {
      const prim: RenderPrimitive = {
        renderPipeline: pointsPrim.pipeline,
        depthMode: pointsPrim.depthState,
        resourceTable: pointsPrim.resources,
        vertexTable: pointsPrim.vertTable,
        type: Gfx.PrimitiveType.Lines,
        elementCount: pointsPrim.count,
      }
      
      renderLists.debug.push(prim);
      
      pointsPrim.count = 0;
    }
  }
}