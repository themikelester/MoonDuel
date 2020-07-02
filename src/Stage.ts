import vertShaderSource from './shaders/arena.vert';
import fragShaderSource from './shaders/arena.frag';

import { ResourceManager } from "./resources/ResourceLoading";
import { Resource } from "./resources/Resource";
import { GltfResource, GltfNode } from "./resources/Gltf";
import { computePackedBufferLayout, UniformBuffer } from "./UniformBuffer";
import { Model } from "./Mesh";
import * as Gfx from "./gfx/GfxTypes";
import { renderLists } from "./RenderList";
import { Material } from "./Mesh";
import { GlobalUniforms } from "./GlobalUniforms";
import { mat4, vec3, vec4, vec2 } from "gl-matrix";
import { assert, defined, assertDefined } from "./util";
import { DebugMenu } from './DebugMenu';
import { EnvironmentSystem, Environment } from './Environment';
import { ParticleSystem } from './Particles';
import { Renderer } from './gfx/GfxTypes';
import { lerp } from './MathHelpers';
import { AudioMixer, AudioChannel } from './Audio';
import { SoundResource } from './resources/Sound';

const scratchVec4a = vec4.create();

const kWindFilename = 'data/windLoop.mp3';
const kFireFilename = 'data/furnaceFire.mp3';

class StageShader implements Gfx.ShaderDescriptor {
  name = 'Stage';
  vertSource = vertShaderSource.sourceCode;
  fragSource = fragShaderSource.sourceCode;

  static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
    u_model: { type: Gfx.Type.Float4x4 },
    u_torchColor: { type: Gfx.Type.Float4 },
  });

  static resourceLayout: Gfx.ShaderResourceLayout = {
    model: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: StageShader.uniformLayout },
    global: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    env: { index: 2, type: Gfx.BindingType.UniformBuffer, layout: EnvironmentSystem.bufferLayout },
    u_tex: { index: 2, type: Gfx.BindingType.Texture },
  };
}

export class Stage {
  static filename = 'data/Arena.glb';
  static outerRadius = 2000;

  models: Model[] = [];
  shader: Gfx.Id;

  private windVolume = 0.5;
  private windPitch = 1.0;
  private windPause: boolean = false;
  private windChannel: AudioChannel;

  private show = true;
  private torchPower = 3000;
  private torchColor = [225, 111, 10, 1.0];
  private torchFlicker = 1.0;

  initialize({ resources, gfxDevice, globalUniforms, environment, particles, mixer, debugMenu }: { resources: ResourceManager, gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, environment: EnvironmentSystem, mixer: AudioMixer, debugMenu: DebugMenu, particles: ParticleSystem }) {
    this.shader = gfxDevice.createShader(new StageShader());

    resources.load(kFireFilename, 'sound', (error: string | undefined, resource?: SoundResource) => {});

    resources.load(Stage.filename, 'gltf', (error: string | undefined, resource?: Resource) => {
      assert(!error, error);
      this.onResourcesLoaded(gfxDevice, globalUniforms, environment, resource!, particles, resources, mixer);
    });

    resources.load(kWindFilename, 'sound', (error: string | undefined, resource?: SoundResource) => {
      console.log('Loaded sound:', resource?.source);
      this.windChannel = mixer.playSound(resource!, { loop: true, volume: this.windVolume, pitch: this.windPitch });
      if (this.windPause) { this.windChannel.pause(); }
    });

    const menu = debugMenu.addFolder('Stage');
    menu.add(this, 'show');
    menu.add(this, 'torchPower', 0.0, 10000);
    menu.add(this, 'windVolume', 0.0, 1.0).onChange(val => { if (this.windChannel) this.windChannel.setVolume(this.windVolume) });
    menu.add(this, 'windPitch', 0.1, 4.0).onChange(val => { if (this.windChannel) this.windChannel.setPitch(this.windPitch) });
    menu.add(this, 'windPause').onChange(val => { 
      if (this.windChannel) { 
        if (this.windPause) this.windChannel.pause();
        else this.windChannel.play();
      }
    });
    menu.addColor(this, 'torchColor');
  }

  onResourcesLoaded(gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, env: EnvironmentSystem, resource: Resource, particles: ParticleSystem, resources: ResourceManager, mixer: AudioMixer) {
    const gltf = resource as GltfResource;

    for (const node of gltf.nodes) {
      if (defined(node.meshId)) {
        const gltfMesh = gltf.meshes[node.meshId];
        const prim = gltfMesh.primitives[0];

        const mainTex = gltf.textures[0].id;

        const material = new Material(gfxDevice, 'Arena', this.shader, StageShader.resourceLayout);
        const model = new Model(gfxDevice, renderLists.opaque, prim.mesh, material);

        // Scale the model body so that the outer radii match
        node?.updateMatrixWorld();
        const modelMat = mat4.fromValues.apply(null, node?.matrixWorld.elements);
        const scale = mat4.fromScaling(mat4.create(), vec3.fromValues(Stage.outerRadius, Stage.outerRadius, Stage.outerRadius));
        mat4.multiply(modelMat, scale, modelMat);

        if (gltfMesh.name === 'Sconce') {
          loadSconce(modelMat, env.getCurrentEnvironment(), particles, mixer, resources);
        }
        
        const uniforms = new UniformBuffer('ArenaUniforms', gfxDevice, StageShader.uniformLayout);
        uniforms.setMat4('u_model', modelMat);
        uniforms.write(gfxDevice);
        material.setUniformBuffer(gfxDevice, 'model', uniforms);
        material.setUniformBuffer(gfxDevice, 'env', env.getUniformBuffer());
        material.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);

        material.setTexture(gfxDevice, 'u_tex', mainTex);

        this.models.push(model);
      }
    }
  }

  render({ environment, gfxDevice }: { environment: EnvironmentSystem, gfxDevice: Renderer }) {
    if (!this.show) {
      return;
    }

    const env = environment.getCurrentEnvironment();
    
    // Handle flickering of lights
    const flicker = (1.0 - Math.random() * 0.3);
    this.torchFlicker = lerp(this.torchFlicker, flicker, 0.2);

    for (let i = 0; i < env.localLights.length; i++) {
      const light = env.localLights[i];
      light.power = this.torchPower * this.torchFlicker;
      vec4.set(light.color, 
        this.torchColor[0] / 255.0, this.torchColor[1] / 255.0, this.torchColor[2] / 255.0, this.torchColor[3] / 255.0);
    }

    if (this.models.length > 0) {
      const uniforms = this.models[0].material.getUniformBuffer('model');
      uniforms.setVec4('u_torchColor', vec4.scale(scratchVec4a, env.localLights[0].color, this.torchFlicker));
      uniforms.write(gfxDevice)
    }

    for (let i = 0; i < this.models.length; i++) {
      if (this.models[i]) this.models[i].renderList.push(this.models[i].primitive);
    }
  }
}

function loadSconce(transform: mat4, environment: Environment, particles: ParticleSystem, mixer: AudioMixer, resources: ResourceManager) {
  environment.addLocalLight({
    position: mat4.getTranslation(vec3.create(), transform),
    color: vec4.fromValues(1, 0, 0, 1),
    fluctuation: 0.9,
    power: 400
  });

  const emitter = assertDefined(particles.createEmitter(0));
  mat4.getTranslation(emitter.pos, transform);
  emitter.pos[1] += 100;
  vec2.set(emitter.scale2D, 3, 3);

  resources.load(kFireFilename, 'sound', (error: string | undefined, resource?: SoundResource) => {
    const fireChannel = mixer.playSound3d(resource!, { loop: true, size: 400, rolloffFactor: 3.0 });
    fireChannel.setPosition(emitter.pos);
  });
}