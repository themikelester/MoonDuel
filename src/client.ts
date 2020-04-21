
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
import { NetModule } from './net/NetModule';
import { ResourceManager } from './resources/ResourceLoading';
import { StateManager } from './SaveState';
import { SnapshotManager } from './Snapshot';
import { UserCommandBuffer } from './UserCommand';
import { SignalSocket } from './net/SignalSocket';

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL_GENERIC,
}

export class Client {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement = document.createElement('canvas');

    public headless: boolean = false;
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
    public net = new NetModule();
    public resources = new ResourceManager();
    public snapshot = new SnapshotManager();
    public state = new StateManager();
    public userCommands = new UserCommandBuffer();
    
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
        this.net.initialize();
        this.cameraSystem.initialize(this);
        this.compositor.initialize();
        this.globalUniforms.initialize();
        // this.demo.initialize(this);
        this.avatar.initialize(this);
        this.debugGrid.initialize(this);
        this.snapshot.initialize();
        this.state.initialize(this);
        this.userCommands.initialize();
        
        // Handle resizing
        window.onresize = this.onResize.bind(this);
        this.onResize();

        if (!IS_DEVELOPMENT) {
            // Initialize Rollbar/Sentry for error reporting
        } else {
            // Show debug menu by default on development builds
            DebugMenu.show();
        }

        window.requestAnimationFrame(this.tick.bind(this));

        return InitErrorCode.SUCCESS;
    }

    onConnect(signalSocket: SignalSocket) {
        this.net.onConnectClient(signalSocket);
    }

    private tick(time: number) {
        this.clock.tick(time);
        
        this.updateFixed();
        this.update();
        this.render();

        this.input.afterFrame();

        DebugMenu.update();

        window.requestAnimationFrame(this.tick.bind(this));
    }

    private updateFixed() {
        while ((this.clock.realTime - this.clock.simTime) >= this.clock.simDt) {
            this.clock.updateFixed();
            this.input.updateFixed(this);
            this.avatar.updateFixed(this);
            this.snapshot.updateFixed(this);
        }
    }

    private update() {
        this.input.update();
        this.net.update();  
        this.snapshot.update(this);  
        this.resources.update();
        this.avatar.update(this);
        this.cameraSystem.update(this);
        // this.demo.update(this);
        this.state.update(this);
        this.globalUniforms.update();
    }

    private render() {
        // this.demo.render(this);
        this.avatar.render(this);
        this.debugGrid.render(this);
        this.compositor.render();
    };

    private onResize() {
        this.cameraSystem.resize(window.innerWidth / window.innerHeight);
        this.compositor.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    }
}