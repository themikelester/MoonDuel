import { vec3 } from "gl-matrix";
import { Aabb, Obb, Line } from "./Collision";

const X = 0;
const Y = 1;
const Z = 2;
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchVec3f = vec3.create();
const scratchVec3g = vec3.create();
const scratchVec3h = vec3.create();
const scratchVec3i = vec3.create();

/**
 * Determine if a line segment (made of a center point and a half vector) intersects an axis-aligned bounding box
 * This can also be used as an OBB-line intersection test by transforming the OBB and line into OBB space.
 * Based on the "Line Segment/Box Overlap Test" section of Real-Time Rendering, Third Edition (pg. 744).
 * @param aabb Axis-aligned bounding box to intersect
 * @param line Line to intersect
 * @return true if the shapes intersect
 */
export function intersectAabbLine(aabb: Aabb, line: Line): boolean {
  const t = vec3.subtract(scratchVec3a, aabb.center, line.center);
  let r: number;

  // Look for a separating axis in the three principal axes
  if (Math.abs(t[0]) > aabb.extents[0] + Math.abs(line.extent[0])) return false;
  if (Math.abs(t[1]) > aabb.extents[1] + Math.abs(line.extent[1])) return false;
  if (Math.abs(t[2]) > aabb.extents[2] + Math.abs(line.extent[2])) return false;

  r = aabb.extents[1] * Math.abs(line.extent[2]) + aabb.extents[2] * Math.abs(line.extent[1]);
  if (Math.abs(line.center[1] * line.extent[2] - line.center[2] * line.extent[1]) > r) return false;

  r = aabb.extents[0] * Math.abs(line.extent[2]) + aabb.extents[2] * Math.abs(line.extent[0]);
  if (Math.abs(line.center[0] * line.extent[2] - line.center[2] * line.extent[0]) > r) return false;

  r = aabb.extents[0] * Math.abs(line.extent[1]) + aabb.extents[1] * Math.abs(line.extent[0]);
  if (Math.abs(line.center[0] * line.extent[1] - line.center[1] * line.extent[0]) > r) return false;

  return true;
}

/**
 * Determine if a ray (center point and normalized direction) intersects an oriented bounding box
 * Based on the "Slabs Method" section of Real-Time Rendering, Third Edition (pg. 742).
 * @param obb Deconstructed OBB which has origin, basis vectors, and half-lengths for efficient querying
 * @param origin Starting point of the ray
 * @param dir Normalized direction of the ray
 * @param maxLength If set, collisions whose intersection occurs past this length will not be reported. 
 *                  This can be used to perform an OBB vs Line segment test. 
 * @return The parametric value T at which the ray first intersects the object, or null if there is no intersection.
 *         The value will be negative if the ray origin is inside the OBB. 
 */
export function intersectObbRay(obb: Obb, origin: vec3, dir: vec3, maxLength: number = Infinity): Nullable<number> {
  let tMin = -Infinity;
  let tMax = Infinity;

  const p = vec3.subtract(scratchVec3a, obb.center, origin);

  for (let i = 0; i < 3; i++) {
    const e = vec3.dot(obb.bases[i], p);
    const f = 1.0 / vec3.dot(obb.bases[i], dir);

    // The ray crosses this slab, update tMin and tMax
    if (Math.abs(f) > 1e-20) {
      const t1 = (e + obb.halfLengths[i]) * f;
      const t2 = (e - obb.halfLengths[i]) * f;

      if (t1 <= t2) {
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMin, t2);
      } else {
        tMin = Math.max(tMin, t2);
        tMax = Math.min(tMin, t1);
      }

      // Reject if we fail the slab test
      if (tMin > tMax) return null;

      // Reject if we intercept the slab behind the ray origin
      if (tMax < 0) return null;
    }

    // The ray is parallel to this slab, Reject if we're not inside it
    else if ((-e - obb.halfLengths[i]) > 0 || (-e + obb.halfLengths[i]) < 0) { return null }

    // Reject if the intersection point of this slab is past the end of the ray
    if (tMin > maxLength) { return null }
  }

  // tMin holds the t of the entry point (may be negative if ray origin is inside), tMax holds the exit time
  return tMin;
}

/**
 * Determine if a triangle intersects an oriented bounding box
 * Based on the "Triangle/Box Overlap" section of Real-Time Rendering, Third Edition (pg. 742).
 * @param obb Deconstructed OBB which has origin, basis vectors, and half-lengths for efficient querying
 * @param a Triangle corner
 * @param b Triangle corner
 * @param c Triangle corner
 * @return true if an intersection occurs, false otherwise
 */
export function intersectObbTriangle(obb: Obb, a: vec3, b: vec3, c: vec3): boolean {
  let min = Infinity, max = -Infinity, rad = 0, p0, p1, p2, fex, fey, fez;

  /* move everything so that the boxcenter is in (0,0,0) */
  const v0 = vec3.subtract(scratchVec3a, a, obb.center);
  const v1 = vec3.subtract(scratchVec3b, b, obb.center);
  const v2 = vec3.subtract(scratchVec3c, c, obb.center);

  /* compute triangle edges */
  const e0 = vec3.subtract(scratchVec3d, v1, v0);      /* tri edge 0 */
  const e1 = vec3.subtract(scratchVec3e, v2, v1);      /* tri edge 1 */
  const e2 = vec3.subtract(scratchVec3f, v0, v2);      /* tri edge 2 */

  function FINDMINMAX(x0: number, x1: number, x2: number) {
    min = Math.min(x0, x1, x2);
    max = Math.max(x0, x1, x2);
  }

  function planeBoxOverlap(normal: vec3, d: number, maxbox: number[]) {
    let q: number;
    const vmin = scratchVec3h;
    const vmax = scratchVec3i;

    for (q = X; q <= Z; q++) {
      if (normal[q] > 0.0) {
        vmin[q] = -maxbox[q];
        vmax[q] = maxbox[q];
      }
      else {
        vmin[q] = maxbox[q];
        vmax[q] = -maxbox[q];
      }
    }
    if (vec3.dot(normal, vmin) + d > 0.0) return false;
    if (vec3.dot(normal, vmax) + d >= 0.0) return true;

    return false;
  }

  /*======================== X-tests ========================*/
  function AXISTEST_X01(a: number, b: number, fa: number, fb: number) {
    p0 = a * v0[Y] - b * v0[Z];
    p2 = a * v2[Y] - b * v2[Z];
    if (p0 < p2) { min = p0; max = p2; } else { min = p2; max = p0; }
    rad = fa * obb.halfLengths[Y] + fb * obb.halfLengths[Z];
  }

  function AXISTEST_X2(a: number, b: number, fa: number, fb: number) {
    p0 = a * v0[Y] - b * v0[Z];
    p1 = a * v1[Y] - b * v1[Z];
    if (p0 < p1) { min = p0; max = p1; } else { min = p1; max = p0; }
    rad = fa * obb.halfLengths[Y] + fb * obb.halfLengths[Z];
  }
  /*======================== Y-tests ========================*/
  function AXISTEST_Y02(a: number, b: number, fa: number, fb: number) {
    p0 = -a * v0[X] + b * v0[Z];
    p2 = -a * v2[X] + b * v2[Z];
    if (p0 < p2) { min = p0; max = p2; } else { min = p2; max = p0; }
    rad = fa * obb.halfLengths[X] + fb * obb.halfLengths[Z];
  }
  function AXISTEST_Y1(a: number, b: number, fa: number, fb: number) {
    p0 = -a * v0[X] + b * v0[Z];
    p1 = -a * v1[X] + b * v1[Z];
    if (p0 < p1) { min = p0; max = p1; } else { min = p1; max = p0; }
    rad = fa * obb.halfLengths[X] + fb * obb.halfLengths[Z];
  }
  /*======================== Z-tests ========================*/

  function AXISTEST_Z12(a: number, b: number, fa: number, fb: number) {
    p1 = a * v1[X] - b * v1[Y];
    p2 = a * v2[X] - b * v2[Y];
    if (p2 < p1) { min = p2; max = p1; } else { min = p1; max = p2; }
    rad = fa * obb.halfLengths[X] + fb * obb.halfLengths[Y];
  }
  function AXISTEST_Z0(a: number, b: number, fa: number, fb: number) {
    p0 = a * v0[X] - b * v0[Y];
    p1 = a * v1[X] - b * v1[Y];
    if (p0 < p1) { min = p0; max = p1; } else { min = p1; max = p0; }
    rad = fa * obb.halfLengths[X] + fb * obb.halfLengths[Y];
  }

  /* Bullet 3:  */
  /*  test the 9 tests first (this was faster) */
  fex = Math.abs(e0[X]);
  fey = Math.abs(e0[Y]);
  fez = Math.abs(e0[Z]);
  AXISTEST_X01(e0[Z], e0[Y], fez, fey); if (min > rad || max < -rad) return false;
  AXISTEST_Y02(e0[Z], e0[X], fez, fex); if (min > rad || max < -rad) return false;
  AXISTEST_Z12(e0[Y], e0[X], fey, fex); if (min > rad || max < -rad) return false;

  fex = Math.abs(e1[X]);
  fey = Math.abs(e1[Y]);
  fez = Math.abs(e1[Z]);
  AXISTEST_X01(e1[Z], e1[Y], fez, fey); if (min > rad || max < -rad) return false;
  AXISTEST_Y02(e1[Z], e1[X], fez, fex); if (min > rad || max < -rad) return false;
  AXISTEST_Z0(e1[Y], e1[X], fey, fex); if (min > rad || max < -rad) return false;

  fex = Math.abs(e2[X]);
  fey = Math.abs(e2[Y]);
  fez = Math.abs(e2[Z]);
  AXISTEST_X2(e2[Z], e2[Y], fez, fey); if (min > rad || max < -rad) return false;
  AXISTEST_Y1(e2[Z], e2[X], fez, fex); if (min > rad || max < -rad) return false;
  AXISTEST_Z12(e2[Y], e2[X], fey, fex); if (min > rad || max < -rad) return false;

  /* Bullet 1: */
  /*  first test overlap in the {x,y,z}-directions */
  /*  find min, max of the triangle each direction, and test for overlap in */
  /*  that direction -- this is equivalent to testing a minimal AABB around */
  /*  the triangle against the AABB */

  /* test in X-direction */
  FINDMINMAX(v0[X], v1[X], v2[X]);
  if (min > obb.halfLengths[X] || max < -obb.halfLengths[X]) return false;

  /* test in Y-direction */
  FINDMINMAX(v0[Y], v1[Y], v2[Y]);
  if (min > obb.halfLengths[Y] || max < -obb.halfLengths[Y]) return false;

  /* test in Z-direction */
  FINDMINMAX(v0[Z], v1[Z], v2[Z]);
  if (min > obb.halfLengths[Z] || max < -obb.halfLengths[Z]) return false;

  /* Bullet 2: */
  /*  test if the box intersects the plane of the triangle */
  /*  compute plane equation of triangle: normal*x+d=0 */
  const normal = vec3.cross(scratchVec3g, e0, e1);
  const d = -vec3.dot(normal, v0);  /* plane eq: normal.x+d=0 */
  if (!planeBoxOverlap(normal, d, obb.halfLengths)) return false;

  return true;
}