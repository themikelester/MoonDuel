import { vec3 } from "gl-matrix";
import { assert, defined } from "./util";
import { delerp, lerp } from "./MathHelpers";
import { Buf } from "./Buf";

let gEntityId = 0;

/**
 * A snapshot of the state of an entity at a specific frame. May be serialized locally or transmitted over the network.
 */
export interface EntityState {
  id: number;
  type: number;

  flags: number;
  origin: vec3;
  orientation: vec3;
  parent: number;

  state: number;
  stateStartFrame: number
  speed: number;
}

export interface SimState {
  frame: number;
  entities: EntityState[];
}

export class SimStream {
  private stateBuffer: SimState[] = [];
  private latestFrame: number = -1;
  private bufferFrameCount: number = 64;

  constructor() {
    // Create empty SimState objects that will be reused
    for (let i = 0; i < this.bufferFrameCount; i++) {
      this.stateBuffer[i] = {
        frame: -1,
        entities: [],
      }
    }
  }

  getState(frame: number) {
    assert(Number.isInteger(frame));
    assert(frame >= (this.latestFrame - this.bufferFrameCount));
    return this.stateBuffer[frame % this.bufferFrameCount];
  }

  hasState(frame: number) {
    const snap = this.stateBuffer[frame % this.bufferFrameCount];
    return defined(snap) && snap.frame === frame;
  }

  lerpState(frame: number, result: SimState) {
    const aFrame = this.getPreviousFrame(frame);
    const bFrame = this.getNextFrame(frame);

    const aValid = defined(aFrame);
    const bValid = defined(bFrame);

    if (aValid && !bValid) {
      // Extrapolate snapshot for t1 based on t0-1 and t0;
      console.warn('Extrapolation not yet implemented')
      return false;
    } else if (!aValid && bValid) {
      // Inverse extrapolate snapshot for t0 based on t1 and t1+1;
      console.warn('Extrapolation not yet implemented')
      return false;
    } else if (!aValid && !bValid) {
      // No valid snapshots on either side
      console.warn('No valid snapshot for this frame');
      return false;
    } else {
      const a = this.stateBuffer[aFrame! % this.bufferFrameCount];
      const b = this.stateBuffer[bFrame! % this.bufferFrameCount];

      if (a === b) {
        Object.assign(result, a);
        return true;
      }

      // Interpolate
      const t = delerp(aFrame!, bFrame!, frame);
      interpolateSimState(result, a, b, t);
      return true;
    }
  }

  createState(frame: number) {
    const newFrame = this.stateBuffer[frame % this.bufferFrameCount];
    this.latestFrame = frame;

    newFrame.frame = frame;
    newFrame.entities.length = 0;

    return newFrame
  }

  private getPreviousFrame(frame: number) {
    const oldestFrame = Math.max(0, this.latestFrame - this.bufferFrameCount);

    // Find the first snapshot BEFORE the requested time
    let aFrame = Math.floor(frame);
    while (aFrame >= oldestFrame && this.stateBuffer[aFrame % this.bufferFrameCount]?.frame !== aFrame) { aFrame -= 1; };

    return aFrame >= oldestFrame ? aFrame : undefined;
  }

  private getNextFrame(frame: number) {    
    // Find the first snapshot AFTER the requested time
    let bFrame = Math.ceil(frame);
    while (bFrame <= this.latestFrame && this.stateBuffer[bFrame % this.bufferFrameCount]?.frame !== bFrame) { bFrame += 1; };

    return bFrame <= this.latestFrame ? bFrame : undefined;
  }
}

function interpolateSimState(result: SimState, a: SimState, b: SimState, t: number) {
  assert(result.entities instanceof Array, 'Result must be a valid SimState');

  result.frame = lerp(a.frame, b.frame, t);
  result.entities.length = 0;

  const aEntityCount = a.entities.length;
  const bEntityCount = b.entities.length;
  const rEntityCount = Math.max(aEntityCount, bEntityCount);

  for (let aIdx = 0, bIdx = 0; aIdx < aEntityCount || bIdx < bEntityCount;) {
    // Entities are in sorted order
    const entityA = a.entities[aIdx];
    const entityB = b.entities[bIdx];

    // @TODO: Use an entity pool instead of creating?
    const entityR = createEntity();

    // Entity added in frame B
    if (aIdx >= aEntityCount || (entityB && entityA.id > entityB.id)) {
      copyEntity(entityR, entityB);
      result.entities.push(entityR);
      bIdx += 1;
    }
    
    // Entity removed in frame B
    else if (bIdx >= bEntityCount || (entityA && entityB.id > entityA.id)) {
      copyEntity(entityR, entityA);
      result.entities.push(entityR);
      aIdx += 1;
    }
    
    // Entity present in both frames
    else if (entityA.id === entityB.id) {
      lerpEntity(entityR, entityA, entityB, t);
      result.entities.push(entityR);
      aIdx += 1;
      bIdx += 1;
    }
    

    else {
      assert(false, 'This should never happen');
    }
  }
  
  assert(result.entities.length === rEntityCount);
}

export function serializeSimState(buf: Buf, simFrame: SimState) {
  Buf.writeInt(buf, simFrame.frame);
  Buf.writeByte(buf, simFrame.entities.length);

  for (let i = 0; i < simFrame.entities.length; i++) {
    const e = simFrame.entities[i];
    Buf.writeByte(buf, e.id);
    Buf.writeByte(buf, e.type);

    Buf.writeByte(buf, e.flags);
    Buf.writeFloat(buf, e.origin[0]);
    Buf.writeFloat(buf, e.origin[1]);
    Buf.writeFloat(buf, e.origin[2]);
    Buf.writeFloat(buf, e.orientation[0]);
    Buf.writeFloat(buf, e.orientation[1]);
    Buf.writeFloat(buf, e.orientation[2]);
    Buf.writeChar(buf, e.parent);

    Buf.writeByte(buf, e.state);
    Buf.writeInt(buf, e.stateStartFrame);
    Buf.writeFloat(buf, e.speed);
  }
}

export function deserializeSimState(buf: Buf, simFrame: SimState) {
  simFrame.frame = Buf.readInt(buf);

  const entityCount = Buf.readByte(buf);

  for (let i = 0; i < entityCount; i++) {
    // @TODO: An entity pool to reuse from
    const e = createEntity();

    e.id = Buf.readByte(buf);
    e.type = Buf.readByte(buf);

    e.flags = Buf.readByte(buf);
    e.origin[0] = Buf.readFloat(buf);
    e.origin[1] = Buf.readFloat(buf);
    e.origin[2] = Buf.readFloat(buf);
    e.orientation[0] = Buf.readFloat(buf);
    e.orientation[1] = Buf.readFloat(buf);
    e.orientation[2] = Buf.readFloat(buf);
    e.parent = Buf.readChar(buf);

    e.state = Buf.readByte(buf);
    e.stateStartFrame = Buf.readInt(buf);
    e.speed = Buf.readFloat(buf);

    simFrame.entities.push(e);
  }
}

export function allocEntity(): EntityState {
  const e = createEntity();
  e.id = gEntityId++;
  return e;
}

function createEntity(): EntityState {
  return {
    id: -1,
    type: -1,
    
    flags: 0,
    origin: vec3.create(),
    orientation: vec3.create(),
    parent: -1,

    state: 0,
    stateStartFrame: 0,
    speed: 0,
  }
}

export function copyEntity(dst: EntityState, src: EntityState) {
  dst.id = src.id;
  dst.type = src.type;
  dst.flags = src.flags;
  vec3.copy(dst.origin, src.origin);
  vec3.copy(dst.orientation, src.orientation);
  dst.parent = src.parent;
  dst.state = src.state;
  dst.stateStartFrame = src.stateStartFrame;
  dst.speed = src.speed;
}

function lerpEntity(dst: EntityState, a: EntityState, b: EntityState, t: number) {
  // The same in both
  dst.id = a.id;
  dst.type = a.type;

  // Lerpable
  vec3.lerp(dst.origin, a.origin, b.origin, t);
  vec3.lerp(dst.orientation, a.orientation, b.orientation, t);
  dst.speed = lerp(a.speed, b.speed, t);

  // Decision time. For now, lets use B's values
  dst.flags = b.flags;
  dst.parent = b.parent;
  dst.state = b.state;
  dst.stateStartFrame = b.stateStartFrame;
}
