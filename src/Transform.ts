import { Component } from "./Component";
import { mat4 } from "gl-matrix";
import { Object3D } from "three/src/core/Object3D";

// @TODO: Don't extend Object3D
export class Transform extends Object3D {
  // localToParent: mat4 = mat4.create(); // To Parent Space
  // localToWorld: mat4 = mat4.create(); // To World space
}

export class CTransform extends Transform implements Component {
}