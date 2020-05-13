import { TouchDevice } from "./Touch";
import { defined, assert, assertDefined } from "../util";
import { Keyboard } from "./Keyboard";
import screenfull, { Screenfull } from 'screenfull';
import { Mouse } from "./Mouse";

class Action {
    constructor(public name: string) {}

    keys?: string[];
    mouseButtons?: number[];
    padButtons?: string[];
    padIndexes?: number[];
}

export enum AxisSource {
    MouseDragX,
    MouseDragY,
    MouseWheel,

    TouchDragX,
    TouchDragY,
    TouchPinch,
    TouchRotate,

    TwoTouchDragX,
    TwoTouchDragY,
    
    PadLeftStickX,
    PadLeftStickY,
    PadRightStickX,
    PadRightStickY,

    Key,
}

export interface AxisOptions {
    source: AxisSource,
    
    index?: number; // Touch index or gamepad index. E.g. 1 with an AxisSource of TouchDragX means the second finger X drag.
    positiveKey?: string; // For Key sources, the key code which corresponds to the positive axis
    negativeKey?: string; // For Key sources, the key code which corresponds to the negative axis

    invert?: boolean; // Flips the output. E.g. for outputs with a range of 1 it will be [1-0] instead of [0-1]
    deadZone?: number; // From [0-1]. Values below this will be clamped to 0.0, and above will lerp to 1.0.
    range?: number; // Limits the normalized range of the axis. E.g. for MouseDragX, 0.5 would mean that 
                    // the axis returns 1.0 once the mouse has been dragged half way across the width of the element
}

export interface Axis {
    options: AxisOptions;
    value: number;
    func?: () => number;
}

export class Controller {
    public mouse: Mouse;
    public keyboard: Keyboard;
    public touch?: TouchDevice;
    public element?: Element;

    private actions: Record<string, Action> = {};
    private axes: Record<string, Axis[]> = {};
    
    /**
     * Attach Controller to a Element, this is required before you can monitor for key/mouse inputs.
     */
    attach(element: Element) {
        this.element = element;

        if (defined(this.touch)) this.touch.attach(element);
        if (defined(this.keyboard)) this.keyboard.attach(element);
        if (defined(this.mouse)) this.mouse.attach(element);

        // Clear all key presses when the root element loses focus
        // E.g. while holding 'w' to run forward in a game, pressing Cmd+D while open the bookmark dialog.
        // Without this, the character will continue to run forward until you refocus the window and re-release the keys
        window.addEventListener('blur', () => {
            this.keyboard.clear();
        });

        // Clear all key presses when entering or exiting fullscreen
        // The listeners stop firing during this time, so we can miss a keyup and the key will appear to be stuck
        if (screenfull.isEnabled) {
            (screenfull as Screenfull).onchange(() => {
                this.keyboard.clear();
            });
        }
    }

    /**
     * Detach Controller from an Element, this should be done before the Controller is destroyed.
     */
    detach(element: Element) {
        if (defined(this.touch)) this.touch.detach();
        if (defined(this.keyboard)) this.keyboard.detach();
        if (defined(this.mouse)) this.mouse.detach();
        this.element = undefined;
    }

    /**
     * Disable the context menu usually activated with the right mouse button.
     */
    disableContextMenu() {
        if (!this.mouse) { this.enableMouse(); }
        this.mouse.disableContextMenu();
    };

    /**
     * Enable the context menu usually activated with the right mouse button. This is enabled by default.
     */
    enableContextMenu() {
        if (!this.mouse) { this.enableMouse(); }
        this.mouse.enableContextMenu();
    };

    updateAxes() {
        for (const axisName in this.axes) {
            for (const axis of this.axes[axisName]) {
                if (axis.func) axis.value = axis.func();
            }
        }
    }

    afterFrame() {
        if (this.keyboard) { this.keyboard.update(); }
        if (this.mouse) { this.mouse.update(); }
        // if (this.gamepads) { this.gamepads.update(dt); }
    }
    
    /**
     * Create or update an action which is enabled when any of the supplied keys are pressed.
     * @param {string} action - The name of the action.
     * @param {number[]} keys - A list of key codes. See https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
     */
    registerKeys(actionName: string, keys: string[]) {
        if (!this.keyboard) { this.enableKeyboard(); }
        if (!defined(this.actions[actionName])) { this.actions[actionName] = new Action(name); }

        const action = this.actions[actionName];
        assert(!defined(action.keys), 'Action already has key bindings');
        action.keys = keys;
    };

    /**
     * Create or update an action which is enabled when any of the supplied mouse buttons are pressed.
     * @param {string} action - The name of the action.
     * @param {number[]} buttons - A list of mouse button indices.
     */
    registerMouse(actionName: string, buttons: number[]) {
        if (!this.mouse) { this.enableMouse(); }
        if (!defined(this.actions[actionName])) { this.actions[actionName] = new Action(name); }

        const action = this.actions[actionName];
        assert(!defined(action.mouseButtons), 'Action already has mouse bindings');
        action.mouseButtons = buttons;
    };

    /**
     * Create or update an action which is enabled when any of the supplied gamepad buttons are pressed.
     * @param {string} action - The name of the action.
     * @param {number[]} buttons - A list of gamepad button identifiers.
     * @param {number[]?} indices - If specified the gamepad index for each button in the buttons array. Defaults to gamepad 0.
     */
    registerPadButton(actionName: string, buttons: string[], indices?: number[]) {
        if (!defined(this.actions[actionName])) { this.actions[actionName] = new Action(name); }

        const action = this.actions[actionName];
        assert(!defined(action.padButtons), 'Action already has mouse bindings');
        action.padButtons = buttons;
        action.padIndexes = indices;
    };

    registerAxis(name: string, options: AxisOptions) {
        if (!defined(this.axes[name])) { this.axes[name] = []; }
        const axes = this.axes[name];

        switch (options.source) {
            case AxisSource.Key: {
                axes.push({
                    value: 0,
                    options, 
                    func: () => {
                        let val = 0;
                        if (defined(options.positiveKey)) val += this.keyboard.isPressed(options.positiveKey) ? 1 : 0;
                        if (defined(options.negativeKey)) val += this.keyboard.isPressed(options.negativeKey) ? -1 : 0;
                        return val;
                    }
                });
            } break;

            case AxisSource.TouchDragX:
            case AxisSource.TouchDragY: {
                if (!defined(this.touch)) this.enableTouches();
                const axis = this.touch!.registerAxis(options);
                axes.push(axis);
            } break;
        }
    }

    /**
     * Returns true if the current action is enabled.
     * @param {string} actionName - The name of the action.
     * @returns {boolean} True if the action is enabled.
     */
    isPressed(actionName: string): boolean {
        const action = this.actions[actionName];

        if (!defined(action)) {
            return false;
        }

        if (action.keys) for (const key of action.keys) { if (this.keyboard.isPressed(key)) return true; }
        if (action.mouseButtons) for (const key of action.mouseButtons) { if (this.mouse.isPressed(key)) return true; }
        // if (action.padButtons) {
        //     for (let i = 0; i < action.padButtons.length; i++) {
        //         const button = action.padButtons[i];
        //         const index = action.padIndexes ? action.padIndexes[i] : 0;
        //         if (this.gamepads.isPressed(index, button)) return true; 
        //     }
        // }

        return false;
    };

    /**
     * Returns true if the action was enabled this frame (since the last call to update).
     * @param {string} actionName - The name of the action.
     * @returns {boolean} True if the action is enabled.
     */
    wasPressed(actionName: string): boolean {
        const action = this.actions[actionName];

        if (!defined(action)) {
            return false;
        }

        if (action.keys) for (const key of action.keys) { if (this.keyboard.wasPressed(key)) return true; }
        if (action.mouseButtons) for (const key of action.mouseButtons) { if (this.mouse.wasPressed(key)) return true; }
        // if (action.padButtons) {
        //     for (let i = 0; i < action.padButtons.length; i++) {
        //         const button = action.padButtons[i];
        //         const index = action.padIndexes ? action.padIndexes[i] : 0;
        //         if (this.gamepads.wasPressed(index, button)) return true; 
        //     }
        // }

        return false;
    };

    getAxis(name: string) {
        const axes = assertDefined(this.axes[name], `No axis named "${name}"`);

        let value = 0; 
        for (const axis of axes) {
            if (Math.abs(axis.value) > Math.abs(value)) {
                value = axis.options.invert ? -axis.value : axis.value;
            }
        }

        return value;
    }

    enableMouse() {
        const element = assertDefined(this.element, 'Controller must be attached to an Element');
        this.mouse = new Mouse(element);
    };

    enableKeyboard() {
        const element = assertDefined(this.element, 'Controller must be attached to an Element');
        this.keyboard = new Keyboard(element);
    };

    enableTouches() {
        const element = assertDefined(this.element, 'Controller must be attached to an Element');
        this.touch = new TouchDevice(element);
    };
}