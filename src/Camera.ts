// --------------------------------------------------------------------------------
// Camera based loosely on Three.js'
// --------------------------------------------------------------------------------
import { mat4, vec3 } from 'gl-matrix';
import { defaultValue } from './util';

export default class PerspectiveCamera {
  cameraMatrix: mat4;
  viewMatrix: mat4;
  projectionMatrix: mat4;
  projectionMatrixInverse: mat4;

  viewProjMatrix: mat4;
  viewProjMatrixInverse: mat4;

  forward: vec3;
  up: vec3;
  right: vec3;

  fov: number;
  near: number;
  far: number;
  aspect: number;

  constructor(fovY: number, aspectRatio: number, near: number, far: number) {
    this.cameraMatrix = mat4.create();
    this.viewMatrix = mat4.create();
    this.projectionMatrix = mat4.create();
    this.projectionMatrixInverse = mat4.create();

    this.viewProjMatrix = mat4.create();
    this.viewProjMatrixInverse = mat4.create();

    this.forward = vec3.create();
    this.up = vec3.create();
    this.right = vec3.create();

    fovY = defaultValue(fovY, 60.0 / 180 * Math.PI);
    near = defaultValue(near, 0.1);
    far = defaultValue(far, 2000);
    aspectRatio = defaultValue(aspectRatio, 1);
    this.setPerspective(fovY, aspectRatio, near, far);
  }

  copy(src: PerspectiveCamera) {
    this.fov = src.fov;
    this.near = src.near;
    this.far = src.far;
    this.aspect = src.aspect;

    mat4.copy(this.cameraMatrix, src.cameraMatrix);
    mat4.copy(this.viewMatrix, src.viewMatrix);
    mat4.copy(this.projectionMatrix, src.projectionMatrix);
    mat4.copy(this.projectionMatrixInverse, src.projectionMatrixInverse);
    mat4.copy(this.viewProjMatrix, src.viewProjMatrix);
    mat4.copy(this.viewProjMatrixInverse, src.viewProjMatrixInverse);

    vec3.copy(this.forward, src.forward);
    vec3.copy(this.up, src.up);
    vec3.copy(this.right, src.right);
  }

  getPos(out: vec3) {
    return mat4.getTranslation(out, this.cameraMatrix);
  }

  viewMatrixUpdated() {
    mat4.invert(this.cameraMatrix, this.viewMatrix);

    vec3.set(this.right, this.cameraMatrix[0], this.cameraMatrix[1], this.cameraMatrix[2]);
    vec3.set(this.up, this.cameraMatrix[4], this.cameraMatrix[5], this.cameraMatrix[6]);
    vec3.set(this.forward, -this.cameraMatrix[8], -this.cameraMatrix[9], -this.cameraMatrix[10]);

    mat4.multiply(this.viewProjMatrix, this.projectionMatrix, this.viewMatrix);
    mat4.multiply(this.viewProjMatrixInverse, this.cameraMatrix, this.projectionMatrixInverse);
  }

  setPerspective(fovY: number, aspect: number, near: number, far: number = Infinity) {
    mat4.perspective(this.projectionMatrix, fovY, aspect, near, far);
    mat4.invert(this.projectionMatrixInverse, this.projectionMatrix);

    mat4.multiply(this.viewProjMatrix, this.projectionMatrix, this.viewMatrix);
    mat4.multiply(this.viewProjMatrixInverse, this.cameraMatrix, this.projectionMatrixInverse);
  }
}