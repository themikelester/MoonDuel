import { defined, assert, arrayRemove, assertDefined } from "./util";

export type Callback = (...args: any[]) => void;

/**
 * @classdesc Abstract base class that implements functionality for event dispatching and handling.
 * @example
 * var obj = new EventHandlerSubclass();
 *
 * // subscribe to an event
 * obj.on('hello', function (str) {
 *     console.log('event hello is fired', str);
 * });
 *
 * // fire event
 * obj.fire('hello', 'world');
 */
export class EventDispatcher {
    private callbacks?: Record<string, Callback[]>;

    /**
     * @description Attach an event handler to an event.
     * @param {string} name - Name of the event to bind the callback to.
     * @param {callbacks.HandleEvent} callback - Function that is called when event is fired. Note the callback is limited to 8 arguments.
     * @returns {EventHandler} Self for chaining.
     * @example
     * obj.on('test', function (a, b) {
     *     console.log(a + b);
     * });
     * obj.fire('test', 1, 2); // prints 3 to the console
     */
    on(name: string, callback: Callback): EventDispatcher {
        if (!defined(this.callbacks)) { this.callbacks = {}; }
        if (!defined(this.callbacks[name])) { this.callbacks[name] = []; }

        assert(this.callbacks[name].indexOf(callback) === -1, 'Attempted to add the same callback twice');
        this.callbacks[name].push(callback);
        return this;
    }

    /**
     * @description Attach an event handler to an event. This handler will be removed after being fired once.
     * @param {string} name - Name of the event to bind the callback to.
     * @param {callbacks.HandleEvent} callback - Function that is called when event is fired.
     * @returns {EventHandler} Self for chaining.
     * @example
     * obj.once('test', function (a, b) {
     *     console.log(a + b);
     * });
     * obj.fire('test', 1, 2); // prints 3 to the console
     * obj.fire('test', 1, 2); // not going to get handled
     */
    once(name: string, callback: Callback): EventDispatcher {
        const callbackAndRemove = (...args: any) => {
            callback(args);
            this.off(name, callbackAndRemove);
        }

        this.on(name, callbackAndRemove);
        return this;
    }

    /**
     * @description Detach an event handler from an event.
     * @param {string} [name] - Name of the event to unbind.
     * @param {callbacks.HandleEvent} [callback] - Function to be unbound.
     * @returns {EventHandler} Self for chaining.
     * @example
     * var handler = function () {
     * };
     * obj.on('test', handler);
     *
     * obj.off('test', handler); // Removes handler from the event called 'test'
     */
    off(name: string, callback: Callback): EventDispatcher {
        arrayRemove(assertDefined(this.callbacks)[name], callback);
        return this;
    }

    /**
     * @description Fire an event, all additional arguments are passed on to the event listener.
     * @param {object} name - Name of event to fire.
     * @param {...*} [var_args] - Extra arguments that are passed to the event handler.
     * @returns {EventHandler} Self for chaining.
     * @example
     * obj.fire('test', 'This is the message');
     */
    fire(name: any, ...args: any[]): EventDispatcher {
        if (!this.hasHandlers(name)) { 
            return this;
        }

        for (const callback of this.callbacks![name]) {
            callback(...args);
        }
        return this;
    }

    /**
     * @description Test if there are any handlers bound to an event name.
     * @param {string} name - The name of the event to test.
     * @returns {boolean} True if the object has handlers bound to the specified event name.
     * @example
     * obj.on('test', function () { }); // bind an event to 'test'
     * obj.hasEvent('test'); // returns true
     * obj.hasEvent('hello'); // returns false
     */
    hasHandlers(name: string): boolean {
        return defined(this.callbacks) && defined(this.callbacks[name]) && this.callbacks[name].length > 0;
    }
}