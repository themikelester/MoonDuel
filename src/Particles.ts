import vsSource from './shaders/particle.vert';
import fsSource from './shaders/particle.frag';

import { Renderer, Id, PrimitiveType, Type, CullMode, VertexLayout, ResourceLayout, BindingType, ShaderResourceLayout, BufferType, Usage, BufferLayout } from "./gfx/GfxTypes";
import { assertDefined, assert } from "./util";
import { vec3, vec2, vec4, mat3, mat4, quat } from "gl-matrix";
import { Clock } from "./Clock";
import { normToLengthAndAdd, normToLength, computeModelMatrixSRT } from "./MathHelpers";
import { renderLists } from "./RenderList";
import { RenderPrimitive } from "./RenderPrimitive";
import { GlobalUniforms } from './GlobalUniforms';
import { computePackedBufferLayout, UniformBuffer } from './UniformBuffer';
import { Camera } from './Camera';

const kMaxDt = 16 * 1.5; // 1.5 frames
const kMaxEmitters = 64;
const kMaxParticles = 256;

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();

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
  texCalcOnce: true;
  texIdxAnimData: number[] = [];

  // Alpha animation
  // isEnableAlpha: true
  // alphaBaseValue: 1
  // alphaDecreaseRate: -3.6968576123283117
  // alphaInTiming: 0.10279999673366547
  // alphaInValue: 0
  // alphaIncreaseRate: 9.727626768226491
  // alphaOutTiming: 0.7294999957084656
  // alphaOutValue: 0

  // // Scale animation
  // isDiffXY: true
  // isEnableScale: true
  // scaleInTiming: 0.7910000085830688
  // scaleInValueX: 1.7999999523162842
  // scaleInValueY: 0.699999988079071
  // scaleIncreaseRateX: -1.0113779312712488
  // scaleIncreaseRateY: 0.37926676190348446
  // scaleOutRandom: 0.19999998807907104
  // scaleOutTiming: 0.7910000085830688
  // scaleOutValueX: 1
  // scaleOutValueY: 1
};

export class EmitterDefinition {
  spawn: SpawnDef = new SpawnDef();
  shape: ShapeDef = new ShapeDef();
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
    m[0]  = x*x + z * (1.0 - x*x);
    m[4]  = (1.0 - z) * (x * y);
    m[8]  = -y*mag;
    m[12] = 0.0;

    m[1]  = (1.0 - z) * (x * y);
    m[5]  = y*y + z * (1.0 - y*y);
    m[9]  = x*mag;
    m[13] = 0.0;

    m[2]  = y*mag;
    m[6]  = -x*mag;
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

  constructor(private emitterManager: EmitterManager) { }

  initialize(data: EmitterData) {
    this.data = data;
    
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

    frameData.emitter = this;
    vec3.mul(frameData.emitterScale, this.data.def.spawn.scale, this.emitterManager.globalScale);
    frameData.emitterDirMatrix = this.dirMtx;

    // if (bsp1.texIdxAnimData !== null && bsp1.texCalcOnEmitter)
    //   this.texAnmIdx = calcTexIdx(workData, this.time, 0, 0);

    // if (bsp1.colorCalcOnEmitter)
    //   calcColor(this.colorPrm, this.colorEnv, workData, this.time, 0, 0);

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

  prim: RenderPrimitive;
  uniforms: UniformBuffer;

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

    frameData.gfxDevice.setBuffer(this.prim.resourceTable, 0, frameData.globalUniforms.bufferView);
  }

  update(frameData: EmitterFrameData): boolean {
    this.time += frameData.deltaTime;
    this.t = this.time / this.lifeTime;

    // Die if we're too old
    if (this.time < 0 || this.time >= this.lifeTime)
      return false;

    vec3.scaleAndAdd(this.velocity, this.velocity, this.accel, frameData.deltaTime);

    // Texture animation
    // if (bsp1.texIdxAnimData !== null && !bsp1.texCalcOnEmitter) {
    //   const randomPhase = this.anmRandom & bsp1.texIdxAnimRndmMask;
    //   this.texAnmIdx = calcTexIdx(frameData, this.tick, this.t, randomPhase);
    // }

    // Color animation
    // if (!bsp1.colorCalcOnEmitter) {
    //   const randomPhase = this.anmRandom & bsp1.colorAnimRndmMask;
    //   calcColor(this.colorPrm, this.colorEnv, frameData, this.tick, this.t, randomPhase);
    // } else {
    //   colorCopy(this.colorPrm, frameData.baseEmitter.colorPrm);
    //   colorCopy(this.colorEnv, frameData.baseEmitter.colorEnv);
    // }

    // if (esp1 !== null) {
    //   const hasScaleAnm = esp1.isEnableScale;
    //   if (hasScaleAnm) {
    //     const scaleAnmX = this.calcScaleAnm(esp1.scaleAnmTypeX, esp1.scaleAnmMaxFrameX);
    //     this.scale[0] = this.scaleOut * this.calcScaleFade(scaleAnmX, esp1, esp1.scaleInValueX, esp1.scaleIncreaseRateX, esp1.scaleDecreaseRateX);

    //     if (esp1.isEnableScaleBySpeedX)
    //       this.scale[0] *= 1 / vec3.length(this.velocity);

    //     const hasScaleAnmY = esp1.isDiffXY;
    //     if (hasScaleAnmY) {
    //       const scaleAnmY = this.calcScaleAnm(esp1.scaleAnmTypeY, esp1.scaleAnmMaxFrameY);
    //       this.scale[1] = this.scaleOut * this.calcScaleFade(scaleAnmY, esp1, esp1.scaleInValueY, esp1.scaleIncreaseRateY, esp1.scaleDecreaseRateY);

    //       if (esp1.isEnableScaleBySpeedY)
    //         this.scale[1] *= 1 / vec3.length(this.velocity);
    //     } else {
    //       this.scale[1] = this.scale[0];
    //     }
    //   }

    //   if (esp1.isEnableAlpha || esp1.alphaWaveType !== CalcAlphaWaveType.None) {
    //     let alpha: number;

    //     if (this.t < esp1.alphaInTiming)
    //       alpha = esp1.alphaInValue + this.t * esp1.alphaIncreaseRate;
    //     else if (this.t > esp1.alphaOutTiming)
    //       alpha = esp1.alphaBaseValue + ((this.t - esp1.alphaOutTiming) * esp1.alphaDecreaseRate);
    //     else
    //       alpha = esp1.alphaBaseValue;

    //     const flickerWaveAmplitude = this.alphaWaveRandom * esp1.alphaWaveParam3;
    //     const flickerWaveTime = this.alphaWaveRandom * this.tick * MathConstants.TAU / 4;

    //     if (esp1.alphaWaveType === CalcAlphaWaveType.NrmSin) {
    //       const flickerWave = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam1));
    //       const flickerMult = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave - 1.0)));
    //       this.prmColorAlphaAnm = alpha * flickerMult;
    //     } else if (esp1.alphaWaveType === CalcAlphaWaveType.AddSin) {
    //       const flickerWave1 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam1));
    //       const flickerWave2 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam2));
    //       const flickerWave = flickerWave1 + flickerWave2;
    //       const flickerMult = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave - 1.0)));
    //       this.prmColorAlphaAnm = alpha * flickerMult;
    //     } else if (esp1.alphaWaveType === CalcAlphaWaveType.MultSin) {
    //       const flickerWave1 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam1));
    //       const flickerWave2 = Math.sin(flickerWaveTime * (1.0 - esp1.alphaWaveParam2));
    //       const flickerMult1 = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave1 - 1.0)));
    //       const flickerMult2 = 1.0 + (flickerWaveAmplitude * (0.5 * (flickerWave2 - 1.0)));
    //       this.prmColorAlphaAnm = alpha * flickerMult1 * flickerMult2;
    //     } else {
    //       this.prmColorAlphaAnm = alpha;
    //     }
    //   }
    // }

    // this.rotateAngle += this.rotateSpeed * frameData.deltaTime;

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
          100.0 * shapeDef.scale2d[0] * frameData.emitter.scale2D[0],
          100.0 * shapeDef.scale2d[1] * frameData.emitter.scale2D[1],
          1,
          0, 0, 0,// rotateAngle,
          pos[0], pos[1], pos[2]);
      }
      break;
      default: throw new Error('Whoops');
    }

    this.uniforms.setVec4('u_color', [0, 0, 1, 1]);
    this.uniforms.setFloats('u_modelView', modelView);
    this.uniforms.write(gfxDevice);

    renderLists.effects.push(this.prim);
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
    u_color: { type: Type.Float4 },
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
      v0, v0, v0, 1, 0,
      v0, v1, v0, 1, 1,
      v1, v0, v0, 0, 0,
      v1, v1, v0, 0, 1,
      // Cross
      v0, v0, v0, 1, 0,
      v0, v1, v0, 1, 1,
      v0, v0, v1, 0, 0,
      v0, v1, v1, 0, 1,
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

  freeEmitters: Emitter[] = [];
  freeParticles: Particle[] = [];

  globalScale = vec3.fromValues(1, 1, 1);

  constructor(private maxEmitters: number, private maxParticles: number) { }

  initialize(gfxDevice: Renderer, globalUniforms: GlobalUniforms) {
    this.gfxResources.initialize(gfxDevice);

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
  // And all the loaded resource data
  // And the camera matrices that billboards will need

  initialize({ gfxDevice, globalUniforms }: { gfxDevice: Renderer, globalUniforms: GlobalUniforms }) {
    this.emitterManager.initialize(gfxDevice, globalUniforms);
  }

  update({ clock }: { clock: Clock }) {
    const dtSec = clock.renderDt * 0.001;
    this.emitterManager.update(dtSec);
  }

  render({ gfxDevice, camera }: { gfxDevice: Renderer, camera: Camera }) {
    this.emitterManager.render(gfxDevice, camera.viewMatrix);
  }

  createEmitter(emitterId: number) {
    const data = new EmitterData(); // @TODO: Look up in emmitter data resource
    return this.emitterManager.createEmitter(data);
  }
}