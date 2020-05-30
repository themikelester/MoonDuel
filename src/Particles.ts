import vsSource from './shaders/particle.vert';
import fsSource from './shaders/particle.frag';

import { Renderer, Id, PrimitiveType, Type, CullMode, VertexLayout, ResourceLayout, BindingType, ShaderResourceLayout, BufferType, Usage, BufferLayout } from "./gfx/GfxTypes";
import { assertDefined, assert, defined } from "./util";
import { vec3, vec2, vec4, mat3, mat4, quat } from "gl-matrix";
import { Clock } from "./Clock";
import { normToLengthAndAdd, normToLength, computeModelMatrixSRT } from "./MathHelpers";
import { renderLists } from "./RenderList";
import { RenderPrimitive } from "./RenderPrimitive";
import { GlobalUniforms } from './GlobalUniforms';
import { computePackedBufferLayout, UniformBuffer } from './UniformBuffer';
import { Camera } from './Camera';
import { ResourceManager } from './resources/ResourceLoading';
import { TextureResource } from './resources/Texture';

const kMaxDt = 16 * 1.5; // 1.5 frames
const kMaxEmitters = 64;
const kMaxParticles = 256;

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec4a = vec4.create();

enum EmitterFlags {
  Terminating = 1 << 0, // Lifetime exceed, waiting for all child particles to die. Don't spawn any new particles.
  Terminated = 1 << 1,  // Emitter is unused and ready to be re-allocated 
}

enum EmitterDrawGroup {
  Default,
  Deferred,

  _Count,
}


export enum EmitterDefFlags {
  ScaleVelocity, // The initial particle velocity scales with the size of the emitter
}

export enum EmitterVolumeType {
  Cube,
}

export const enum ShapeType {
  Billboard
}

export class SpawnDef {
  maxTime = 0;
  flags: EmitterDefFlags = EmitterDefFlags.ScaleVelocity;

  forward: vec3 = vec3.fromValues(0, 1, 0);
  rotation: vec3 = vec3.fromValues(0, 0, 0);
  scale: vec3 = vec3.fromValues(0.5, 1, 0.5);
  pos: vec3 = vec3.fromValues(0, 0, 0);

  initialVelAxis = 0;
  initialVelOmni = 0;
  initialVelDir = 100;
  initialVelRatio = 0;
  initialVelRndm = 0;
  spread = 0.1;

  lifeTime = 0.6;
  lifeTimeRndm = 0.18;

  rate = 5;
  rateRndm = 0;

  volumeMinRad = 0;
  volumeSize = 0;
  volumeSweep = 0;
  volumeType: EmitterVolumeType = EmitterVolumeType.Cube;
};

export class ShapeDef {
  shapeType: ShapeType = ShapeType.Billboard;
  scale2d = vec2.fromValues(1, 1.3);

  // Color animation
  colorEnv = vec4.fromValues(1, 0, 0, 0.5);
  colorPrm = vec4.fromValues(0, 1, 0, 0.5);

  // Texture animation
  texIdxAnimData: number[] = [];
  texIdxAnimRandomMask: number = -1;
};

export class AlphaDef {
  alphaBaseValue = 1

  // Sprite alpha will interpolate from InValue to BaseValue over 0-InTiming in normalized time
  alphaInTiming = 0
  alphaInValue = 1

  // Sprite alpha will interpolate from BaseValue to InValue over OutTiming-1 in normalized time
  alphaOutTiming = 1
  alphaOutValue = 1
}

export class ScalingDef {
  scaleRandom = 0.0 // Scale the final sprite size by a random amount

  // Sprite scale starts at InValueX/Y, and changes smoothly until it reaches 1 at normalized time InTiming
  scaleInTiming = 0;
  scaleInValueX = 0;
  scaleInValueY = 0;

  // After normalized time OutTiming [0-1], scale smoothly changes to match OutValueX/Y at end of particle lifetime
  scaleOutTiming = 1;
  scaleOutValueX = 1;
  scaleOutValueY = 1;
}

export class EmitterDefinition {
  spawn: SpawnDef = new SpawnDef();
  shape: ShapeDef = new ShapeDef();
  scaling?: ScalingDef = new ScalingDef();
  alpha?: AlphaDef = new AlphaDef();
}

/**
 * All data necessary to create an instance of an Emitter.
 * Contains the emitter description, and references to any loaded resources that it will need.
 */
class EmitterData {
  def: EmitterDefinition = new EmitterDefinition();
  textureIds: Id[] = [];
}

/**
 * Transient data for the emitters to read and write to. Used to share information between emitters and managers.
 */
class EmitterFrameData {
  deltaTime: number;

  gfxDevice: Renderer;
  globalUniforms: GlobalUniforms;

  emitter: Emitter;
  emitterScale: vec3 = vec3.create();
  emitterDirMatrix: mat4;
  emitterTextures: Id[];
  emitterScaleIncRateX = 0;
  emitterScaleIncRateY = 0;
  emitterScaleDecRateX = 0;
  emitterScaleDecRateY = 0;
  emitterAlphaIncRate = 0;
  emitterAlphaDecRate = 0;

  volumePos: vec3 = vec3.create();
  velOmni: vec3 = vec3.create();
  velAxis: vec3 = vec3.create();

  viewMatrix: mat4 = mat4.create();
}

function computeDirMatrix(m: mat4, v: vec3): void {
  // Perp
  vec3.set(scratchVec3a, v[1], -v[0], 0);
  const mag = vec3.length(scratchVec3a);
  vec3.normalize(scratchVec3a, scratchVec3a);

  const x = scratchVec3a[0], y = scratchVec3a[1], z = v[2];
  m[0] = x * x + z * (1.0 - x * x);
  m[4] = (1.0 - z) * (x * y);
  m[8] = -y * mag;
  m[12] = 0.0;

  m[1] = (1.0 - z) * (x * y);
  m[5] = y * y + z * (1.0 - y * y);
  m[9] = x * mag;
  m[13] = 0.0;

  m[2] = y * mag;
  m[6] = -x * mag;
  m[10] = z;
  m[14] = 0.0;
}

/**
 * Spawns and manages particles
 */
class Emitter {
  data: EmitterData;
  drawGroup: EmitterDrawGroup = EmitterDrawGroup.Default;

  pos = vec3.create();
  scale = vec3.fromValues(1, 1, 1);
  scale2D = vec2.fromValues(1, 1);

  private dirMtx = mat4.create();

  private flags: EmitterFlags;
  private time: number = -16.0;
  private emitCount: number = 0;
  private particles: Particle[] = [];
  private textures: Id[] = [];
  private texturesLoaded = false;

  private scaleIncRateX = 0;
  private scaleIncRateY = 0;
  private scaleDecRateX = 0;
  private scaleDecRateY = 0;
  private alphaDecRate = 0;
  private alphaIncRate = 0;

  constructor(private emitterManager: EmitterManager) { }

  initialize(data: EmitterData) {
    this.data = data;

    if (data.def.scaling) {
      const def = data.def.scaling;

      if (def.scaleInTiming > 0) {
        this.scaleIncRateX = (1.0 - def.scaleInValueX) / def.scaleInTiming;
        this.scaleIncRateY = (1.0 - def.scaleInValueY) / def.scaleInTiming;
      }

      if (def.scaleOutTiming < 1) {
        this.scaleDecRateX = (def.scaleOutValueX - 1.0) / (1.0 - def.scaleOutTiming);
        this.scaleDecRateY = (def.scaleOutValueY - 1.0) / (1.0 - def.scaleOutTiming);
      }
    }

    if (data.def.alpha) {
      const def = data.def.alpha;

      if (def.alphaInTiming > 0)
        this.alphaIncRate = (def.alphaBaseValue - def.alphaInValue) / def.alphaInTiming;

      if (def.alphaOutTiming < 1)
        this.alphaDecRate = (def.alphaOutValue - def.alphaBaseValue) / (1.0 - def.alphaOutTiming);
    }

    computeDirMatrix(this.dirMtx, this.data.def.spawn.forward);
  }

  terminate() {
    // Remove all particles
    for (let i = 0; i < this.particles.length; i++) this.emitterManager.freeParticles.push(this.particles[i]);
    this.particles.length = 0;
  }

  update(frameData: EmitterFrameData): boolean {
    // Process termination
    if (this.data.def.spawn.maxTime > 0 && this.time >= this.data.def.spawn.maxTime) {
      this.flags |= EmitterFlags.Terminating;

      // Stay alive until all of our particles have died
      if (this.particles.length === 0) {
        this.flags = EmitterFlags.Terminated;
        return false;
      }
    }

    // Don't do any work until all of our textures are loaded
    if (!this.loadTextures()) {
      return true;
    }

    frameData.emitter = this;
    vec3.mul(frameData.emitterScale, this.data.def.spawn.scale, this.emitterManager.globalScale);
    frameData.emitterDirMatrix = this.dirMtx;
    frameData.emitterTextures = this.textures;
    frameData.emitterScaleDecRateX = this.scaleDecRateX;
    frameData.emitterScaleDecRateY = this.scaleDecRateY;
    frameData.emitterScaleIncRateX = this.scaleIncRateX;
    frameData.emitterScaleIncRateY = this.scaleIncRateY;
    frameData.emitterAlphaDecRate = this.alphaDecRate;
    frameData.emitterAlphaIncRate = this.alphaIncRate;

    if (!(this.flags & EmitterFlags.Terminating))
      this.emitIfNecessary();

    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const alive = particle.update(frameData);

      if (!alive) {
        this.particles.splice(i, 1);
        this.emitterManager.freeParticles.push(particle);
        i--;
      }
    }

    this.time += frameData.deltaTime;
    if (this.time < 0) this.time = 0.01;

    return true;
  }

  render(gfxDevice: Renderer, frameData: EmitterFrameData) {
    frameData.emitter = this;
    const shapeDef = this.data.def.shape;

    const n = this.particles.length;
    for (let i = 0; i < n; i++) {
      this.particles[i].render(gfxDevice, frameData);
    }
  }

  private loadTextures(): boolean {
    if (!this.texturesLoaded) {
      this.texturesLoaded = true;
      for (let i = 0; i < this.data.textureIds.length; i++) {
        const texIndex = this.data.textureIds[i];
        const texRes = this.emitterManager.textures[texIndex];
        if (defined(texRes)) this.textures[i] = assertDefined(texRes.texture);
        else this.texturesLoaded = false;
      }
    }
    return this.texturesLoaded;
  }

  private emitIfNecessary() {
    const frameData = this.emitterManager.frameData;
    const spawnDef = this.data.def.spawn;

    const rateHz = spawnDef.rate + spawnDef.rateRndm * (Math.random() * 2.0 - 1.0);
    const count = rateHz * frameData.deltaTime;
    this.emitCount += count;

    while (this.emitCount >= 1) {
      this.createParticle();
      this.emitCount--;
    }
  }

  private createParticle() {
    if (this.emitterManager.freeParticles.length === 0)
      return null;

    const particle = this.emitterManager.freeParticles.pop()!;
    this.particles.push(particle);
    this.calcVolume(this.emitterManager.frameData);
    particle.initialize(this.emitterManager.frameData);

    return particle;
  }

  private calcVolume(frameData: EmitterFrameData) {
    // Update the frame state to contain initial values for a new particle based on the emitter shape
    switch (this.data.def.spawn.volumeType) {
      case EmitterVolumeType.Cube: this.calcVolumeCube(frameData);
    }
  }

  private calcVolumeCube(frameData: EmitterFrameData) {
    const rndX = Math.random() - 0.5;
    const rndY = Math.random() - 0.5;
    const rndZ = Math.random() - 0.5;
    const size = this.data.def.spawn.volumeSize;

    vec3.set(frameData.volumePos, rndX * size, rndY * size, rndZ * size);
    vec3.mul(frameData.velOmni, frameData.volumePos, frameData.emitterScale);
    vec3.set(frameData.velAxis, frameData.volumePos[0], 0.0, frameData.volumePos[2]);
  }
}

class Particle {
  time = 0;
  lifeTime: number;
  t = 0; // Varies from 0-1 across our lifespan

  velocity = vec3.create();
  accel = vec3.create();
  pos = vec3.create();

  alpha = 1.0;

  baseScale: number = 1.0;
  scale = vec2.create();

  prim: RenderPrimitive;
  uniforms: UniformBuffer;

  texAnimIdx = 0;
  texAnimRandomPhase = 0;

  constructor(gfxResources: GfxResources) {
    // Create a new resource table and a Primitive for this particle
    const resourceTable = gfxResources.gfxDevice.createResourceTable(GfxResources.resLayout);
    this.prim = { ...gfxResources.primitive, resourceTable };

    this.uniforms = new UniformBuffer('ParticleUniforms', gfxResources.gfxDevice, GfxResources.uniformLayout);
    gfxResources.gfxDevice.setBuffer(resourceTable, 1, this.uniforms.getBufferView());
  }

  initialize(frameData: EmitterFrameData) {
    const emitter = frameData.emitter;
    const spawnDef = emitter.data.def.spawn;
    const shapeDef = emitter.data.def.shape;
    const scaleDef = emitter.data.def.scaling;

    const lifeTimeRandom = Math.random();
    this.lifeTime = spawnDef.lifeTime * (1.0 - lifeTimeRandom * spawnDef.lifeTimeRndm);
    this.time = 0.0;

    vec3.set(this.velocity, 0, 0, 0);

    // Initial XYZ velocity based on the starting position inside the spawn volume
    if (spawnDef.initialVelOmni !== 0)
      normToLengthAndAdd(this.velocity, frameData.velOmni, spawnDef.initialVelOmni);

    // Initial XY velocity based on the starting position inside the spawn volume
    if (spawnDef.initialVelAxis !== 0)
      normToLengthAndAdd(this.velocity, frameData.velAxis, spawnDef.initialVelAxis);

    // Initial velocity based on the emitter's forward direction 
    // @NOTE: the vector is random inside a cone determined by emitter direction and spread
    if (spawnDef.initialVelDir !== 0) {
      const randZ = Math.random();
      const randY = Math.random() * 2.0 - 1.0;
      mat4.identity(scratchMat4a);
      mat4.rotateZ(scratchMat4a, scratchMat4a, randZ * Math.PI);
      mat4.rotateY(scratchMat4a, scratchMat4a, spawnDef.spread * randY * Math.PI);
      mat4.mul(scratchMat4a, frameData.emitterDirMatrix, scratchMat4a);
      this.velocity[0] += spawnDef.initialVelDir * scratchMat4a[8];
      this.velocity[1] += spawnDef.initialVelDir * scratchMat4a[9];
      this.velocity[2] += spawnDef.initialVelDir * scratchMat4a[10];
    }

    // Add an additional random amount of velocity 
    if (spawnDef.initialVelRndm !== 0) {
      const randZ = Math.random() - 0.5;
      const randY = Math.random() - 0.5;
      const randX = Math.random() - 0.5;
      this.velocity[0] += spawnDef.initialVelRndm * randX;
      this.velocity[1] += spawnDef.initialVelRndm * randY;
      this.velocity[2] += spawnDef.initialVelRndm * randZ;
    }

    // Scale the velocity by a random amount within range
    const velRatio = 1.0 + (Math.random() * 2.0 - 1.0) * spawnDef.initialVelRatio;
    this.velocity[0] *= velRatio;
    this.velocity[1] *= velRatio;
    this.velocity[2] *= velRatio;

    // Optionally scale the velocity based on the size of the emitter
    if (!!(spawnDef.flags & EmitterDefFlags.ScaleVelocity)) {
      this.velocity[0] *= spawnDef.scale[0];
      this.velocity[1] *= spawnDef.scale[1];
      this.velocity[2] *= spawnDef.scale[2];
    }

    // @TODO: Rotate initial velocity based on emitter rotation
    // vec3.transformMat4(this.velocity, this.velocity, frameData.emitterGlobalRot);

    // Acceleration
    // vec3.copy(this.accel, this.velocity);
    // const accel = spawnDef.accel * (1.0 + ((Math.random() * 2.0 - 1.0) * spawnDef.accelRndm));
    // normToLength(this.accel, accel);
    vec3.zero(this.accel);

    vec3.copy(this.pos, emitter.pos);

    // Scale (2D sprite size)
    if (scaleDef) {
      this.baseScale = 1.0 + (scaleDef.scaleRandom * (Math.random() * 2.0 - 1.0));
    }

    this.texAnimRandomPhase = Math.floor(Math.random() * shapeDef.texIdxAnimData.length) & shapeDef.texIdxAnimRandomMask;

    this.uniforms.setVec4('u_colorPrim', shapeDef.colorPrm);
    this.uniforms.setVec4('u_colorEnv', shapeDef.colorEnv);

    frameData.gfxDevice.setBuffer(this.prim.resourceTable, 0, frameData.globalUniforms.bufferView);
  }

  update(frameData: EmitterFrameData): boolean {
    const shapeDef = frameData.emitter.data.def.shape;
    const scaleDef = frameData.emitter.data.def.scaling;
    const alphaDef = frameData.emitter.data.def.alpha;

    this.time += frameData.deltaTime;
    this.t = this.time / this.lifeTime;

    // Die if we're too old
    if (this.time < 0 || this.time >= this.lifeTime)
      return false;

    vec3.scaleAndAdd(this.velocity, this.velocity, this.accel, frameData.deltaTime);

    // Texture animation
    if (shapeDef.texIdxAnimData !== null) {
      const frame = this.texAnimRandomPhase + Math.floor(this.time * 30); // Particles animate at 30fps
      this.texAnimIdx = frame % shapeDef.texIdxAnimData.length;
    }

    // Scale animation
    if (defined(scaleDef)) {
      const incRateX = frameData.emitterScaleIncRateX;
      const incRateY = frameData.emitterScaleIncRateY;
      const decRateX = frameData.emitterScaleDecRateX;
      const decRateY = frameData.emitterScaleDecRateY;

      this.scale[0] = this.baseScale * this.calcScaleFade(this.t, scaleDef, scaleDef.scaleInValueX, incRateX, decRateX);
      this.scale[1] = this.baseScale * this.calcScaleFade(this.t, scaleDef, scaleDef.scaleInValueY, incRateY, decRateY);
    }

    // Alpha animation
    if (defined(alphaDef)) {
      if (this.t < alphaDef.alphaInTiming)
        this.alpha = alphaDef.alphaInValue + this.t * frameData.emitterAlphaIncRate;
      else if (this.t > alphaDef.alphaOutTiming)
        this.alpha = alphaDef.alphaBaseValue + ((this.t - alphaDef.alphaOutTiming) * frameData.emitterAlphaDecRate);
      else
        this.alpha = alphaDef.alphaBaseValue;

    }

    vec3.scaleAndAdd(this.pos, this.pos, this.velocity, frameData.deltaTime);

    return true;
  }

  render(gfxDevice: Renderer, frameData: EmitterFrameData) {
    const shapeDef = frameData.emitter.data.def.shape;
    let modelView: mat4;

    switch (shapeDef.shapeType) {
      case ShapeType.Billboard: {
        const pos = vec3.transformMat4(scratchVec3a, this.pos, frameData.viewMatrix);
        modelView = computeModelMatrixSRT(scratchMat4a,
          100.0 * this.scale[0] * shapeDef.scale2d[0] * frameData.emitter.scale2D[0],
          100.0 * this.scale[1] * shapeDef.scale2d[1] * frameData.emitter.scale2D[1],
          1,
          0, 0, 0,// rotateAngle,
          pos[0], pos[1], pos[2]);
      }
        break;
      default: throw new Error('Whoops');
    }

    const primColor = vec4.set(scratchVec4a, shapeDef.colorPrm[0], shapeDef.colorPrm[1], shapeDef.colorPrm[2], this.alpha);
    this.uniforms.setVec4('u_colorPrim', primColor);
    this.uniforms.setFloats('u_modelView', modelView);
    this.uniforms.write(gfxDevice);

    const texIndex = shapeDef.texIdxAnimData[this.texAnimIdx];
    gfxDevice.setTexture(this.prim.resourceTable, 0, frameData.emitterTextures[texIndex]);

    renderLists.effects.push(this.prim);
  }

  private calcScaleFade(t: number, scaleDef: ScalingDef, base: number, increase: number, decrease: number): number {
    if (t < scaleDef.scaleInTiming)
      return (t * increase) + base;
    else if (t > scaleDef.scaleOutTiming)
      return ((t - scaleDef.scaleOutTiming) * decrease) + 1.0;
    else
      return 1;
  }
}

class GfxResources {
  pipeline: Id;
  shader: Id;
  vertTable: Id;
  indexBuf: Id;
  vertBuf: Id;

  gfxDevice: Renderer;
  primitive: RenderPrimitive;

  static uniformLayout: BufferLayout = computePackedBufferLayout({
    u_modelView: { type: Type.Float4x4 },
    u_colorEnv: { type: Type.Float4 },
    u_colorPrim: { type: Type.Float4 },
  })

  static resLayout: ShaderResourceLayout = {
    globals: { index: 0, type: BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    uniforms: { index: 1, type: BindingType.UniformBuffer, layout: GfxResources.uniformLayout },
    u_tex: { index: 0, type: BindingType.Texture },
  }

  initialize(gfxDevice: Renderer) {
    this.gfxDevice = gfxDevice;

    const vertLayout: VertexLayout = {
      buffers: [{
        stride: 20,
        layout: {
          a_pos: { type: Type.Float3, offset: 0 },
          a_uv0: { type: Type.Float2, offset: 3 * 4 },
        }
      }],
    };

    const renderFormat = renderLists.effects.renderFormat;
    const shaderDesc = { name: 'Particle', vertSource: vsSource.sourceCode, fragSource: fsSource.sourceCode };

    this.shader = gfxDevice.createShader(shaderDesc);
    this.pipeline = gfxDevice.createRenderPipeline(this.shader, renderFormat, vertLayout, GfxResources.resLayout);
    this.vertTable = gfxDevice.createVertexTable(this.pipeline);

    const v0 = -0.5;
    const v1 = 0.5;
    this.vertBuf = gfxDevice.createBuffer('ParticleVerts', BufferType.Vertex, Usage.Static, new Float32Array([
      v0, v0, v0, 1, 1,
      v0, v1, v0, 1, 0,
      v1, v0, v0, 0, 1,
      v1, v1, v0, 0, 0,
      // Cross
      v0, v0, v0, 1, 1,
      v0, v1, v0, 1, 0,
      v0, v0, v1, 0, 1,
      v0, v1, v1, 0, 0,
    ]));

    this.indexBuf = gfxDevice.createBuffer('ParticleIndices', BufferType.Index, Usage.Static, new Uint16Array([
      0, 1, 2, 2, 1, 3,
      4, 5, 6, 6, 5, 7,
    ]).buffer);

    gfxDevice.setVertexBuffer(this.vertTable, 0, { buffer: this.vertBuf });

    this.primitive = {
      resourceTable: -1,
      vertexTable: this.vertTable,
      renderPipeline: this.pipeline,
      elementCount: 6,
      type: PrimitiveType.Triangles,

      indexBuffer: { buffer: this.indexBuf },
      indexType: Type.Ushort,
    }
  }

  terminate(gfxDevice: Renderer) {
    gfxDevice.removeShader(this.shader);
    gfxDevice.removeRenderPipeline(this.pipeline);
  }
}

/**
 * Manages emitter/particle allocation, and their life cycles
 */
class EmitterManager {
  emitters: Emitter[] = [];
  frameData: EmitterFrameData = new EmitterFrameData();
  gfxResources: GfxResources = new GfxResources();
  textures: TextureResource[] = [];

  freeEmitters: Emitter[] = [];
  freeParticles: Particle[] = [];

  globalScale = vec3.fromValues(1, 1, 1);

  constructor(private maxEmitters: number, private maxParticles: number) { }

  initialize(gfxDevice: Renderer, globalUniforms: GlobalUniforms, textures: TextureResource[]) {
    this.gfxResources.initialize(gfxDevice);
    this.textures = textures;

    for (let i = 0; i < this.maxEmitters; i++) { this.freeEmitters[i] = new Emitter(this); }
    for (let i = 0; i < this.maxParticles; i++) { this.freeParticles[i] = new Particle(this.gfxResources); }

    this.frameData.gfxDevice = gfxDevice;
    this.frameData.globalUniforms = globalUniforms;
  }

  createEmitter(data: EmitterData) {
    if (this.freeEmitters.length === 0)
      return null;

    const emitter = assertDefined(this.freeEmitters.pop());
    emitter.initialize(data);
    this.emitters.push(emitter);
    return emitter;
  }

  update(dt: number) {
    // Clamp dt in case we were suspended (background tab) to avoid doing tons of work in one frame
    this.frameData.deltaTime = Math.min(dt, kMaxDt);

    for (let i = 0; i < this.emitters.length; i++) {
      const emitter = this.emitters[i];
      const alive = emitter.update(this.frameData);

      if (!alive) {
        emitter.terminate();
        this.emitters.splice(i, 1);
        this.freeEmitters.push(emitter);
        i--;
      }
    }
  }

  render(gfxDevice: Renderer, viewMatrix: mat4) {
    // Update billboard matrices
    mat4.copy(this.frameData.viewMatrix, viewMatrix);

    for (let drawGroup = 0; drawGroup < EmitterDrawGroup._Count; drawGroup++) {
      // Choose a render list based on draw group

      for (let i = 0; i < this.emitters.length; i++) {
        const emitter = this.emitters[i];
        if (emitter.drawGroup === drawGroup)
          this.emitters[i].render(gfxDevice, this.frameData);
      }
    }

  }
}

/**
 * The primary system. Its main job is to parse all necessary data from other systems into a usable form. 
 * I.e. the EmitterManager needs billboard matrices, ParticleSystem computes them from the Camera system.
 */
export class ParticleSystem {
  emitterManager: EmitterManager = new EmitterManager(kMaxEmitters, kMaxParticles);
  textures: TextureResource[] = [];
  data: EmitterData[] = [];

  initialize({ gfxDevice, globalUniforms, resources }: { gfxDevice: Renderer, globalUniforms: GlobalUniforms, resources: ResourceManager }) {
    this.emitterManager.initialize(gfxDevice, globalUniforms, this.textures);

    // @TODO: Load emitter definitions and textures from a new resource type
    const cb = (i: number) => (error?: string, res?: TextureResource) => {
      if (error) console.error(`Failed to load: ${error}`);
      if (res) this.textures[i] = res
    };

    resources.load('data/flame0.png', 'texture', cb(0));
    resources.load('data/flame1.png', 'texture', cb(1));
    resources.load('data/flame2.png', 'texture', cb(2));
    resources.load('data/flame3.png', 'texture', cb(3));
    resources.load('data/flame4.png', 'texture', cb(4));
    resources.load('data/flame5.png', 'texture', cb(5));
    resources.load('data/flame6.png', 'texture', cb(6));
    resources.load('data/flame7.png', 'texture', cb(7));
    resources.load('data/flame8.png', 'texture', cb(8));
    resources.load('data/flame9.png', 'texture', cb(9));

    // @HACK
    this.data[0] = kFlameData;
  }

  update({ clock }: { clock: Clock }) {
    const dtSec = clock.renderDt * 0.001;
    this.emitterManager.update(dtSec);
  }

  render({ gfxDevice, camera }: { gfxDevice: Renderer, camera: Camera }) {
    this.emitterManager.render(gfxDevice, camera.viewMatrix);
  }

  createEmitter(emitterId: number) {
    const data = this.data[emitterId]; // @TODO: Look up in emmitter data resource
    return this.emitterManager.createEmitter(data);
  }
}

const kFlameData: EmitterData = {
  textureIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  def: {
    spawn: {
      ...new SpawnDef(),
      rate: 13.5,
      rateRndm: 0,
      spread: 0.11649999767541885
    },
    shape: {
      ...new ShapeDef(),
      colorEnv: vec4.fromValues(0.29411764705882354, 0.34509803921568627, 0.1568627450980392, 1),
      colorPrm: vec4.fromValues(0.5882352941176471, 0.09411764705882353, 0, 1),
      scale2d: vec2.fromValues(1, 1.3),
      texIdxAnimData: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9],
    },
    scaling: {
      scaleRandom: 0.19999998807907104,

      scaleInTiming: 0.7910000085830688,
      scaleInValueX: 1.7999999523162842,
      scaleInValueY: 0.699999988079071,

      scaleOutTiming: 1,
      scaleOutValueX: 1,
      scaleOutValueY: 1,
    },
    alpha: {
      alphaBaseValue: 1,

      alphaInTiming: 0.10279999673366547,
      alphaInValue: 0,

      alphaOutTiming: 0.7294999957084656,
      alphaOutValue: 0,
    }
  },
}