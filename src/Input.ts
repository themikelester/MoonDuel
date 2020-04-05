import { Controller, AxisSource } from "./input/Controller";
import { Clock } from "./Clock";
import { Keyboard } from "./input/Keyboard";

export class InputManager {
    controller: Controller = new Controller();

    initialize({ toplevel }: { toplevel: HTMLElement}) {
        this.controller.attach(toplevel);
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
        this.controller.registerKeys('walk', ['ShiftLeft', 'ShiftRight']);


        this.controller.registerAxis('Horizontal', {
            source: AxisSource.TouchDragX,
        });

        this.controller.registerAxis('Vertical', {
            source: AxisSource.TouchDragY,
            invert: true,
        });
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

    afterFrame({ clock }: { clock: Clock }) {
        const realDtSec = clock.realDt / 1000;
        this.controller.update(realDtSec);
    }
}