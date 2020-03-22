// --------------------------------------------------------------------------------------------------------------------
// A wonderful, beautiful Debug Menu GUI. See https://workshop.chromeexperiments.com/examples/gui/#1--Basic-Usage
//
// For bundle size, performance, and production reasons, the true dat.gui bundle is not loaded until it is first shown.
// Until thin, a thin shim layer collects all functions called on the static exported DebugMenu object. Once the menu
// is requested, the dat.gui bundle is downloaded and executed. All the buffered functions are called, and the shim 
// objects' functions are rebound to the dat.gui functions. 
// --------------------------------------------------------------------------------------------------------------------
interface IDebugMenu {
    add(target: Object, propName:string, min?: number, max?: number, step?: number): any;
    add(target: Object, propName:string, status: boolean): any;
    add(target: Object, propName:string, items:string[]): any;
    add(target: Object, propName:string, items:number[]): any;
    add(target: Object, propName:string, items:Object): any;

    addFolder(propName:string): IDebugMenu;

    show(): void;
    hide(): void;

    update(): void;
}

class DebugMenuShim implements IDebugMenu {
    private _gui: any;
    private _add: IArguments[] = [];
    private _folders: { [name: string]: DebugMenuShim } = {}

    constructor() {
    }

    add(target: Object, propName:string, min?: number | boolean | string[] | Object, max?: number, step?: number): void { 
        this._add.push(arguments); 
    }

    addFolder(propName:string): IDebugMenu {
        this._folders[propName] = new DebugMenuShim();
        return this._folders[propName];
    }

    async show() {
        // The first time we show the menu, dynamically download and execute the dat.gui bundle
        if (this._gui === undefined) { 
            const dat = await import(/* webpackChunkName: "dat-gui" */ 'dat.gui'); 
            this._gui = new dat.GUI()
        }

        // Call all buffered shim functions (recursively for folders)
        for (const args of this._add) { this._gui.add.apply(this._gui, args); }
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
        }
    }
}


// @HACK: Install a global DebugMenu keyboard shortcut
window.onkeyup = (e: KeyboardEvent) => {
    if (e.code === 'KeyT') {
        DebugMenu.show();
    }
};

export let DebugMenu = new DebugMenuShim();
