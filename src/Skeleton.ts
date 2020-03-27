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
