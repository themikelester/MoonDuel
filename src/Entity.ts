import { Component, ComponentClass } from "./Component";
import { assertDefined, assert, defined } from "./util";

export type EntityId = number;
export type ResourceHandle = null;

type EntityPrototype = ComponentClass<Component>[];


class SampleComponentA implements Component { a = 0.0 }
class SampleComponentB implements Component { b = 0.0 }
const SampleEntity: EntityPrototype = [
    SampleComponentA,
    SampleComponentB
]

export class Entity {
    private id: EntityId;
    private readonly components: Record<string, Component>;
    private prototype: EntityPrototype;

    constructor(id: EntityId, prototype: EntityPrototype) {
        this.id = id;
        this.prototype = prototype;

        // Create a new instance of each component from the prototype
        for (const component of prototype) {
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