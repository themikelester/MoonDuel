// --------------------------------------------------------------------------------
// Animation system from ThreeJS. 
// See https://threejs.org/docs/#manual/en/introduction/Animation-system
// --------------------------------------------------------------------------------

export { QuaternionKeyframeTrack } from 'three/src/animation/tracks/QuaternionKeyframeTrack';
export { VectorKeyframeTrack } from 'three/src/animation/tracks/VectorKeyframeTrack';
export { InterpolationModes, InterpolateLinear, InterpolateDiscrete } from 'three/src/constants';
export { Interpolant } from 'three/src/math/Interpolant';

/**
 * KeyframeTrack is a timed sequence of keyframes, which are composed of lists of times and related values, 
 * and which are used to animate a specific property of an object.
 * @see {@link https://threejs.org/docs/#api/en/animation/KeyframeTrack}
 */
export { KeyframeTrack } from 'three/src/animation/KeyframeTrack';

/**
 * An AnimationClip is a reusable set of keyframe tracks which represent an animation.
 * @see {@link https://threejs.org/docs/#api/en/animation/AnimationClip}
 */
export { AnimationClip } from 'three/src/animation/AnimationClip';

/**
 * The AnimationMixer is a player for animations on a particular object in the scene. 
 * When multiple objects in the scene are animated independently, one AnimationMixer may be used for each object.
 * @see {@link https://threejs.org/docs/#api/en/animation/AnimationMixer}
 */
export { AnimationMixer } from 'three/src/animation/AnimationMixer';