import { Controller, AxisSource } from "./input/Controller";
import { Keyboard } from "./input/Keyboard";
import screenfull, { Screenfull } from 'screenfull';
import { defined } from "./util";
import { Camera } from "./Camera";
import { Clock } from "./Clock";
import { UserCommand, UserCommandBuffer } from "./UserCommand";

const fullscreen = (screenfull.isEnabled) ? screenfull as Screenfull : undefined;

const kCommandBufferLength = 64;

export enum InputAction {
    Walk = 1 << 0,
    Fullscreen = 1 << 1,
}

interface ActionInfo {
    id: string;
    name: string;
    desc: string;
};

const Keymap: Record<InputAction, ActionInfo> = {
    [InputAction.Walk]: { id: 'walk', name: 'Walk', desc: 'Hold to walk instead of run' },
    [InputAction.Fullscreen]: { id: 'fullscreen', name: 'Toggle Fullscreen', desc: 'Toggle fullscreen mode' },
};

export class InputManager {
    controller: Controller = new Controller();

    initialize({ toplevel }: { toplevel: HTMLElement}) {
        this.controller.attach(toplevel);
        this.controller.enableMouse();
        this.controller.enableTouches();

        // Keyboard listeners only work on <div> elements if they have a tabindex set.
        // It makes more sense to capture keys for the whole window, at least for now.
        this.controller.keyboard = new Keyboard(window as any);

        // Set up a rough keymap
        this.controller.registerAxis('Vertical', {
            source: AxisSource.Key,
            positiveKey: 'KeyW',
            negativeKey: 'KeyS',
        });
        this.controller.registerAxis('Horizontal', {
            source: AxisSource.Key,
            positiveKey: 'KeyD',
            negativeKey: 'KeyA',
        });
        this.controller.registerAxis('Horizontal', {
            source: AxisSource.TouchDragX,
        });
        this.controller.registerAxis('Vertical', {
            source: AxisSource.TouchDragY,
            invert: true,
        });

        this.controller.registerKeys(Keymap[InputAction.Walk].id, ['ShiftLeft', 'ShiftRight']);
        this.controller.registerKeys(Keymap[InputAction.Fullscreen].id, ['Backslash']);

        this.controller.disableContextMenu();
    }

    isActive(actionName: string) {
        return this.controller.isPressed(actionName);
    }

    wasActive(actionName: string) {
        return this.controller.wasPressed(actionName);
    }

    getAxis(axisName: string) {
        return this.controller.getAxis(axisName);
    }

    update() {
        this.controller.updateAxes();
    }

    updateFixed({ camera, clock, userCommands }: { camera: Camera, clock: Clock, userCommands: UserCommandBuffer }) {
        // Sample the current input state to find the currently active actions
        const actionCount = Object.keys(Keymap).length;
        let actions = 0;
        for (let i = 0; i < actionCount; i++) {
            const action = 1 << i;
            if (this.isActive(Keymap[action].id)) {
                actions |= action;
            }
        }

        // Write a UserCommand into the input buffer
        const cmd: UserCommand = {
            frame: clock.simFrame,
            headingX: camera.forward[0],
            headingZ: camera.forward[2],
            horizontalAxis: this.getAxis('Horizontal'),
            verticalAxis: this.getAxis('Vertical'),
            actions,
        }

        userCommands.setUserCommand(cmd);
    }

    afterFrame() {
        // @HACK: This belongs somewhere else
        if (defined(fullscreen)) {
            if (this.wasActive('toggleFullscreen')) {
                fullscreen.toggle(this.controller.element);
            }
        }

        this.controller.afterFrame();
    }
}