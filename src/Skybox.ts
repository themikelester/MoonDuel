import bgCloudVertSource from './shaders/skybox.vert';
import bgCloudFragSource from './shaders/skybox.frag';
import simpleVertSource from './shaders/simple.vert';
import simpleFragSource from './shaders/simple.frag';
import fadeVertSource from './shaders/fade.vert';
import fadeFragSource from './shaders/fade.frag';

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
    u_scroll: { type: Gfx.Type.Float },
    u_yOffset: { type: Gfx.Type.Float },
  });

  static resourceLayout: Gfx.ShaderResourceLayout = {
    global: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    model: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: BackgroundCloudShader.uniformLayout },
    u_tex: { index: 2, type: Gfx.BindingType.Texture },
  };
}

class FlatShader implements Gfx.ShaderDescriptor {
  name = 'Flat';
  vertSource = simpleVertSource.sourceCode;
  fragSource = simpleFragSource.sourceCode;

  static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
    u_color: { type: Gfx.Type.Float4 },
  });

  static resourceLayout: Gfx.ShaderResourceLayout = {
    global: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    model: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: FlatShader.uniformLayout },
  };
}

class FadeShader implements Gfx.ShaderDescriptor {
  name = 'Fade';
  vertSource = fadeVertSource.sourceCode;
  fragSource = fadeFragSource.sourceCode;

  static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
    u_colorA: { type: Gfx.Type.Float4 },
    u_colorB: { type: Gfx.Type.Float4 },
    u_height: { type: Gfx.Type.Float },
    u_yOffset: { type: Gfx.Type.Float },
  });

  static resourceLayout: Gfx.ShaderResourceLayout = {
    global: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    model: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: FadeShader.uniformLayout },
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

  flatShader: Gfx.Id;
  fadeShader: Gfx.Id;
  bgCloudShader: Gfx.Id;

  skyModel: Model;
  oceanModel: Model;
  bgHazeModel: Model;
  fgHazeModel: Model;

  cloudModels: Model[] = [];
  cloudScrollNear = 0.0;
  cloudScrollMid = 0.0;
  cloudScrollFar = 0.0;

  private enableSky = true;
  private enableFarHaze = true;
  private enableFarClouds = true;
  private enableMiddleClouds = true;
  private enableNearClouds = true;
  private enableNearHaze = true;
  private enableOcean = true;
  
  private yOffset = 0;
  private cloudYOffset = -3;
  private farHazeYOffset = -4.3;
  private farHazeHeight = 27;
  private nearHazeHeight = 18;
  private nearHazeYOffset = 0.1;

  initialize({ resources, gfxDevice, globalUniforms, debugMenu }: Dependencies) {
    this.bgCloudShader = gfxDevice.createShader(new BackgroundCloudShader());
    this.flatShader = gfxDevice.createShader(new FlatShader());
    this.fadeShader = gfxDevice.createShader(new FadeShader());

    resources.load(Skybox.filename, 'gltf', (error: string | undefined, resource?: Resource) => {
      assert(!error, error);
      this.onResourcesLoaded(gfxDevice, globalUniforms, resource!);
    });

    const menu = debugMenu.addFolder('Skybox');
    menu.add(this, 'enableSky');
    menu.add(this, 'enableFarHaze');
    menu.add(this, 'enableFarClouds');
    menu.add(this, 'enableMiddleClouds');
    menu.add(this, 'enableNearClouds');
    menu.add(this, 'enableNearHaze');
    menu.add(this, 'enableOcean');
    menu.add(this, 'yOffset', -50, 20);
    menu.add(this, 'cloudYOffset', -10, 20, 0.25);
    menu.add(this, 'farHazeYOffset', -50, 50);
    menu.add(this, 'farHazeHeight', 5, 50);
    menu.add(this, 'nearHazeYOffset', -50, 50);
    menu.add(this, 'nearHazeHeight', 5, 50);
  }

  onResourcesLoaded(gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, resource: Resource) {
    const gltf = resource as GltfResource;

    const createCloudModel = (gltfMesh: GltfMesh) => {
      const mesh = gltfMesh.primitives[0].mesh;
      const material = new Material(gfxDevice, 'BackgroundCloud', this.bgCloudShader, BackgroundCloudShader.resourceLayout);
      const model = new Model(gfxDevice, renderLists.skybox, mesh, material);
      material.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);
      material.setUniformBuffer(gfxDevice, 'model', new UniformBuffer('CloudUniforms', gfxDevice, BackgroundCloudShader.uniformLayout));
      return model;
    }

    // Sky
    const skyMesh = assertDefined(gltf.meshes.find(m => m.name === 'Sky')).primitives[0].mesh;
    const skyMaterial = new Material(gfxDevice, 'Sky', this.flatShader, FlatShader.resourceLayout);
    skyMaterial.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);
    skyMaterial.setUniformBuffer(gfxDevice, 'model', new UniformBuffer('SkyUniforms', gfxDevice, FlatShader.uniformLayout));
    this.skyModel = new Model(gfxDevice, renderLists.skybox, skyMesh, skyMaterial);

    // Haze
    const hazeMesh = assertDefined(gltf.meshes.find(m => m.name === 'Haze')).primitives[0].mesh;
    const hazeMaterial = new Material(gfxDevice, 'Haze', this.fadeShader, FadeShader.resourceLayout);
    hazeMaterial.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);
    hazeMaterial.setUniformBuffer(gfxDevice, 'model', new UniformBuffer('HazeUniforms', gfxDevice, FadeShader.uniformLayout));
    this.bgHazeModel = new Model(gfxDevice, renderLists.skybox, hazeMesh, hazeMaterial);
    const fgHazeMaterial = new Material(gfxDevice, 'Haze', this.fadeShader, FadeShader.resourceLayout);
    fgHazeMaterial.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);
    fgHazeMaterial.setUniformBuffer(gfxDevice, 'model', new UniformBuffer('HazeUniforms', gfxDevice, FadeShader.uniformLayout));
    this.fgHazeModel = new Model(gfxDevice, renderLists.skybox, hazeMesh, fgHazeMaterial);
      
    // Background ocean
    const oceanMesh = assertDefined(gltf.meshes.find(m => m.name === 'Ocean')).primitives[0].mesh;
    const oceanMaterial = new Material(gfxDevice, 'Ocean', this.flatShader, FlatShader.resourceLayout);
    oceanMaterial.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);
    oceanMaterial.setUniformBuffer(gfxDevice, 'model', new UniformBuffer('OceanUniforms', gfxDevice, FlatShader.uniformLayout));
    this.oceanModel = new Model(gfxDevice, renderLists.skybox, oceanMesh, oceanMaterial);

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

    // Clouds
    const scrollSpeed = clock.renderDt * windPower * 0.000015 * ((-windX * camZ) - (-windZ * camX));
    this.cloudScrollNear = (this.cloudScrollNear + 1.0 * scrollSpeed) % 1.0;
    this.cloudScrollMid = (this.cloudScrollMid + 0.8 * scrollSpeed) % 1.0;
    this.cloudScrollFar = (this.cloudScrollFar + 0.6 * scrollSpeed) % 1.0;

    const farUniforms = this.cloudModels[0].material.getUniformBuffer('model');
    const midUniforms = this.cloudModels[1].material.getUniformBuffer('model');
    const nearUniforms = this.cloudModels[2].material.getUniformBuffer('model');

    farUniforms.setFloat('u_scroll', this.cloudScrollFar);
    midUniforms.setFloat('u_scroll', this.cloudScrollMid);
    nearUniforms.setFloat('u_scroll', this.cloudScrollNear);

    farUniforms.setVec4('u_color', light.cloudColor);
    midUniforms.setVec4('u_color', light.cloudColor);
    nearUniforms.setVec4('u_color', light.cloudColor);

    farUniforms.setFloat('u_yOffset', this.cloudYOffset + this.yOffset);
    midUniforms.setFloat('u_yOffset', this.cloudYOffset + this.yOffset);
    nearUniforms.setFloat('u_yOffset', this.cloudYOffset + this.yOffset);

    farUniforms.write(gfxDevice);
    midUniforms.write(gfxDevice);
    nearUniforms.write(gfxDevice);

    // Sky
    const skyUniforms = this.skyModel.material.getUniformBuffer('model');
    skyUniforms.setVec4('u_color', light.skyColor);
    skyUniforms.write(gfxDevice);

    // Ocean
    const oceanUniforms = this.oceanModel.material.getUniformBuffer('model');
    oceanUniforms.setVec4('u_color', light.oceanColor);
    oceanUniforms.write(gfxDevice);

    // Far Haze 
    const hazeUniforms = this.bgHazeModel.material.getUniformBuffer('model');
    hazeUniforms.setVec4('u_colorA', light.hazeColor);
    hazeUniforms.setVec4('u_colorB', light.skyColor);
    hazeUniforms.setFloat('u_height', this.farHazeHeight);
    hazeUniforms.setFloat('u_yOffset', this.farHazeYOffset + this.yOffset);
    hazeUniforms.write(gfxDevice);

    // Near Haze
    const fgHazeUniforms = this.fgHazeModel.material.getUniformBuffer('model');
    const hazeColor = vec4.clone(light.hazeColor);
    const hazeAlpha = light.cloudColor[3];
    hazeColor[3] = hazeAlpha;
    fgHazeUniforms.setVec4('u_colorA', hazeColor);
    hazeColor[3] = 0.0;
    fgHazeUniforms.setVec4('u_colorB', hazeColor);
    fgHazeUniforms.setFloat('u_height', this.nearHazeHeight);
    fgHazeUniforms.setFloat('u_yOffset', this.nearHazeYOffset + this.yOffset);
    fgHazeUniforms.write(gfxDevice);
  }

  render({}) {
    if (this.cloudModels.length > 0) {
      if (this.enableSky) this.skyModel.renderList.push(this.skyModel.primitive);
      if (this.enableFarHaze) this.bgHazeModel.renderList.push(this.bgHazeModel.primitive);

      if (this.enableFarClouds) this.cloudModels[0].renderList.push(this.cloudModels[0].primitive);
      if (this.enableMiddleClouds) this.cloudModels[1].renderList.push(this.cloudModels[1].primitive);
      if (this.enableNearClouds) this.cloudModels[2].renderList.push(this.cloudModels[2].primitive);

      if (this.enableNearHaze) this.fgHazeModel.renderList.push(this.fgHazeModel.primitive);

      if (this.enableOcean) this.oceanModel.renderList.push(this.oceanModel.primitive);
    }
  }
}