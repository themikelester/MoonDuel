import { Controller, AxisSource } from "./input/Controller";
import { Clock } from "./Clock";

export class InputManager {
    controller: Controller = new Controller();

    initialize({ toplevel }: { toplevel: HTMLElement}) {
        this.controller.attach(document as any);
        this.controller.enableKeyboard();
        this.controller.enableTouches();

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