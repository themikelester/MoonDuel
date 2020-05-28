import { vec4, vec3 } from "gl-matrix";
import { BufferLayout, Type, Renderer } from "./gfx/GfxTypes";
import { computePackedBufferLayout, UniformBuffer } from "./UniformBuffer";
import { DebugMenu } from "./DebugMenu";

export interface DiffuseAmbient {
  diffuse: vec4,
  ambient: vec4,
}

export class LightInfluence {
  position: vec3 = vec3.create();
  color: vec4 = vec4.create();
  power: number = 0.0;
  fluctuation: number = 0.0;
}

export class Environment {
  // Stage
  actorColor: DiffuseAmbient = { diffuse: vec4.create(), ambient: vec4.create() };
  backgroundColor: DiffuseAmbient = { diffuse: vec4.create(), ambient: vec4.create() };

  // Skybox 
  hazeColor: vec4 = vec4.create();
  cloudCenterColor: vec4 = vec4.create();
  cloudColor: vec4 = vec4.create();
  skyColor: vec4 = vec4.create();
  oceanColor: vec4 = vec4.create();

  // Wind 
  windPower: number;
  windVec: vec3 = vec3.create();

  // Lights
  baseLight: LightInfluence = new LightInfluence();
  localLights: LightInfluence[] = [];

  // Sun/Moon
  moonPos: vec3 = vec3.create();

  addLocalLight(light: LightInfluence) {
    this.localLights.push(light);
  }
}

const kNightSkybox = {
  hazeColor: vec4.fromValues(0.23529411764705882, 0.29411764705882354, 0.39215686274509803, 1),
  cloudCenterColor: vec4.fromValues(0.22745098039215686, 0.39215686274509803, 0.5254901960784314, 0),
  cloudColor: vec4.fromValues(0.20392156862745098, 0.33725490196078434, 0.47058823529411764, 0.39215686274509803),
  skyColor: vec4.fromValues(0.0392156862745098, 0.19607843137254902, 0.3333333333333333, 1),
  oceanColor: vec4.fromValues(0, 0.19215686274509805, 0.2901960784313726, 1),
}

const kNightPalette = {
  blendPaletteAB: 0.7710301333335425,
  actorColor: {
    diffuse: vec4.fromValues(0.4666666666666667, 0.5803921568627451, 0.6901960784313725, 1 ),
    ambient: vec4.fromValues(0.3176470588235294, 0.39215686274509803, 0.5803921568627451, 1 ),
  },
  backgroundColor: [
    {
      diffuse: vec4.fromValues(0.19215686274509805, 0.30980392156862746, 0.44313725490196076, 1),
      ambient: vec4.fromValues(0.2901960784313726, 0.5490196078431373, 0.6627450980392157, 1),
    }, {
      diffuse: vec4.fromValues(0.0, 0.4117647058823529, 0.6078431372549019, 1),
      ambient: vec4.fromValues(0.027450980392156862, 0.23137254901960785, 0.39215686274509803, 1),
    }, {
      diffuse: vec4.fromValues(1.0, 0.8901960784313725, 0.48627450980392156, 1),
      ambient: vec4.fromValues(0.792156862745098, 0.5686274509803921, 0.592156862745098, 1),
    }, {
      diffuse: vec4.fromValues(1.0, 0.8117647058823529, 0.12941176470588237, 1 ),
      ambient: vec4.fromValues(0.0, 0, 0, 1 ),
    }
  ],
  fogColor: vec4.fromValues(0.09019607843137255, 0.12549019607843137, 0.20392156862745098, 1),
  fogEndZ: 30000,
  fogStartZ: 10000,
}

const kEnvBufferLayout: BufferLayout = computePackedBufferLayout({
  u_actorDiffuse: { type: Type.Float4 }, // @TODO: Ubyte4 normalized
  u_actorAmbient: { type: Type.Float4 },
  u_backgroundDiffuse: { type: Type.Float4 },
  u_backgroundAmbient: { type: Type.Float4 },

  u_hazeColor: { type: Type.Float4 },
  u_cloudColor: { type: Type.Float4 },
  u_skyColor: { type: Type.Float4 },
  u_oceanColor: { type: Type.Float4 },

  u_baseLightPos: { type: Type.Float3 },
  u_baseLightColor: { type: Type.Float4 },
});

export class EnvironmentSystem {
  private uniforms: UniformBuffer;
  private current: Environment = new Environment();

  private moonAzimuth: number = Math.PI * 0.25;
  private moonPolar: number = Math.PI * 0.25;

  initialize({ gfxDevice, debugMenu }: { gfxDevice: Renderer, debugMenu: DebugMenu }) {
    this.uniforms = new UniformBuffer('EnvUniforms', gfxDevice, kEnvBufferLayout);

    const menu = debugMenu.addFolder('Environment');
    menu.add(this, 'moonAzimuth', 0.001, Math.PI * 2.0);
    menu.add(this, 'moonPolar', 0.001, Math.PI * 0.5);
  }

  update({ gfxDevice }: { gfxDevice: Renderer}) {
    const x = Math.cos(this.moonAzimuth) * Math.cos(this.moonPolar);
    const z = Math.sin(this.moonAzimuth) * Math.cos(this.moonPolar);
    const y = Math.sin(this.moonPolar);
    vec3.set(this.current.moonPos, x * 100000, y * 100000, z * 100000);

    // Update Sun/Moon light info
    this.current.baseLight.position = this.current.moonPos; 
    vec4.set(this.current.baseLight.color, 1, 1, 1, 1);
    this.current.baseLight.power = 0.0;
    this.current.baseLight.fluctuation = 0.0;

    // Update environment
    // @HACK: For now, we only have a single environment (night), so no blending
    Object.assign(this.current, kNightSkybox);
    this.current.actorColor = kNightPalette.actorColor;
    this.current.backgroundColor = kNightPalette.backgroundColor[0];
    this.current.windPower = 1.0
    vec3.set(this.current.windVec, 0, 0, 1);

    // Copy env values into uniform buffer
    this.uniforms.setVec4('u_actorDiffuse', this.current.actorColor.diffuse);
    this.uniforms.setVec4('u_actorAmbient', this.current.actorColor.diffuse);
    this.uniforms.setVec4('u_backgroundDiffuse', this.current.backgroundColor.diffuse);
    this.uniforms.setVec4('u_backgroundAmbient', this.current.backgroundColor.ambient);
    this.uniforms.setVec4('u_hazeColor', this.current.hazeColor);
    this.uniforms.setVec4('u_cloudColor', this.current.cloudColor);
    this.uniforms.setVec4('u_skyColor', this.current.skyColor);
    this.uniforms.setVec4('u_oceanColor', this.current.oceanColor);
    this.uniforms.setVec3('u_baseLightPos', this.current.baseLight.position);
    this.uniforms.setVec3('u_baseLightColor', this.current.baseLight.color);
    this.uniforms.write(gfxDevice);
  }

  static get bufferLayout() {
    return kEnvBufferLayout;
  }

  getUniformBuffer() {
    return this.uniforms;
  }

  getCurrentEnvironment() {
    return this.current;
  }
}