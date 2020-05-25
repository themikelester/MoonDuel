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
  });

  static resourceLayout: Gfx.ShaderResourceLayout = {
    global: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    model: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: BackgroundCloudShader.uniformLayout },
    u_tex: { index: 2, type: Gfx.BindingType.Texture },
  };
}

export class Skybox {
  static filename = 'data/Skybox.glb';

  cloudModels: Model[] = [];
  shader: Gfx.Id;

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

  update({ gfxDevice }: { gfxDevice: Gfx.Renderer }) {
    for (const model of this.cloudModels) {
      const uniforms = model.material.getUniformBuffer('model');
      uniforms.setVec4('u_color', [1, 0, 0, 1]);
      uniforms.setFloat('u_scroll', 0.0);
      uniforms.write(gfxDevice);
    }
  }

  render({}) {
    if (this.cloudModels.length > 0) {
      if (this.enableFarClouds) this.cloudModels[0].renderList.push(this.cloudModels[0].primitive);
      if (this.enableMiddleClouds) this.cloudModels[1].renderList.push(this.cloudModels[1].primitive);
      if (this.enableNearClouds) this.cloudModels[2].renderList.push(this.cloudModels[2].primitive);
    }
  }
}