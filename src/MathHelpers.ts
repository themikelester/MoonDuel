import { mat4 } from "gl-matrix";

export const enum MathConstants {
  DEG_TO_RAD = 0.01745, // Math.PI / 180,
  RAD_TO_DEG = 57.2947, // 180 / Math.PI,
  TAU = 6.283, // Math.PI * 2
  EPSILON = 0.000001,
}

export const IdentityMat4 = mat4.create();

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