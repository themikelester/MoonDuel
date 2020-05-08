import { Component } from "./Component";
import { EntityId, Entity } from "./Entity";
import { EventDispatcher } from './EventDispatcher';

interface Module {

}

enum Singleton {
    Input
}

export class World extends EventDispatcher {
    modules: Module[];
    entities: Entity[];
    components: Component[];

    static Events = {
        EntityAdded: 'ea',
        EntityRemoved: 'er'
    };

    addEntity(entity: Entity) {
        this.entities.push(entity);
        this.fire(World.Events.EntityAdded, entity);
    }

    removeEntity() {
        this.fire(World.Events.EntityRemoved);
    }

    // Singleton components
    private singletons: Record<Singleton, Component>;
    getSingletonInput() { return this.singletons[Singleton.Input]; }
}