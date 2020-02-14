
import { GITHUB_REVISION_URL, IS_DEVELOPMENT} from './version';
import { Compositor } from './Compositor';

class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement = document.createElement('canvas');
    public paused: boolean = false;

    // Modules
    public compositor: Compositor = new Compositor(this.canvas);

    constructor() {
        this.init();
    }

    public async init() {
        console.log(`Source for this build available at ${GITHUB_REVISION_URL}`);

        // DOM creation
        this.toplevel = document.createElement('div');
        document.body.appendChild(this.toplevel);
        this.toplevel.appendChild(this.canvas);

        // Initialize Modules
        this.compositor.initialize(); 
        
        // Handle resizing
        window.onresize = this._onResize.bind(this);
        this._onResize();

        this._updateLoop(window.performance.now());

        if (!IS_DEVELOPMENT) {
            // Initialize Rollbar/Sentry for error reporting
        }
    }

    public setPaused(v: boolean): void {
        if (this.paused === v)
            return;

        this.paused = true;
        if (!this.paused)
            window.requestAnimationFrame(this._updateLoop);
    }

    private _updateLoop = (time: number) => {
        if (this.paused)
            return;

        window.requestAnimationFrame(this._updateLoop);
    };

    private _onResize() {
        this.compositor.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    }
}

// Google Analytics
declare var gtag: (command: string, eventName: string, eventParameters: { [key: string]: string }) => void;

// Declare a "main" object for easy access.
declare global {
    interface Window {
        main: any;
    }
}

window.main = new Main();

// Debug utilities.
declare global {
    interface Window {
        debug: any;
    }
}
