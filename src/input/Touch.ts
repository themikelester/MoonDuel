import { assertDefined, defaultValue, defined } from "../util";
import { EventDispatcher } from "../EventDispatcher";
import { AxisOptions, Axis, AxisSource } from "./Controller";

export interface TouchCoords {
    x: number,
    y: number,
}

/**
 * A instance of a single point touch on a {@link TouchDevice}. Wraps the original browser touch object.
 * @param {Touch} touch - The browser Touch object.
 * @property {number} id The identifier of the touch.
 * @property {number} x The x co-ordinate relative to the element that the TouchDevice is attached to.
 * @property {number} y The y co-ordinate relative to the element that the TouchDevice is attached to.
 * @property {Element} target The target element of the touch event.
 * @property {Touch} touch The original browser Touch object.
 */
export class TouchWrapper {
    /**
     * The identifier of the touch.
    */
    id: number;
    /**
     * The x co-ordinate relative to the element that the TouchDevice is attached to.
    */
    x: number;
    /**
     * The y co-ordinate relative to the element that the TouchDevice is attached to.
    */
    y: number;
    /**
     * The target element of the touch event.
    */
    target: Element;
    /**
     * The original browser Touch object.
    */
    touch: Touch;

    constructor(touch: Touch) {
        var coords = this.getTouchTargetCoords(touch);
        this.x = coords.x;
        this.y = coords.y;

        this.id = touch.identifier;
        this.target = touch.target as Element;

        this.touch = touch;
    }

    /**
     * Similiar to {@link getTargetCoords} for the MouseEvents.
     * This function takes a browser Touch object and returns the co-ordinates of the
     * touch relative to the target element.
     * @param {Touch} touch - The browser Touch object.
     * @returns {object} The co-ordinates of the touch relative to the touch.target element. In the format {x, y}.
     */
    private getTouchTargetCoords(touch: Touch): TouchCoords {
        var totalOffsetX = 0;
        var totalOffsetY = 0;
        var target = touch.target as Node;
        while (!(target instanceof HTMLElement)) {
            target = assertDefined(target.parentNode);
        }
        var currentElement: HTMLElement | null = target;
    
        do {
            totalOffsetX += currentElement.offsetLeft - currentElement.scrollLeft;
            totalOffsetY += currentElement.offsetTop - currentElement.scrollTop;
            currentElement = currentElement.offsetParent as HTMLElement;
        } while (currentElement);
    
        return {
            x: touch.pageX - totalOffsetX,
            y: touch.pageY - totalOffsetY
        };
    }
}

/**
 * An Event corresponding to touchstart, touchend, touchmove or touchcancel. TouchEvent wraps the standard
 * browser event and provides lists of {@link Touch} objects.
 * @param {TouchDevice} device - The source device of the touch events.
 * @param {TouchEvent} event - The original browser TouchEvent.
 * @property {Element} element The target Element that the event was fired from.
 * @property {Touch[]} touches A list of all touches currently in contact with the device.
 * @property {Touch[]} changedTouches A list of touches that have changed since the last event.
 */
export class TouchEventWrapper {
    /**
     * The original browser TouchEvent.
    */
    event: TouchEvent;
    /**
     * The target Element that the event was fired from.
    */
    element: Element;
    /**
     * A list of all touches currently in contact with the device.
    */
    touches: TouchWrapper[];
    /**
     * A list of touches that have changed since the last event.
    */
    changedTouches: TouchWrapper[];

    constructor(device: TouchDevice, event: TouchEvent) {
        this.element = event.target as Element;
        this.event = event;

        this.touches = [];
        this.changedTouches = [];

        if (event) {
            var i, l = event.touches.length;
            for (i = 0; i < l; i++) {
                this.touches.push(new TouchWrapper(event.touches[i]));
            }

            l = event.changedTouches.length;
            for (i = 0; i < l; i++) {
                this.changedTouches.push(new TouchWrapper(event.changedTouches[i]));
            }
        }
    }

    /**
     * Get an event from one of the touch lists by the id. It is useful to access
     * touches by their id so that you can be sure you are referencing the same touch.
     * @param {number} id - The identifier of the touch.
     * @param {TouchWrapper[]} list - An array of touches to search.
     * @returns {TouchWrapper} The {@link Touch} object or null.
     */
    getTouchById(id: number, list: TouchWrapper[]): Nullable<TouchWrapper> {
        var i, l = list.length;
        for (i = 0; i < l; i++) {
            if (list[i].id === id) {
                return list[i];
            }
        }

        return null;
    }
}
/**
 * @classdesc Attach a TouchDevice to an element and it will receive and fire events when the element is touched.
 * See also {@link Touch} and {@link TouchEvent}.
 * @param {Element} element - The element to attach listen for events on.
 */
export class TouchDevice extends EventDispatcher {
    private element?: Element;

    private onStart: (e: Event) => void;
    private onEnd: (e: Event) => void;
    private onMove: (e: Event) => void;
    private onCancel: (e: Event) => void;
    
    /* Create a new touch device and attach it to an element.
    * @param {Element} element - The element to attach listen for events on.
    */
    constructor(element: Element) {
        super();
        this.element = undefined;

        this.onStart = (e: Event) => this.fire('touchstart', new TouchEventWrapper(this, e as TouchEvent));
        this.onEnd = (e: Event) => this.fire('touchend', new TouchEventWrapper(this, e as TouchEvent));
        this.onCancel = (e: Event) => this.fire('touchcancel', new TouchEventWrapper(this, e as TouchEvent));
        this.onMove = (e: Event) => {
            // call preventDefault to avoid issues in Chrome Android:
            // http://wilsonpage.co.uk/touch-events-in-chrome-android/
            e.preventDefault();
            this.fire('touchmove', new TouchEventWrapper(this, e as TouchEvent));
        }

        this.attach(element);
    }
    
    /**
     * Attach a device to an element in the DOM.
     * If the device is already attached to an element this method will detach it first.
     * @param {Element} element - The element to attach to.
     */
    attach(element: Element): void {
        if (this.element) {
            this.detach();
        }

        this.element = element;

        this.element.addEventListener('touchstart', this.onStart, false);
        this.element.addEventListener('touchend', this.onEnd, false);
        this.element.addEventListener('touchmove', this.onMove, false);
        this.element.addEventListener('touchcancel', this.onCancel, false);
    }

    /**
     * Detach a device from the element it is attached to.
     */
    detach(): void {
        if (this.element) {
            this.element.removeEventListener('touchstart', this.onStart, false);
            this.element.removeEventListener('touchend', this.onEnd, false);
            this.element.removeEventListener('touchmove', this.onMove, false);
            this.element.removeEventListener('touchcancel', this.onCancel, false);
        }
        this.element = undefined;
    }

    registerAxis(options: AxisOptions): Axis {
        let trackedTouchId: number;
        let trackedTouchTime: number;
        let trackedTouchOrigin: number;

        const axis = {
            value: 0,
            options,
        };

        const propName = options.source === AxisSource.TouchDragX ? 'x' : 'y';

        this.on('touchstart', (e: TouchEventWrapper) => {
           const touchIdx = e.touches.length - 1; // If this is the first touch, there will only be one entry. 
           if (touchIdx === defaultValue(options.index, 0)) {
               const newTouch = e.changedTouches[0];
               trackedTouchId = newTouch.id;
               trackedTouchTime = performance.now();
               trackedTouchOrigin = newTouch[propName];

               axis.value = 0;
           }
        });

        this.on('touchend', (e: TouchEventWrapper) => {
            const trackedTouch = e.changedTouches.find(touch => touch.id === trackedTouchId);
            if (defined(trackedTouch)) {
                const newTouch = e.changedTouches[0];
                trackedTouchId = newTouch.id;
                trackedTouchTime = performance.now();
                trackedTouchOrigin = newTouch[propName];

                axis.value = 0;
            }
         });

        this.on('touchmove', (e: TouchEventWrapper) => {
            const trackedTouch = e.changedTouches.find(touch => touch.id === trackedTouchId);
            if (defined(trackedTouch)) {
                const newPos = trackedTouch[propName];
                const newTime = performance.now();

                const dp = newPos - trackedTouchOrigin;
                axis.value = dp;

                trackedTouchTime = newTime;
            }
        })

        return axis;
    }
}