import vertShaderSource from './shaders/arena.vert';
import fragShaderSource from './shaders/arena.frag';

import { ResourceManager } from "./resources/ResourceLoading";
import { Resource } from "./resources/Resource";
import { GltfResource } from "./resources/Gltf";
import { computePackedBufferLayout, UniformBuffer } from "./UniformBuffer";
import { Model } from "./Mesh";
import * as Gfx from "./gfx/GfxTypes";
import { renderLists } from "./RenderList";
import { Material } from "./Mesh";
import { GlobalUniforms } from "./GlobalUniforms";
import { mat4, vec3 } from "gl-matrix";
import { assert } from "./util";
import { DebugMenu } from './DebugMenu';
import { EnvironmentSystem, Environment } from './Environment';

class StageShader implements Gfx.ShaderDescriptor {
  name = 'Stage';
  vertSource = vertShaderSource.sourceCode;
  fragSource = fragShaderSource.sourceCode;

  static uniformLayout: Gfx.BufferLayout = computePackedBufferLayout({
    u_model: { type: Gfx.Type.Float4x4 },
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

  model: Model;
  shader: Gfx.Id;

  private show = true;

  initialize({ resources, gfxDevice, globalUniforms, environment, debugMenu }: { resources: ResourceManager, gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, environment: EnvironmentSystem, debugMenu: DebugMenu }) {
    this.shader = gfxDevice.createShader(new StageShader());
    resources.load(Stage.filename, 'gltf', (error: string | undefined, resource?: Resource) => {
      assert(!error, error);
      this.onResourcesLoaded(gfxDevice, globalUniforms, environment, resource!);
    });

    const menu = debugMenu.addFolder('Stage');
    menu.add(this, 'show');
  }

  onResourcesLoaded(gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, env: EnvironmentSystem, resource: Resource) {
    const gltf = resource as GltfResource;

    const mainTex = gltf.textures[0].id;

    const prim = gltf.meshes[0].primitives[0];
    const material = new Material(gfxDevice, 'Arena', this.shader, StageShader.resourceLayout);
    this.model = new Model(gfxDevice, renderLists.opaque, prim.mesh, material);

    // Scale the model body so that the outer radii match
    const node = gltf.nodes.find(n => n.meshId === 0);
    node?.updateMatrixWorld();
    const modelMat = mat4.fromValues.apply(null, node?.matrixWorld.elements);
    const scale = mat4.fromScaling(mat4.create(), vec3.fromValues(Stage.outerRadius, Stage.outerRadius, Stage.outerRadius));
    mat4.multiply(modelMat, scale, modelMat);
    
    const uniforms = new UniformBuffer('ArenaUniforms', gfxDevice, StageShader.uniformLayout);
    uniforms.setMat4('u_model', modelMat);
    uniforms.write(gfxDevice);
    material.setUniformBuffer(gfxDevice, 'model', uniforms);
    material.setUniformBuffer(gfxDevice, 'env', env.getUniformBuffer());
    material.setUniformBuffer(gfxDevice, 'global', globalUniforms.buffer);

    material.setTexture(gfxDevice, 'u_tex', mainTex);
  }

  render({}) {
    if (!this.show) {
      return;
    }

    if (this.model) this.model.renderList.push(this.model.primitive);
  }
}