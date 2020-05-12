import { vec3 } from "gl-matrix";
import { defaultValue, arrayRemove, assert, assertDefined, defined } from "./util";
import { Buf } from "./Buf";

export class NetObject {
  id: number; // Index into the World's object array

  origin: vec3;
  orientation: vec3;
  modelId: number;
  flags: number;
  parent?: number;

  static serialize(buf: Buf, obj: NetObject) {
    let flags = 0;
    if (defined(obj.parent)) {
      flags |= 1;
    }

    Buf.writeByte(buf, flags);
    Buf.writeShort(buf, obj.id);
    if (flags & 1) Buf.writeShort(buf, obj.parent!);
  }

  static deserialize(buf: Buf, obj: NetObject) {
    const flags = Buf.readByte(buf);

    obj.id = Buf.readShort(buf);
    if (flags & 1) obj.parent = Buf.readShort(buf);
  }

  static copy(result: NetObject, src: NetObject) {
    result.id = src.id;
    // vec3.copy(result.origin, src.origin);
    // vec3.copy(result.orientation, src.orientation);
    // result.modelId = src.modelId;
    // result.flags = src.flags;
    result.parent = src.parent;
  }

  static lerp(result: NetObject, a: NetObject, b: NetObject, t: number) {
    assert(a.id === b.id);
    result.id = b.id;

    // vec3.lerp(result.origin, a.origin, b.origin, t);
    // vec3.lerp(result.orientation, a.orientation, b.orientation, t);

    // result.modelId = b.modelId;
    // result.flags = b.flags;
    result.parent = b.parent;
  }
}

export interface GameObject {
  origin: vec3,
  orientation: vec3,
  modelId?: number,
  parent?: number;
}

interface ObjectEntry {
  // @NOTE: If we ever want to do importance-based network updates, the values for testing would go here
  free: boolean,
  baseline: NetObject,
  data: GameObject,
}

export class World {
  objects: ObjectEntry[] = [];

  add(object: GameObject, baseline?: NetObject): number {
    baseline = defaultValue(baseline, {
      id: -1,
      origin: vec3.create(),
      orientation: vec3.create(),
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

  get(id: number) {
    const obj = assertDefined(this.objects[id]);
    assert(obj.free === false);
    return obj;
  }
}