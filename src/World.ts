import { Component, ComponentClass } from "./Component";
import { Entity } from "./Entity";
import { EventDispatcher } from './EventDispatcher';
import { Renderer } from "./gfx/GfxTypes";
import { Camera } from "./Camera";
import { Family, FamilyBuilder } from "./Family";
import { ResourceManager } from "./resources/ResourceLoading";
import { AvatarSingleton } from "./Avatar";

export interface SystemContext {
    resources: ResourceManager;
}

export interface System {
    initialize?: (world: World, context: SystemContext) => void;
    terminate?: (world: World) => void;

    update?: (world: World) => void;
    updateFixed?: (world: World) => void;
    render?: (world: World) => void;
    
    // onResize?: (world: World) => void;
    // onVisibility?: (visible: boolean, world: World) => void;
}

export enum Singleton {
    Renderer,
    Camera,
    Avatar,
}

export class World extends EventDispatcher {
    systems: System[] = [];
    entities: Entity[] = [];
    private families: Record<string, Family> = {};
    private singletons: Partial<Record<Singleton, Component>> = {};

    static Events = {
        EntityAdded: 'ea',
        EntityRemoved: 'er'
    };

    constructor(systems: System[]) {
        super();
        this.systems = systems;
    }

    addFamily(name: string, ...classes: ComponentClass<Component>[]) {
        this.families[name] = new FamilyBuilder(this).require(...classes).build();
    }

    getFamily(name: string) {
        return this.families[name];
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
    addSingleton(singleton: Singleton, component: Component) { this.singletons[singleton] = component; }
    getSingletonRenderer() { return this.singletons[Singleton.Renderer] as Renderer; }
    getSingletonCamera() { return this.singletons[Singleton.Camera] as Camera; }
    getSingletonAvatar() { return this.singletons[Singleton.Avatar] as AvatarSingleton; }

    // Lifecycle
    initialize(context: SystemContext) { for (const system of this.systems) { if (system.initialize) system.initialize(this, context); } }
    terminate() { for (const system of this.systems) { if (system.terminate) system.terminate(this); } }
    update() { for (const system of this.systems) { if (system.update) system.update(this); } }
    updateFixed() { for (const system of this.systems) { if (system.updateFixed) system.updateFixed(this); } }
    render() { for (const system of this.systems) { if (system.render) system.render(this); } }
}