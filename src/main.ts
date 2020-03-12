
import { GITHUB_REVISION_URL, IS_DEVELOPMENT} from './version';
import { WebGlRenderer } from './gfx/WebGl';
import { Renderer } from './gfx/GfxTypes';
import { Camera } from './Camera';

// Modules
import { CameraSystem } from './CameraSystem';
import { Compositor } from './Compositor';
import { Demo } from './Demo';
import { GlobalUniforms } from './GlobalUniforms';
import { InputManager } from './Input';
import { ResourceManager } from './resources/ResourceLoading';

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL_GENERIC,
}

class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement = document.createElement('canvas');
    public paused: boolean = false;

    public gfxDevice: Renderer = new WebGlRenderer();
    public camera: Camera = new Camera();
    public dt: number = 0;
    public realTime: number = 0;

    // Modules
    public cameraSystem = new CameraSystem(this.camera);
    public compositor = new Compositor(this.canvas, this.gfxDevice);
    public globalUniforms = new GlobalUniforms(this.gfxDevice);
    public demo = new Demo();
    public input = new InputManager();
    public resources = new ResourceManager();
    
    constructor() {
        this.init();
    }

    public async init() {
        console.log(`Source for this build available at ${GITHUB_REVISION_URL}`);

        // DOM creation
        this.toplevel = document.createElement('div');
        document.body.appendChild(this.toplevel);
        this.toplevel.appendChild(this.canvas);

        // Graphics initialization
        this.gfxDevice.setDebugEnabled(IS_DEVELOPMENT);
        const success = this.gfxDevice.initialize(this.canvas);
        if (success) this.gfxDevice.resize(this.canvas.width, this.canvas.height);
        else return InitErrorCode.NO_WEBGL_GENERIC;

        // Initialize Modules
        this.resources.initialize(this.gfxDevice);
        this.input.initialize(this);
        this.cameraSystem.initialize();
        this.compositor.initialize();
        this.globalUniforms.initialize();
        this.demo.initialize(this);
        
        // Handle resizing
        window.onresize = this._onResize.bind(this);
        this._onResize();

        if (!IS_DEVELOPMENT) {
            // Initialize Rollbar/Sentry for error reporting
        }

        this.resources.load('data/utaRunners.jpg', 'texture', (err, res) => {
            console.log(res);
        });

        this._updateLoop(window.performance.now());

        return InitErrorCode.SUCCESS;
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

        this.dt = time - this.realTime;
        this.realTime = time;

        this.resources.update();
        this.cameraSystem.update(this);
        this.demo.update(this);

        this.compositor.render();
        this.demo.render(this);

        this.input.afterFrame();

        window.requestAnimationFrame(this._updateLoop);
    };

    private _onResize() {
        this.cameraSystem.resize(window.innerWidth, window.innerHeight);
        this.compositor.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    }
}

// Google Analytics
declare var gtag: (command: string, eventName: string, eventParameters: { [key: string]: string }) => void;

// Declare useful objects for easy access.
declare global {
    interface Window {
        main: any;
        debug: any;
    }
}

window.main = new Main();
