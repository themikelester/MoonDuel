import { vec3 } from 'gl-matrix';

import { Vector3 as ThreeVector3 } from 'three/src/math/Vector3';
import { Quaternion } from 'three/src/math/Quaternion';
export { Matrix4 } from 'three/src/math/Matrix4';

// --------------------------------------------------------------------------------
// Object3D: https://threejs.org/docs/#api/en/core/Object3D
// Base class for 3D objects
// --------------------------------------------------------------------------------
export { Object3D } from 'three/src/core/Object3D';

/**
 * Compatible with a THREE.Vector3, but backed by a gl-matrix vec3
 */
export class Vector3 extends ThreeVector3 {
    buffer: vec3;

    constructor(buffer: vec3) {
        super();
        this.buffer = buffer;
    }

    setBuffer(buffer: vec3) {
        this.buffer = buffer;
        return this;
    }

    set x(val: number) { if (this.buffer) this.buffer[0] = val; }
    set y(val: number) { if (this.buffer) this.buffer[1] = val; }
    set z(val: number) { if (this.buffer) this.buffer[2] = val; }

    get x() { return this.buffer[0]; }
    get y() { return this.buffer[1]; }
    get z() { return this.buffer[2]; }
};