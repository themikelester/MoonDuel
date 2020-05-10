import { Component } from "./Component";
import { mat4 } from "gl-matrix";

export class CTransform implements Component {
  transform: mat4 = mat4.create();
}