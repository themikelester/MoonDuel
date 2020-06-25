import { vec3 } from "gl-matrix";

/**
 * The position and velocity are changed according to the movement of a critically damped spring. This generates a 
 * smooth movement that can be used to interpolate values.
 * Based on "Critically Damped Ease-In/Ease-Out Smoothing", Game Programming Gems 4, pp. 95
 */ 
export function criticallyDampedSmoothing(obj: { pos: number, vel: number }, targetPos: number, smoothTime: number, dt: number) {
  const ω = 2.0 / smoothTime;
  const x = ω * dt;
  const exp = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x); // e^(-ω * t)
  const change = obj.pos - targetPos;                  // (y - yd)

  const temp = (obj.vel + ω * change) * dt;            // (y0' + ω (y - yd)) Δt
  obj.vel = (obj.vel - ω * temp) * exp;                // y' = (y0' - ω * (y0' + ω (y - yd)) Δt) * e^(-ω * t)
  obj.pos = targetPos + (change + temp) * exp;  
}

/**
 * A version of criticallyDampedSmoothing that operates on vec3's
 * @see criticallyDampedSmoothing
 */ 
export function criticallyDampedSmoothingVec3(pos: vec3, vel: vec3, targetPos: vec3, smoothTime: number, dt: number) {
  const ω = 2.0 / smoothTime;
  const x = ω * dt;
  const exp = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x); // e^(-ω * t)
  
  for (let i = 0; i < 3; i++) { 
    const change = pos[i] - targetPos[i];                  // (y - yd)
    const temp = (vel[i] + ω * change) * dt;            // (y0' + ω (y - yd)) Δt
    vel[i] = (vel[i] - ω * temp) * exp;                // y' = (y0' - ω * (y0' + ω (y - yd)) Δt) * e^(-ω * t)
    pos[i] = targetPos[i] + (change + temp) * exp;  
  }
}