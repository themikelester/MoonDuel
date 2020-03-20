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
    gui: any;
    _folderName: string;
    _add: IArguments[] = [];
    _folders: { [name: string]: DebugMenuShim } = {}

    constructor(folderName?: string) {
        if (folderName) this._folderName = folderName;
    }

    add(target: Object, propName:string, min?: number | boolean | string[] | Object, max?: number, step?: number): void { 
        this._add.push(arguments); 
    }

    addFolder(propName:string): IDebugMenu {
        this._folders[propName] = new DebugMenuShim(propName);
        return this._folders[propName];
    }

    async show() {
        // The first time we show the menu, dynamically download and execute the dat.gui bundle
        if (this.gui === undefined) { 
            const dat = await import(/* webpackChunkName: "dat-gui" */ 'dat.gui'); 
            this.gui = new dat.GUI()
        }

        // Call all buffered shim functions (recursively for folders)
        for (const args of this._add) { this.gui.add.apply(this.gui, args); }
        for (const folderName in this._folders) { 
            this._folders[folderName].gui = this.gui.addFolder(folderName);
            this._folders[folderName].show() 
        };

        // Replace this shim with a real dat.gui object
        this.add = this.gui.add.bind(this.gui);
        this.addFolder = this.gui.addFolder.bind(this.gui);
        this.show = this.gui.show.bind(this.gui);
        this.hide = this.gui.hide.bind(this.gui);
    }

    hide() {}

    update() {
        if (this.gui && !this.gui.closed) {
            for (var i in this.gui.__controllers) {
                this.gui.__controllers[i].updateDisplay();
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
