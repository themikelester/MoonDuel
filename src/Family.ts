/* Based on https://github.com/nova-engine/ecs/blob/master/src/Family.ts */

import { Component, ComponentClass } from "./Component";
import { World } from "./World";
import { Entity } from "./Entity";

/**
 * A family is a criteria to separate your entities.
 * You can have families on wich entities must have a component,
 * entities cannot have some components or a mix of both.
 * Families also cache the entities of the engine by default,
 * so you won't have to worry about filtering entities every time.
 */
interface Family {
  /**
   * Computes a list of entities on the family.
   * The list may or may not be cached, depending of implementation.
   */
  readonly entities: ReadonlyArray<Entity>;
  includesEntity(entity: Entity): boolean;
}

/**
 * An abstract family is the base implementation of a family interface.
 * This class is private to this module.
 * @private
 */
abstract class AbstractFamily implements Family {
  private readonly _world: World;
  private readonly include: ReadonlyArray<ComponentClass<Component>>;

  constructor(world: World, include: ComponentClass<Component>[]) {
    this._world = world;
    this.include = include.slice(0);
  }

  get world() { return this._world }

  abstract readonly entities: ReadonlyArray<Entity>;

  includesEntity = (entity: Entity) => {
    for (let include of this.include) {
      if (!entity.hasComponent(include)) {
        return false;
      }
    }
    return true;
  };
}

/**
 * A CachedFamily is a family than caches it's results and alters it only
 * when an entity changes.
 *
 */
class CachedFamily extends AbstractFamily {
  public entities: Entity[];

  constructor(world: World, include: ComponentClass<Component>[]) {
    super(world, include);

    const allEntities = this.world.entities;
    this.entities = allEntities.filter(this.includesEntity);

    this.world.on(World.Events.EntityAdded, this.onEntityAdded.bind(this));
    this.world.on(World.Events.EntityRemoved, this.onEntityRemoved.bind(this));
  }

  onEntityAdded(entity: Entity) {
    if (this.includesEntity(entity)) {
      this.entities.push(entity);
    }
  }

  onEntityRemoved(entity: Entity) {
    const index = this.entities.indexOf(entity);
    if (index !== -1) {
      this.entities.splice(index, 1);
    }
  }
}

/**
 * A NonCacheFamily always computes the members of it.
 * If you find than the performance from cached families is not decent.
 * You can use this instead.
 * @private
 */
class NonCachedFamily extends AbstractFamily {
  get entities() {
    return this.world.entities.filter(this.includesEntity);
  }
}

/**
 * Utility class to build Families.
 * It's the only way to create the implementations of CachedFamily and NonCachedFamily.
 */
class FamilyBuilder {
  private world: World;
  private cached: boolean;
  private readonly include: ComponentClass<Component>[] = [];

  constructor(world: World, cached = true) {
    this.world = world;
    this.cached = cached;
  }

  /**
   * Indicates than entities than are members of this family MUST
   * HAVE these components.
   * @param classes A list of component classes.
   */
  require(...classes: ComponentClass<Component>[]) {
    this.include.push(...classes);
    return this;
  }

  /**
   * Builds the family, using the information provided.
   * @returns a new family to retrieve the entities.
   */
  build(): Family {
    if (!this.cached) {
      return new NonCachedFamily(this.world, this.include);
    }
    return new CachedFamily(this.world, this.include);
  }
}

export { Family, FamilyBuilder };