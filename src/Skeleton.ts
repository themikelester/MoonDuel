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

export class SkeletonComponent extends Skeleton implements Component {
  constructor() {
    super([]);
  }

  static create(skeleton: SkeletonComponent, bones: Bone[], boneInverses?: Matrix4[]) {
    Skeleton.call(skeleton, bones, boneInverses);
  }

  static getJointByName(skeleton: SkeletonComponent, name: string): Bone | undefined {
    return skeleton.bones.find(n => n.name === name);
  }
}