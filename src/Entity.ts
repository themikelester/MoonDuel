import { Component, ComponentClass } from "./Component";
import { assertDefined, assert, defined } from "./util";

export type EntityId = number;
export type ResourceHandle = null;

/**
 * Used to create a new Entity with a given set of Components
 * @example
 * const SampleEntity = new class SampleEntity extends EntityPrototype {} ([
 *   SomeComponentA,
 *   SomeComponentB
 * ]);
 * const mySampleEntity = new Entity(SampleEntity);
 */
export class EntityPrototype {
    constructor(public components: ComponentClass<Component>[]) {}
}

export class Entity {
    private id: Nullable<EntityId>;
    private readonly components: Record<string, Component> = {};
    private prototype: EntityPrototype;

    constructor(prototype: EntityPrototype, id?: EntityId) {
        if (defined(id)) this.id = id;
        this.prototype = prototype;

        // Create a new instance of each component from the prototype
        for (const component of prototype.components) {
            this.components[component.name] = new component();
        }
    }

    /**
    * Returns the component of the specified class.
    * @throws if the component is not on the entity.
    * @param componentClass The class of the component.
    */
    getComponent<T extends Component>(componentClass: ComponentClass<T>): T {
        const name = componentClass.name;
        const component = assertDefined(this.components[name], `Entity does not have component "${name}"`);
        return component as T;
    }
    /**
    * Checks if the entity has a component of the specified class.
    * @param componentClass The class of the component.
    */
    hasComponent<T extends Component>(componentClass: ComponentClass<T>) {
        return defined(this.components[componentClass.name]);
    }
}