import { Controller, AxisSource } from "./input/Controller";
import { Clock } from "./Clock";
import { Keyboard } from "./input/Keyboard";
import screenfull, { Screenfull } from 'screenfull';
import { defined } from "./util";
import { MouseEvents, MouseEventWrapper } from "./input/Mouse";

const fullscreen = (screenfull.isEnabled) ? screenfull as Screenfull : undefined;

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

        this.controller.registerKeys('walk', ['ShiftLeft', 'ShiftRight']);
        this.controller.registerKeys('toggleFullscreen', ['Backslash']);

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

    afterFrame({ clock }: { clock: Clock }) {
        // @HACK: This belongs somewhere else
        if (defined(fullscreen)) {
            if (this.wasActive('toggleFullscreen')) {
                fullscreen.toggle(this.controller.element);
            }
        }

        const realDtSec = clock.realDt / 1000;
        this.controller.update(realDtSec);
    }
}