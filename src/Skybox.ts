import bgCloudVertSource from './shaders/skybox.vert';
import bgCloudFragSource from './shaders/skybox.frag';


import { Model, Material, IMesh } from "./Mesh";
import * as Gfx from "./gfx/GfxTypes";
import { GltfResource, GltfMesh } from "./resources/Gltf";
import { Resource } from "./resources/Resource";
import { ResourceManager } from "./resources/ResourceLoading";
import { GlobalUniforms } from "./GlobalUniforms";
import { assert, assertDefined } from "./util";
import { computePackedBufferLayout, UniformBuffer } from './UniformBuffer';
import { renderLists } from './RenderList';
import { DebugMenu } from './DebugMenu';
import { Clock } from './Clock';
import { vec3, vec4 } from 'gl-matrix';
import { Camera } from './Camera';

const scratchVec3a = vec3.create();

interface Dependencies { 
  resources: ResourceManager, 
  gfxDevice: Gfx.Renderer, 
  globalUniforms: GlobalUniforms, 
  debugMenu: DebugMenu 
}

class BackgroundCloudShader implements Gfx.ShaderDescriptor {
  name = 'BackgroundCloud';
  vertSource = bgCloudVertSource.sourceCode;
  fragSource = bgCloudFragSource.sourceCode;

  static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
    u_color: { type: Gfx.Type.Float4 },
    u_scrollColor: { type: Gfx.Type.Float },
    u_scrollAlpha: { type: Gfx.Type.Float },
  });

  static resourceLayout: Gfx.ShaderResourceLayout = {
    global: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    model: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: BackgroundCloudShader.uniformLayout },
    u_tex: { index: 2, type: Gfx.BindingType.Texture },
  };
}

const kNightLight = {
  hazeColor: vec4.fromValues(0.23529411764705882, 0.29411764705882354, 0.39215686274509803, 1),
  cloudCenterColor: vec4.fromValues(0.22745098039215686, 0.39215686274509803, 0.5254901960784314, 0),
  cloudColor: vec4.fromValues(0.20392156862745098, 0.33725490196078434, 0.47058823529411764, 0.39215686274509803),
  skyColor: vec4.fromValues(0.0392156862745098, 0.19607843137254902, 0.3333333333333333, 1),
  oceanColor: vec4.fromValues(0, 0.19215686274509805, 0.2901960784313726, 1),
}

export class Skybox {
  static filename = 'data/Skybox.glb';

  cloudModels: Model[] = [];
  shader: Gfx.Id;

  cloudScrollNear = 0.0;
  cloudScrollMid = 0.0;
  cloudScrollFar = 0.0;
  cloudScrollFarAlpha = 0.0;

  private enableNearClouds = true;
  private enableMiddleClouds = true;
  private enableFarClouds = true;

  initialize({ resources, gfxDevice, globalUniforms, debugMenu }: Dependencies) {
    this.shader = gfxDevice.createShader(new BackgroundCloudShader());

    resources.load(Skybox.filename, 'gltf', (error: string | undefined, resource?: Resource) => {
      assert(!error, error);
      this.onResourcesLoaded(gfxDevice, globalUniforms, resource!);
    });

    const menu = debugMenu.addFolder('Skybox');
    menu.add(this, 'enableNearClouds');
    menu.add(this, 'enableMiddleClouds');
    menu.add(this, 'enableFarClouds');
  }

  onResourcesLoaded(gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, resource: Resource) {
    const gltf = resource as GltfResource;

    const createCloudModel = (gltfMesh: GltfMesh) => {
      const mesh = gltfMesh.primitives[0].mesh;
      const material = new Material(gfxDevice, 'BackgroundCloud', this.shader, BackgroundCloudShader.resourceLayout);
      const model = new Model(gfxDevice, renderLists.skybox, mesh, material);
      material.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);
      material.setUniformBuffer(gfxDevice, 'model', new UniformBuffer('CloudUniforms', gfxDevice, BackgroundCloudShader.uniformLayout));
      return model;
    }

    // Background clouds
    const cloudTexNear = gltf.textures[0].id;
    const cloudTexMiddle = gltf.textures[1].id;
    const cloudNear = assertDefined(gltf.nodes.find(m => m.name === 'CloudNear'));
    const cloudMiddle = assertDefined(gltf.nodes.find(m => m.name === 'CloudMiddle'));
    const cloudFar = assertDefined(gltf.nodes.find(m => m.name === 'CloudFar'));
    
    const cloudModelNear = createCloudModel(gltf.meshes[cloudNear.meshId!]);
    const cloudModelMiddle = createCloudModel(gltf.meshes[cloudMiddle.meshId!]);
    const cloudModelFar = createCloudModel(gltf.meshes[cloudFar.meshId!]);

    cloudModelNear.material.setTexture(gfxDevice, 'u_tex', cloudTexNear);
    cloudModelMiddle.material.setTexture(gfxDevice, 'u_tex', cloudTexMiddle);
    cloudModelFar.material.setTexture(gfxDevice, 'u_tex', cloudTexNear);

    this.cloudModels.push(cloudModelFar, cloudModelMiddle, cloudModelNear);
  }

  update({ gfxDevice, clock, camera }: { gfxDevice: Gfx.Renderer, clock: Clock, camera: Camera }) {
    if (this.cloudModels.length === 0) {
      return;
    }
    
    // @TODO: Get these from the environment system
    const windPower = 1.0;
    const windVec = vec3.fromValues(0, 0, 1);
    const light = kNightLight;

    const camX = camera.forward[0];
    const camZ = camera.forward[2];
    const windX = windVec[0];
    const windZ = windVec[2];

    const scrollSpeed = clock.renderDt * windPower * 0.000015 * ((-windX * camZ) - (-windZ * camX));
    this.cloudScrollNear = (this.cloudScrollNear + 1.0 * scrollSpeed) % 1.0;
    this.cloudScrollMid = (this.cloudScrollMid + 0.8 * scrollSpeed) % 1.0;
    this.cloudScrollFar = (this.cloudScrollFar + 0.6 * scrollSpeed) % 1.0;
    this.cloudScrollFarAlpha = (this.cloudScrollFarAlpha + 1.6 * scrollSpeed) % 1.0;

    const farUniforms = this.cloudModels[0].material.getUniformBuffer('model');
    const midUniforms = this.cloudModels[1].material.getUniformBuffer('model');
    const nearUniforms = this.cloudModels[2].material.getUniformBuffer('model');

    farUniforms.setFloat('u_scrollColor', this.cloudScrollFar);
    midUniforms.setFloat('u_scrollColor', this.cloudScrollMid);
    nearUniforms.setFloat('u_scrollColor', this.cloudScrollNear);

    farUniforms.setFloat('u_scrollAlpha', this.cloudScrollFarAlpha);
    midUniforms.setFloat('u_scrollAlpha', this.cloudScrollMid);
    nearUniforms.setFloat('u_scrollAlpha', this.cloudScrollNear);

    farUniforms.setVec4('u_color', light.cloudColor);
    midUniforms.setVec4('u_color', light.cloudColor);
    nearUniforms.setVec4('u_color', light.cloudColor);

    farUniforms.write(gfxDevice);
    midUniforms.write(gfxDevice);
    nearUniforms.write(gfxDevice);
  }

  render({}) {
    if (this.cloudModels.length > 0) {
      if (this.enableFarClouds) this.cloudModels[0].renderList.push(this.cloudModels[0].primitive);
      if (this.enableMiddleClouds) this.cloudModels[1].renderList.push(this.cloudModels[1].primitive);
      if (this.enableNearClouds) this.cloudModels[2].renderList.push(this.cloudModels[2].primitive);
    }
  }
}