import { defined, assertDefined } from "./util";

declare global {
    interface HTMLElement {
        requestPointerLock(): void;
    }

    interface Document {
        exitPointerLock(): void;
    }
}

function isModifier(key: string) {
    switch (key) {
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'AltLeft':
    case 'AltRight':
        return true;
    default:
        return false;
    }
}

interface InputAxis {
    keyPos?: string;
    keyNeg?: string;
    value: number;
}

const kAxes: { [name: string]: InputAxis} = {
    'Vertical': {
        keyPos: 'KeyW',
        keyNeg: 'KeyS',
        value: 0,
    },

    'Horizontal': {
        keyPos: 'KeyD',
        keyNeg: 'KeyA',
        value: 0,
    }
}

export type Listener = (inputManager: InputManager) => void;

const enum TouchGesture {
    None,
    Scroll, // 1-finger scroll and pan
    Pinch, // 2-finger pinch in and out
}

export class InputManager {
    public invertY = false;
    public invertX = false;

    public toplevel: HTMLElement;
    // tristate. non-existent = not pressed, false = pressed but not this frame, true = pressed this frame.
    public keysDown: Map<string, boolean>;
    public dx: number;
    public dy: number;
    public dz: number;
    public button: number = -1;
    public onisdraggingchanged: (() => void) | null = null;
    private listeners: Listener[] = [];
    private scrollListeners: Listener[] = [];
    private usePointerLock: boolean = true;
    public isInteractive: boolean = true;

    private touchGesture: TouchGesture = TouchGesture.None;
    private prevTouchX: number = 0; // When scrolling, contains finger X; when pinching, contains midpoint X
    private prevTouchY: number = 0; // When scrolling, contains finger Y; when pinching, contains midpoint Y
    private prevPinchDist: number = 0;
    private dTouchX: number = 0;
    private dTouchY: number = 0;
    private dPinchDist: number = 0;

    private axes = kAxes;

    public initialize({ toplevel }: { toplevel: HTMLElement }) {  
        document.body.tabIndex = -1;

        this.toplevel = toplevel;
        this.toplevel.tabIndex = -1;

        this.keysDown = new Map<string, boolean>();
          
        // https://discussion.evernote.com/topic/114013-web-clipper-chrome-extension-steals-javascript-keyup-events/
        document.addEventListener('keydown', this._onKeyDown, { capture: true });
        document.addEventListener('keyup', this._onKeyUp, { capture: true });
        window.addEventListener('blur', this._onBlur);
        this.toplevel.addEventListener('wheel', this._onWheel, { passive: false });
        this.toplevel.addEventListener('mousedown', (e) => {
            if (!this.isInteractive)
                return;
            this.button = e.button;
            GlobalGrabManager.takeGrab(this, e, { takePointerLock: this.usePointerLock, useGrabbingCursor: true, releaseOnMouseUp: true });
            if (this.onisdraggingchanged !== null)
                this.onisdraggingchanged();
        });

        this.toplevel.addEventListener('touchstart', this._onTouchChange);
        this.toplevel.addEventListener('touchend', this._onTouchChange);
        this.toplevel.addEventListener('touchcancel', this._onTouchChange);
        this.toplevel.addEventListener('touchmove', this._onTouchMove);

        this.afterFrame();
    }

    public addListener(listener: Listener): void {
        this.listeners.push(listener);
    }

    public addScrollListener(listener: Listener): void {
        this.scrollListeners.push(listener);
    }

    public getMouseDeltaX(): number {
        return this.dx;
    }

    public getMouseDeltaY(): number {
        return this.dy;
    }

    public getTouchDeltaX(): number {
        // XXX: In non-pinch mode, touch deltas are turned into mouse deltas.
        return this.touchGesture == TouchGesture.Pinch ? this.dTouchX : 0;
    }

    public getTouchDeltaY(): number {
        // XXX: In non-pinch mode, touch deltas are turned into mouse deltas.
        return this.touchGesture == TouchGesture.Pinch ? this.dTouchY : 0;
    }

    public getPinchDeltaDist(): number {
        return this.touchGesture == TouchGesture.Pinch ? this.dPinchDist : 0;
    }

    public isKeyDownEventTriggered(key: string): boolean {
        return !!this.keysDown.get(key);
    }

    public isKeyDown(key: string): boolean {
        return this.keysDown.has(key);
    }

    public isDragging(): boolean {
        return this.touchGesture != TouchGesture.None || GlobalGrabManager.hasGrabListener(this);
    }

    public afterFrame() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
        this.dTouchX = 0;
        this.dTouchY = 0;
        this.dPinchDist = 0;

        // Go through and mark all keys as non-event-triggered.
        this.keysDown.forEach((v, k) => {
            this.keysDown.set(k, false);
        });
    }

    public focusViewer() {
        this.toplevel.focus();
    }

    private _hasFocus() {
        return document.activeElement === document.body || document.activeElement === this.toplevel;
    }

    private callListeners(): void {
        for (let i = 0; i < this.listeners.length; i++)
            this.listeners[i](this);
    }

    private callScrollListeners(): void {
        for (let i = 0; i < this.scrollListeners.length; i++)
            this.scrollListeners[i](this);
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        if (isModifier(e.code)) {
            e.preventDefault();
        } else {
            if (!this._hasFocus()) return;
        }

        this.keysDown.set(e.code, !e.repeat);
        this.callListeners();
    };

    private _onKeyUp = (e: KeyboardEvent) => {
        this.keysDown.delete(e.code);
        this.callListeners();
    };

    private _onBlur = () => {
        this.keysDown.clear();
        this.callListeners();
    };

    private _onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.dz += Math.sign(e.deltaY) * -4;
        this.callScrollListeners();
    };

    private _getScaledTouches(touches: TouchList): {x: number, y: number}[] {
        const result = []
        const scale = 1000 / Math.max(1, Math.min(this.toplevel.clientWidth, this.toplevel.clientHeight));
        for (let i = 0; i < touches.length; i++) {
            result.push({
                x: touches[i].clientX * scale,
                y: touches[i].clientY * scale
            });
        }
        return result;
    }

    private _getPinchValues(touches: TouchList): {x: number, y: number, dist: number} {
        const scaledTouches = this._getScaledTouches(touches);
        return {
            x: (scaledTouches[0].x + scaledTouches[1].x) / 2,
            y: (scaledTouches[0].y + scaledTouches[1].y) / 2,
            dist: Math.hypot(scaledTouches[0].x - scaledTouches[1].x, scaledTouches[0].y - scaledTouches[1].y),
        };
    }

    private _onTouchChange = (e: TouchEvent) => { // start, end or cancel a touch
        if (!this.isInteractive)
            return;
        e.preventDefault();
        if (e.touches.length == 1) {
            const scaledTouches = this._getScaledTouches(e.touches);
            this.touchGesture = TouchGesture.Scroll;
            this.prevTouchX = scaledTouches[0].x;
            this.prevTouchY = scaledTouches[0].y;
            this.dTouchX = 0;
            this.dTouchY = 0;
        } else if (e.touches.length == 2) {
            const pinchValues = this._getPinchValues(e.touches);
            this.touchGesture = TouchGesture.Pinch;
            this.prevTouchX = pinchValues.x;
            this.prevTouchY = pinchValues.y;
            this.prevPinchDist = pinchValues.dist;
            this.dTouchX = 0;
            this.dTouchY = 0;
            this.dPinchDist = 0;
        } else {
            this.touchGesture = TouchGesture.None;
        }
    };

    private _onTouchMove = (e: TouchEvent) => {
        if (!this.isInteractive)
            return;
        e.preventDefault();
        if (e.touches.length == 1) {
            const scaledTouches = this._getScaledTouches(e.touches);
            this.touchGesture = TouchGesture.Scroll;
            this.dTouchX = scaledTouches[0].x - this.prevTouchX;
            this.dTouchY = scaledTouches[0].y - this.prevTouchY;
            this.onMotion(this.dTouchX, this.dTouchY);
            this.prevTouchX = scaledTouches[0].x;
            this.prevTouchY = scaledTouches[0].y;
        } else if (e.touches.length == 2) {
            const pinchValues = this._getPinchValues(e.touches);
            this.touchGesture = TouchGesture.Pinch;
            this.dTouchX = pinchValues.x - this.prevTouchX;
            this.dTouchY = pinchValues.y - this.prevTouchY;
            this.dPinchDist = pinchValues.dist - this.prevPinchDist;
            this.prevTouchX = pinchValues.x;
            this.prevTouchY = pinchValues.y;
            this.prevPinchDist = pinchValues.dist;
        } else {
            this.touchGesture = TouchGesture.None;
        }
    }

    public onMotion(dx: number, dy: number) {
        this.dx += dx;
        this.dy += dy;
    }

    public onGrabReleased () {
        this.button = -1;
        if (this.onisdraggingchanged !== null)
            this.onisdraggingchanged();
    }

    public getAxis(name: string) {
        const axis = assertDefined(this.axes[name]);
        let value = 0;

        if (defined(axis.keyPos) && this.isKeyDown(axis.keyPos)) value += 1;
        if (defined(axis.keyNeg) && this.isKeyDown(axis.keyNeg)) value -= 1;

        return value;
    }
}


interface GrabListener {
    onMotion(dx: number, dy: number): void;
    onGrabReleased(): void;
}

interface GrabOptions {
    takePointerLock: boolean;
    useGrabbingCursor: boolean;
    releaseOnMouseUp: boolean;
    grabElement?: HTMLElement;
}

class CursorOverride {
    private styleElem: HTMLStyleElement;
    private style: CSSStyleSheet;

    constructor() {
        this.styleElem = document.createElement('style');
        document.head.appendChild(this.styleElem);
        this.style = this.styleElem.sheet as CSSStyleSheet;
    }

    public setCursor(cursors: string[] | null): void {
        if (this.style.cssRules.length)
            this.style.deleteRule(0);

        if (cursors) {
            const ruleLines = cursors.map((cursor) => `cursor: ${cursor} !important;`);
            const rule = `* { ${ruleLines.join(' ')} }`;
            this.style.insertRule(rule, 0);
        }
    }
}

export const GlobalCursorOverride = new CursorOverride();

function containsElement(sub_: HTMLElement, searchFor: HTMLElement): boolean {
    let sub: HTMLElement | null = sub_;
    while (sub !== null) {
        if (sub === searchFor)
            return true;
        sub = sub.parentElement;
    }
    return false;
}

export class GrabManager {
    private grabListener: GrabListener | null = null;
    private grabOptions: GrabOptions | null = null;

    private lastX: number = -1;
    private lastY: number = -1;

    private _onMouseMove = (e: MouseEvent) => {
        if (this.grabListener === null)
            return;

        let dx: number, dy: number;
        if (e.movementX !== undefined) {
            dx = e.movementX;
            dy = e.movementY;
        } else {
            dx = e.pageX - this.lastX;
            dy = e.pageY - this.lastY;
            this.lastX = e.pageX;
            this.lastY = e.pageY;
        }

        this.grabListener.onMotion(dx, dy);
    };

    private _onMouseDown = (e: MouseEvent) => {
        const grabElement = this.grabOptions!.grabElement;
        if (grabElement && !containsElement(e.target as HTMLElement, grabElement))
            this.releaseGrab();
    };

    private _onMouseUp = (e: MouseEvent) => {
        this.releaseGrab();
    };

    public hasGrabListener(grabListener: GrabListener): boolean {
        return this.grabListener === grabListener;
    }

    public isGrabbed(): boolean {
        return this.grabListener !== null;
    }

    public takeGrab(grabListener: GrabListener, e: MouseEvent, grabOptions: GrabOptions): void {
        if (this.grabListener !== null)
            return;

        this.grabListener = grabListener;
        this.grabOptions = grabOptions;

        if (grabOptions.useGrabbingCursor)
            GlobalCursorOverride.setCursor(['grabbing', '-webkit-grabbing']);

        this.lastX = e.pageX;
        this.lastY = e.pageY;
        // Needed to make the cursor update in Chrome. See:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=676644
        document.body.focus();
        e.preventDefault();

        const target = e.target as HTMLElement;
        if (grabOptions.takePointerLock && target.requestPointerLock !== undefined)
            target.requestPointerLock();

        document.addEventListener('mousemove', this._onMouseMove);
        if (grabOptions.releaseOnMouseUp)
            document.addEventListener('mouseup', this._onMouseUp);
        else
            document.addEventListener('mousedown', this._onMouseDown, { capture: true });
    }

    public releaseGrab(): void {
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);
        document.removeEventListener('mousedown', this._onMouseDown, { capture: true });

        if (document.exitPointerLock !== undefined)
            document.exitPointerLock();

        GlobalCursorOverride.setCursor(null);

        // Call onGrabReleased after we set the grabListener to null so that if the callback calls
        // isDragging() or hasDragListener() we appear as if we have no grab.
        const grabListener = this.grabListener!;
        this.grabListener = null;
        grabListener.onGrabReleased();

        this.grabOptions = null;
    }
}

const GlobalGrabManager = new GrabManager();
