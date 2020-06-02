import { mat4, vec3 } from "gl-matrix";

export const enum MathConstants {
  DEG_TO_RAD = 0.01745, // Math.PI / 180,
  RAD_TO_DEG = 57.2947, // 180 / Math.PI,
  TAU = 6.283, // Math.PI * 2
  EPSILON = 0.000001,
}

export const IdentityMat4 = mat4.create();
export const ZeroVec3 = vec3.create();

/** Linearly interpolate between p and q with respect to t.
 *  t is expected to be between 0.0 and 1.0.
 *  @example
 *  const foo = 0.4, bar = 0.8;
 *  lerp(foo, bar, 0.25); // 0.5
 */
export function lerp(p: number, q: number, t: number): number {
  return (1.0 - t) * p + t * q;
}

/** Inverse of the {@link lerp} function. For given values p, q and val, return the t that would yield val if
 *  lerp(p, q, t) were called. lerp(p, q, delerp(p, q, val)) equals val.
 *  @example
 *  const foo = 0.4, bar = 0.8;
 *  delerp(foo, bar, 0.5); // 0.25
 */
export function delerp(p: number, q: number, val: number): number {
  return (val - p) / (q - p);
}

/** Smoothstep performs smooth Hermite interpolation between 0 and 1 when min < x < max. This is useful in
 *  cases where a threshold function with a smooth transition is desired.
 */
export function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
};

/** Clamp a number to a value between min and max, inclusive.
 *  @example
 *  var a = clamp(1.1, 0.5, 1.0); // 1.0
 *  var a = clamp(-0.3, 0.0, 0.1); // 0.0
 *  var a = clamp(0.3, 0.0, 0.5); // 0.3
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(Math.min(value, max), min);
}

/** Clamp a number to a value between 0.0 and 1.0, inclusive.
 *  @example
 *  var a = saturate(1.1); // 1.0
 *  var a = saturate(-1.2); // 0.0
 */
export function saturate(value: number): number {
  return clamp(value, 0.0, 1.0);
}

/** Returns true if two numbers are within epsilon of each other
 *  @example
 *  const foo = 1.1000004
 *  var a = equalsEpsilon(1.1, foo, 1e-4); // true
 *  var b = equalsEpsilon(1.1, foo, 1e-10); // false
 */
export function equalsEpsilon(a: number, b: number, epsilon = MathConstants.EPSILON): boolean {
  return Math.abs(a - b) < epsilon;
}

/** Returns the signed numerical distance from a to b, wrapping at domainMax.
 *  @param domainMax - Wrap the domain at this value. Defaults to 2*PI to support angular distance.
 *  @example
 *  wrappedDistance(Math.PI * 0.25, -Math.PI * 0.25); // - Math.PI * 0.5
 *  wrappedDistance(Math.PI * 0.75, -Math.PI * 0.75); // Math.PI * 0.5 (Wrapped at 2*Math.PI)
 *  wrappedDistance(0.9, 0.25, 1.0); // 0.35 (Wrapped at 1.0)
 */
export function wrappedDistance(a: number, b: number, domainMax: number = 1.0): number {
  const da = (b - a) % domainMax;
  return (2 * da) % domainMax - da;
}

/** Returns the signed angular distance from angle a to angle b, wrapping at maxAngle.
 *  @note To use angles in degrees, set maxAngle to 360
 *  @param maxAngle - Wrap the angle at this value. Defaults to 2*PI.
 *  @example
 *  angularDistance(Math.PI * 0.25, -Math.PI * 0.25); // - Math.PI * 0.5
 *  angularDistance(Math.PI * 0.75, -Math.PI * 0.75); // Math.PI * 0.5 (Wrapped at 2*Math.PI)
 *  angularDistance(10, 40, 360); // 30
 *  angularDistance(10, 350, 360); // -20 (Wrapped at 360);
 */
export function angularDistance(a: number, b: number, maxAngle = MathConstants.TAU): number {
  return wrappedDistance(a, b, maxAngle);
}

/** Normalize a vector to a specific length
 *  @param dst - The vector that will be normalized, and then scaled so that it is len long
 *  @param len - The length to which the a vector will be scaled
 *  @example
 *  const someVec = vec3.fromValues(2, 2, 2);
 *  normToLength(vec3.create(), someVec, 5); // vel = [2.88675134595, 2.88675134595, 2.88675134595];
 */
export function normToLength(dst: vec3, len: number): vec3 {
  const vlen = vec3.length(dst);
  if (vlen > 0) {
    const inv = len / vlen;
    dst[0] = dst[0] * inv;
    dst[1] = dst[1] * inv;
    dst[2] = dst[2] * inv;
  }
  return dst;
}

/** Normalize a vector to a specific length, and add it to the destination
 *  @param dst - Destination vector to which the scaled a vector will be added
 *  @param a - The vector that will be normalized, and then scaled so that it is len long
 *  @param len - The length to which the a vector will be scaled
 *  @example
 *  const someVec = vec3.fromValues(2, 2, 2);
 *  const vel = vec3.fromValues(1, 1, 1);
 *  normToLengthAndAdd(vel, someVec, 5); // vel = [3.88675134595, 3.88675134595, 3.88675134595];
 */
export function normToLengthAndAdd(dst: vec3, a: vec3, len: number): vec3 {
  const vlen = vec3.length(a);
  if (vlen > 0) {
    const inv = len / vlen;
    dst[0] += a[0] * inv;
    dst[1] += a[1] * inv;
    dst[2] += a[2] * inv;
  }
  return dst;
}

/**
 * 
 * Computes a model matrix {@param dst} from given SRT parameters. Rotation is assumed
 * to be in radians.
 * 
 * This is roughly equivalent to {@link mat4.fromTranslationRotationScale}, but the
 * math is done by hand to be a bit faster, and more trustworthy.
 *
 * Note that this does *not* compute a Maya model matrix, as sometimes used by Nintendo
 * middleware.
 * 
 * From noclip.website by @JasperRLZ.
 * See https://github.com/magcius/noclip.website/blob/8b3687f446e4bedc98f2922399513f932d58267c/src/MathHelpers.ts#L20
 */
export function computeModelMatrixSRT(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): mat4 {
  const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
  const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
  const sinZ = Math.sin(rotationZ), cosZ = Math.cos(rotationZ);

  dst[0] =  scaleX * (cosY * cosZ);
  dst[1] =  scaleX * (sinZ * cosY);
  dst[2] =  scaleX * (-sinY);
  dst[3] =  0.0;

  dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
  dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
  dst[6] =  scaleY * (sinX * cosY);
  dst[7] =  0.0;

  dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
  dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
  dst[10] = scaleZ * (cosY * cosX);
  dst[11] = 0.0;

  dst[12] = translationX;
  dst[13] = translationY;
  dst[14] = translationZ;
  dst[15] = 1.0;

  return dst;
}

/**
 * Rotate a vector towards another vector around the Y axis. The maximum amount of rotation can be limited with maxRad.
 * If the rotation is within maxRad, the projection of both vectors onto the XZ plane will be equal.
 * @param dst - Destination vector
 * @param a - The vector to rotate
 * @param b - The target vector that vector a will be rotated towards
 * @param maxRad - If present, limit the amount of rotation to this value (in radians)
 */
export function rotateTowardXZ(dst: vec3, a: vec3, b: vec3, maxRad: number = Math.PI): vec3 {
  const ax = a[0],
        az = a[2],
        bx = b[0],
        bz = b[2];

  // Find the "winding" by using the cross product of A and B assuming Y = 0 for both
  const sign = Math.sign(az * bx - ax * bz);

  // Find the unsigned angle between the two vectors
  const mag1 = Math.sqrt(ax * ax + az * az);
  const mag2 = Math.sqrt(bx * bx + bz * bz);
  const mag = mag1 * mag2;
  const cosSrc = mag && (ax * bx + az * bz) / mag;
  const absAngle = Math.acos(clamp(cosSrc, -1, 1));

  // Rotate along the Y axis
  const cos = absAngle < maxRad ? cosSrc : Math.cos(maxRad);
  const sin = Math.sin(sign * Math.min(maxRad, absAngle));
  dst[0] = az * sin + ax * cos;
  dst[1] = a[1];
  dst[2] = az * cos - ax * sin;

  return dst;
}