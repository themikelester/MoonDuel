import { vec3 } from "gl-matrix";
import { Aabb, Obb, Line } from "./Collision";

const scratchVec3a = vec3.create();

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