import { vec3 } from "gl-matrix";
import { assert, defined, defaultValue, arrayRemove, assertDefined } from "./util";
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

  addState(state: SimState) {
    const removals: number[] = [];
    const additions: number[] = [];

    // Detect any entity removals that occurred on the frame being overwritten
    // @NOTE: These entities are now unreferenceable from any state in the stream, and can be safely deleted
    const leavingFrame = this.stateBuffer[state.frame % this.bufferFrameCount].frame;
    const oldestFrame = this.getNextFrame(leavingFrame + 1);
    const leavingState = this.stateBuffer[leavingFrame % this.bufferFrameCount];
    const oldestState = defined(oldestFrame) ? this.stateBuffer[oldestFrame % this.bufferFrameCount] : state;
    getRemovals(leavingState, oldestState, removals);

    // Detect any entity adds in this new frame state
    const newestState = this.stateBuffer[this.latestFrame % this.bufferFrameCount];
    getAdditions(newestState, state, additions);

    // Finally, add the new state    
    const newFrame = this.stateBuffer[state.frame % this.bufferFrameCount];
    newFrame.frame = state.frame;
    newFrame.entities = state.entities.slice();

    this.latestFrame = state.frame;

    return { 
      additions,
      removals
    };
  }

  getState(frame: number) {
    assert(Number.isInteger(frame));
    assert(frame >= (this.latestFrame - this.bufferFrameCount));
    return this.stateBuffer[frame % this.bufferFrameCount];
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
      const a = this.getState(aFrame!);
      const b = this.getState(bFrame!);

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

  hasState(frame: number) {
    const snap = this.stateBuffer[frame % this.bufferFrameCount];
    return defined(snap) && snap.frame === frame;
  }

  /**
   * Find the first frame BEFORE the given frame for which we have state 
   * @param frame 
   */
  getPreviousFrame(frame: number) {
    const oldestFrame = Math.max(0, this.latestFrame - this.bufferFrameCount);

    // Find the first snapshot BEFORE the requested time
    let aFrame = Math.floor(frame);
    while (aFrame >= oldestFrame && this.stateBuffer[aFrame % this.bufferFrameCount]?.frame !== aFrame) { aFrame -= 1; };

    return aFrame >= oldestFrame ? aFrame : undefined;
  }

  /**
   * Find the first frame AFTER the given frame for which we have state 
   * @param frame 
   */
  getNextFrame(frame: number) {    
    let bFrame = Math.ceil(frame);
    while (bFrame <= this.latestFrame && this.stateBuffer[bFrame % this.bufferFrameCount]?.frame !== bFrame) { bFrame += 1; };

    return bFrame <= this.latestFrame ? bFrame : undefined;
  }
}

function getRemovals(a: SimState, b: SimState, result: number[]) {
  result.length = 0;

  // If we don't have an older frame, nothing has been removed
  if (!defined(a)) return;

  assert(a.frame < b.frame);
  const aEntityCount = a.entities.length;
  const bEntityCount = b.entities.length;
  
  for (let aIdx = 0, bIdx = 0; aIdx < aEntityCount || bIdx < bEntityCount;) {
    // Entities are in sorted order
    const entityA = a.entities[aIdx];
    const entityB = b.entities[bIdx];

    // Entity added in frame B
    if (aIdx >= aEntityCount || (entityB && entityA.id > entityB.id)) {
      bIdx += 1;
    }
    
    // Entity removed in frame B
    else if (bIdx >= bEntityCount || (entityA && entityB.id > entityA.id)) {
      result.push(entityA.id);
      aIdx += 1;
    }
    
    // Entity present in both frames
    else if (entityA.id === entityB.id) {
      aIdx += 1;
      bIdx += 1;
    }
    
    else {
      assert(false, 'This should never happen');
    }
  }
}

function getAdditions(a: SimState, b: SimState, result: number[]) {
  result.length = 0;

  // If we don't have an older frame, all entities are new entities
  if (!defined(a)) {
    for (let i = 0; i < b.entities.length; i++) {
      result[i] = i;
    } 
    return;
  }

  assert(a.frame < b.frame);
  const aEntityCount = a.entities.length;
  const bEntityCount = b.entities.length;
  
  for (let aIdx = 0, bIdx = 0; aIdx < aEntityCount || bIdx < bEntityCount;) {
    // Entities are in sorted order
    const entityA = a.entities[aIdx];
    const entityB = b.entities[bIdx];

    // Entity added in frame B
    if (aIdx >= aEntityCount || (entityB && entityA.id > entityB.id)) {
      result.push(bIdx);
      bIdx += 1;
    }
    
    // Entity removed in frame B
    else if (bIdx >= bEntityCount || (entityA && entityB.id > entityA.id)) {
      aIdx += 1;
    }
    
    // Entity present in both frames
    else if (entityA.id === entityB.id) {
      aIdx += 1;
      bIdx += 1;
    }
    
    else {
      assert(false, 'This should never happen');
    }
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

export function createEntity(): EntityState {
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
  return dst;
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

/** 
 * Created as soon as it is present in a SimState in the SimStream 
 * Not removed until the frame that removes it leaves the SimStream
 * Has a EntityState which may not be valid for the current frame
 */
export interface GameObject {
  readonly state: EntityState;
  // @TODO: Store baseline, which would be the initialState? QuakeWorld does this.
}

export interface GameObjectFactory {
  createGameObject(initialState: EntityState): GameObject;
  deleteGameObject(object: GameObject): void;
}

export enum GameObjectType {
  Avatar,
  Weapon
}

export class World {
  stream: SimStream = new SimStream();
  loadedState: SimState;

  factories = {} as Record<GameObjectType, GameObjectFactory>;
  objects: GameObject[] = [];

  entityId: number = 0;

  registerFactory(type: GameObjectType, factory: GameObjectFactory) {
    this.factories[type] = factory;
  }

  /**
   * Instantly create a new GameObject and add it to the world. It will be captured in the next SimState.
   * @param type the type of GameObject to create
   * @param initialState override the default values. This can also be done by modifying the returned GameObject.
   */
  createGameObject(type: GameObjectType, options?: Partial<EntityState>): GameObject {
    const id = this.entityId++;
    const initialState = Object.assign(createEntity(), options, { id, type });
    const object = this.createImmediate(initialState);
    return object;
  }

  /**
   * Defer an object for deletion. It will be truly deleted once the current simulation frame becomes unreferenceable.
   * @param object the GameObject to be deleted
   */
  deleteGameObject(object: GameObject) {
    // @TODO:
  }

  /**
   * Set the state of all objects in the world to their values from a specific (or interpolated) SimState
   * @param frame the frame number to load. If this is not a whole number, the state will be interpolated
   */
  loadState(state: SimState) {
    this.loadedState = state;

    // Update all world objects
    let entityIdx = 0;
    let objectIdx = 0;
    while (entityIdx < this.loadedState.entities.length) {
      const entity = this.loadedState.entities[entityIdx++];

      // Not every object will have an entity state this frame
      let obj = this.objects[objectIdx++];
      while (obj.state.id < entity.id) {
        obj = this.objects[objectIdx++];
      }
      assert(obj.state.id === entity.id, `Object ${entity.id} should already have been created`);
      copyEntity(obj.state, entity);
    }
  }

  addState(state: SimState) {
    const { additions, removals } = this.stream.addState(state);

    // Create any new entities... 
    for (const index of additions) {
      const entity = state.entities[index];
      this.createImmediate(entity);
    }

    // ... and delete any removed ones
    for (const id of removals) {
      const object = assertDefined(this.objects.find(obj => obj.state.id === id));
      this.deleteImmediate(object);
    }
  }

  captureState(frame: number) {
    const state: SimState = {
      frame,
      entities: [],
    };

    for (const object of this.objects) {
      state.entities.push(object.state);
    }

    this.stream.addState(state);
  }

  private createImmediate(state: EntityState) {
    const object = this.factories[state.type as GameObjectType].createGameObject(state);
    this.objects.push(object);
    return object;
  }

  private deleteImmediate(object: GameObject) {
    this.factories[object.state.type as GameObjectType].deleteGameObject(object);
    arrayRemove(this.objects, object);
  }
}