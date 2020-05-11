// --------------------------------------------------------------------------------
// Bone: https://threejs.org/docs/#api/en/objects/Bone
// Basically an Object3D that identifies itself as a Bone for easier searching

import { Component } from './Component';

// --------------------------------------------------------------------------------
export { Bone } from 'three/src/objects/Bone';

// --------------------------------------------------------------------------------
// Skeleton: https://threejs.org/docs/#api/en/objects/Skeleton
// A Skin instance where each bone can be posed individually. Manages its own array of matrices.
// These will be manipulated during animation, and loaded into uniform buffers during rendering.
// --------------------------------------------------------------------------------
export { Skeleton } from 'three/src/objects/Skeleton';

import { Bone } from 'three/src/objects/Bone';
import { Skeleton } from 'three/src/objects/Skeleton';
import { Matrix4 } from './Object3D';
import * as Gfx from './gfx/GfxTypes';
import { System, World } from './World';

export class SkeletonComponent extends Skeleton implements Component {
  constructor() {
    super([]);
  }

  static create(skeleton: SkeletonComponent, bones: Bone[], boneInverses?: Matrix4[]) {
    Skeleton.call(skeleton, bones, boneInverses);
    skeleton.pose();
  }

  static getJointByName(skeleton: SkeletonComponent, name: string): Bone | undefined {
    return skeleton.bones.find(n => n.name === name);
  }
}

export class SkinComponent implements Component {
  boneTex: Gfx.Id;

  static create(skin: SkinComponent, renderer: Gfx.Renderer, skeleton: SkeletonComponent) {
    const desc: Gfx.TextureDescriptor = {
      type: Gfx.TextureType.Texture2D,
      format: Gfx.TexelFormat.F32x4,
      usage: Gfx.Usage.Dynamic,
      width: 4,
      height: skeleton.bones.length,
      defaultMinFilter: Gfx.TextureFilter.Nearest,
      defaultMagFilter: Gfx.TextureFilter.Nearest,
    };

    skin.boneTex = renderer.createTexture('BoneTex', desc, skeleton.boneMatrices);
    return skin;
  }
}

export abstract class SkeletonSystem implements System {
  static initialize(world: World) {
    world.addFamily('Skeletons', SkeletonComponent);
    world.addFamily('Skins', SkeletonComponent, SkinComponent);
  }
  
  static update(world: World) {
    const skeletons = world.getFamily('Skeletons');
    const skins = world.getFamily('Skins');
    const renderer = world.getSingletonRenderer();

    for (const e of skeletons.entities) {
      e.getComponent(SkeletonComponent).update();
    }

    for (const e of skins.entities) {
      const skin = e.getComponent(SkinComponent);
      const skeleton = e.getComponent(SkeletonComponent)
      renderer.writeTextureData(skin.boneTex, skeleton.boneMatrices);
    }
  }
}