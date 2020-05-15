// --------------------------------------------------------------------------------
// Bone: https://threejs.org/docs/#api/en/objects/Bone
// Basically an Object3D that identifies itself as a Bone for easier searching
// --------------------------------------------------------------------------------
export { Bone } from 'three/src/objects/Bone';

// --------------------------------------------------------------------------------
// Skeleton: https://threejs.org/docs/#api/en/objects/Skeleton
// A Skin instance where each bone can be posed individually. Manages its own array of matrices.
// These will be manipulated during animation, and loaded into uniform buffers during rendering.
// --------------------------------------------------------------------------------
export { Skeleton } from 'three/src/objects/Skeleton';

import { Renderer } from './gfx/GfxTypes';
import { DebugRenderUtils } from './DebugRender';
import { GlobalUniforms } from './GlobalUniforms';
import { vec4, vec3 } from 'gl-matrix';
import { Skeleton } from 'three/src/objects/Skeleton';
import { Vector3 } from './Object3D';

const colorScratch = vec4.fromValues(1,0,0,1);
const scratch3Vec = new Vector3(vec3.create());
const scratchPoints = new Array(64 * 2).fill(0).map(a => vec3.create());

export function drawSkeleton(skeleton: Skeleton, color: vec4 = colorScratch) {
  const pointPairs: vec3[] = scratchPoints;
  if (!skeleton) return;

  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i];
    const parent = bone.parent;

    if (parent) {
      scratch3Vec.setBuffer(pointPairs[i * 2 + 0]);
      parent.getWorldPosition(scratch3Vec);

      scratch3Vec.setBuffer(pointPairs[i * 2 + 1]);
      bone.getWorldPosition(scratch3Vec);
    }
  }

  DebugRenderUtils.renderLines(pointPairs.slice(0, skeleton.bones.length * 2), color);
}