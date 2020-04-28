// --------------------------------------------------------------------------------------------------------------------
// A wonderful, beautiful Debug Menu GUI. See https://workshop.chromeexperiments.com/examples/gui/#1--Basic-Usage
//
// For bundle size, performance, and production reasons, the true dat.gui bundle is not loaded until it is first shown.
// Until thin, a thin shim layer collects all functions called on the static exported DebugMenu object. Once the menu
// is requested, the dat.gui bundle is downloaded and executed. All the buffered functions are called, and the shim 
// objects' functions are rebound to the dat.gui functions. 
// --------------------------------------------------------------------------------------------------------------------

import { defined, assert } from './util';

type ICallback = (value?: any) => void;

export interface IGUIController {
    onChange(fnc: ICallback): void;
}

export interface IDebugMenu {
    add(target: Object, propName:string, min?: number, max?: number, step?: number): IGUIController;
    add(target: Object, propName:string, status: boolean): IGUIController;
    add(target: Object, propName:string, items:string[]): IGUIController;
    add(target: Object, propName:string, items:number[]): IGUIController;
    add(target: Object, propName:string, items:Object): IGUIController;

    addFolder(propName:string): IDebugMenu;

    show(): void;
    hide(): void;

    update(): void;
}

interface DebugAdd {
    args: IArguments;
    onChange?: ICallback;
}

export class DebugMenu implements IDebugMenu {
    private _gui: any;
    private _add: DebugAdd[] = [];
    private _addOnChange: ICallback[] = [];
    private _folders: { [name: string]: DebugMenu } = {};
    private _saveObject: any;

    constructor() {
    }

    add(target: Object, propName:string, min?: number | boolean | string[] | Object, max?: number, step?: number): IGUIController { 
        const debugAdd: DebugAdd = { args: arguments };
        this._add.push(debugAdd);
        return {
            onChange: (fnc: ICallback) => { 
                debugAdd.onChange = fnc; 
            }
        }
    }

    addFolder(propName:string): IDebugMenu {
        this._folders[propName] = new DebugMenu();
        return this._folders[propName];
    }

    async show() {
        // The first time we show the menu, dynamically download and execute the dat.gui bundle
        if (this._gui === undefined) { 
            const dat = await import(/* webpackChunkName: "dat-gui" */ 'dat.gui'); 
            this._gui = new dat.GUI({ load: this._saveObject });
        }

        // Respect the global 'closed' save state property, even though we're 'showing' for the first time
        if (this._saveObject?.closed) { this._gui.close(); }

        // Call all buffered shim functions (recursively for folders)
        for (const debugAdd of this._add) {
            this._gui.getRoot().remember(debugAdd.args[0]); 
            const controller = this._gui.add.apply(this._gui, debugAdd.args); 
            if (debugAdd.onChange) { controller.onChange(debugAdd.onChange); }
        }

        for (const folderName in this._folders) { 
            this._folders[folderName]._gui = this._gui.addFolder(folderName);
            this._folders[folderName].show() 
        };

        // Replace this shim with a real dat.gui object
        this.add = this._gui.add.bind(this._gui);
        this.addFolder = this._gui.addFolder.bind(this._gui);
        this.show = this._gui.show.bind(this._gui);
        this.hide = this._gui.hide.bind(this._gui);
    }

    hide() {}

    update() {
        if (this._gui && !this._gui.closed) {
            for (var i in this._gui.__controllers) {
                this._gui.__controllers[i].updateDisplay();
            }

            for (const folderName in this._gui.__folders) {
                const folder = this._gui.__folders[folderName];
                for (const controller of folder.__controllers) {
                    controller.updateDisplay();
                }
            }
        }
    }

    toJSON() {
        return this._gui ? this._gui.getSaveObject() : undefined;
    }

    fromJSON(saveObject: any) {
        assert(!defined(this._gui), 'State must be loaded before the DebugMenu is shown');
        this._saveObject = saveObject;
    }
}