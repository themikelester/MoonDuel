import { Component } from "./Component";
import { mat4 } from "gl-matrix";
import { assert } from "./util";

export class CTransform implements Component {
  localToParent: mat4 = mat4.create(); // To Parent Space
  localToWorld: mat4 = mat4.create(); // To World space
}