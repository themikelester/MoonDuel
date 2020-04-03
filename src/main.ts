
import { GITHUB_REVISION_URL, IS_DEVELOPMENT} from './version';
import { WebGlRenderer } from './gfx/WebGl';
import { Renderer } from './gfx/GfxTypes';
import { Camera } from './Camera';
import { DebugMenu } from './DebugMenu';

// Modules
import { AvatarSystem } from './Avatar';
import { CameraSystem } from './CameraSystem';
import { Clock } from './Clock';
import { Compositor } from './Compositor';
import { DebugGrid } from './DebugGrid';
import { Demo } from './Demo';
import { GlobalUniforms } from './GlobalUniforms';
import { InputManager } from './Input';
import { ResourceManager } from './resources/ResourceLoading';
import { StateManager } from './SaveState';

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL_GENERIC,
}

class Main {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement = document.createElement('canvas');

    public gfxDevice: Renderer = new WebGlRenderer();
    public camera: Camera = new Camera();

    // Modules
    public avatar = new AvatarSystem();
    public clock = new Clock();
    public cameraSystem = new CameraSystem(this.camera);
    public compositor = new Compositor(this.canvas, this.gfxDevice);
    public debugGrid = new DebugGrid();
    public globalUniforms = new GlobalUniforms(this.gfxDevice);
    public demo = new Demo();
    public input = new InputManager();
    public resources = new ResourceManager();
    public state = new StateManager();
    
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
        this.clock.initialize();
        this.input.initialize(this);
        this.cameraSystem.initialize(this);
        this.compositor.initialize();
        this.globalUniforms.initialize();
        // this.demo.initialize(this);
        this.avatar.initialize(this);
        this.debugGrid.initialize(this);
        this.state.initialize(this);
        
        // Handle resizing
        window.onresize = this.onResize.bind(this);
        this.onResize();

        if (!IS_DEVELOPMENT) {
            // Initialize Rollbar/Sentry for error reporting
        } else {
            // Show debug menu by default on development builds
            DebugMenu.show();
        }

        this.update(window.performance.now());

        return InitErrorCode.SUCCESS;
    }

    private update(time: number) {
        this.clock.update(time);    
        this.resources.update();
        this.cameraSystem.update(this);
        // this.demo.update(this);
        this.avatar.update(this);
        this.state.update(this);
        this.globalUniforms.update();

        // this.demo.render(this);
        this.avatar.render(this);
        this.debugGrid.render(this);
        this.compositor.render();

        this.input.afterFrame(this);

        DebugMenu.update();

        window.requestAnimationFrame(this.update.bind(this));
    };

    private onResize() {
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
