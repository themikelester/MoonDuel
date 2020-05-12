import { vec3 } from "gl-matrix";
import { defaultValue, arrayRemove, assert, assertDefined } from "./util";

class NetState {
  id: number; // Index into the World's object array

  origin: vec3;
  angles: vec3;
  modelId: number;
  flags: number;
}

interface GameObject {
  origin: vec3,
  angles: vec3,
  modelId?: number,
}

interface ObjectEntry {
  // @NOTE: If we ever want to do importance-based network updates, the values for testing would go here
  free: boolean,
  baseline: NetState,
  data: GameObject,
}

export class World {
  objects: ObjectEntry[] = [];

  add(object: GameObject, baseline?: NetState): number {
    baseline = defaultValue(baseline, {
      id: -1,
      origin: vec3.create(),
      angles: vec3.create(),
      modelId: -1,
      flags: 0
    });

    // Allocate
    let id = this.objects.findIndex(o => o.free);
    if (id < 0) id = this.objects.length;

    // Assign
    const entry: ObjectEntry = { free: false, data: object, baseline };
    this.objects[id] = entry;
    entry.baseline.id = id;

    return id;
  }

  remove(id: number) {
    const obj = assertDefined(this.objects[id]);
    assert(obj.baseline.id === id);
    obj.free = true;
  }
}