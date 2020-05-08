import { Component } from "./Component";
import { EntityId, Entity } from "./Entity";
import { EventDispatcher } from './EventDispatcher';

interface System {
    initialize?: (world: World) => void;
    terminate?: (world: World) => void;

    update?: (world: World) => void;
    updateFixed?: (world: World) => void;
    render?: (world: World) => void;
    
    // onResize?: (world: World) => void;
    // onVisibility?: (visible: boolean, world: World) => void;
}

enum Singleton {
    Input
}

export class World extends EventDispatcher {
    systems: System[] = [];
    entities: Entity[] = [];
    components: Component[] = [];
    private singletons: Record<Singleton, Component>;

    static Events = {
        EntityAdded: 'ea',
        EntityRemoved: 'er'
    };

    constructor(systems: System[]) {
        super();
        this.systems = systems;
    }

    addEntity(entity: Entity) {
        this.entities.push(entity);
        // @TODO: Keep references to all the entities components?
        this.fire(World.Events.EntityAdded, entity);
    }

    removeEntity() {
        this.fire(World.Events.EntityRemoved);
    }

    // Singleton components
    getSingletonInput() { return this.singletons[Singleton.Input]; }

    // Lifecycle
    initialize() { for (const system of this.systems) { if (system.initialize) system.initialize(this); } }
    terminate() { for (const system of this.systems) { if (system.terminate) system.terminate(this); } }
    update() { for (const system of this.systems) { if (system.update) system.update(this); } }
    updateFixed() { for (const system of this.systems) { if (system.updateFixed) system.updateFixed(this); } }
    render() { for (const system of this.systems) { if (system.render) system.render(this); } }
}