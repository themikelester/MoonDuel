
import { GITHUB_REVISION_URL, IS_DEVELOPMENT} from './version';
import { WebGlRenderer } from './gfx/WebGl';
import { Renderer } from './gfx/GfxTypes';
import { Camera } from './Camera';
import { DebugMenu } from './DebugMenu';

// Modules
import { AvatarSystemClient } from './Avatar';
import { CameraSystem } from './CameraSystem';
import { Clock } from './Clock';
import { Compositor } from './Compositor';
import { DebugGrid } from './DebugGrid';
import { GlobalUniforms } from './GlobalUniforms';
import { InputManager } from './Input';
import { NetModuleClient } from './net/NetModule';
import { ResourceManager } from './resources/ResourceLoading';
import { StateManager } from './SaveState';
import { UserCommandBuffer } from './UserCommand';
import { NetClientState } from './net/NetClient';
import { assertDefined } from './util';
import { WeaponSystem } from './Weapon';
import { DebugRenderUtils } from './DebugRender';
import { SimState, World } from './World';
import { Stage } from './Stage';
import { Skybox } from './Skybox';
import { EnvironmentSystem } from './Environment';
import { ParticleSystem } from './Particles';
import { AudioMixer, SoundManager } from './Audio';

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL_GENERIC,
}

export class Client {
    public toplevel: HTMLElement;
    public canvas: HTMLCanvasElement = document.createElement('canvas');

    public gfxDevice: Renderer = new WebGlRenderer();
    public camera: Camera = new Camera();
    public displayFrame: SimState = { frame: -1, entities: [] };
    public world: World = new World();

    public debugMenu: DebugMenu = new DebugMenu();

    // Modules
    public avatar = new AvatarSystemClient();
    public clock = new Clock();
    public cameraSystem = new CameraSystem(this.camera);
    public compositor = new Compositor(this.canvas, this.gfxDevice);
    public debugGrid = new DebugGrid();
    public environment = new EnvironmentSystem();
    public globalUniforms = new GlobalUniforms(this.gfxDevice);
    public input = new InputManager();
    public sound = new SoundManager();
    public net = new NetModuleClient();
    public particles = new ParticleSystem();
    public resources = new ResourceManager();
    public state = new StateManager();
    public userCommands = new UserCommandBuffer();
    public weapons = new WeaponSystem(this.world);
    public stage = new Stage();
    public skybox = new Skybox();

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
        DebugRenderUtils.setContext(this.gfxDevice, this.globalUniforms);
        this.onResize();

        // Initialize Modules
        this.resources.initialize(this.gfxDevice, this.sound);
        this.clock.initialize(this);
        this.input.initialize(this);
        this.net.initialize(this);
        this.cameraSystem.initialize(this);
        this.sound.initialize(this);
        this.compositor.initialize(this);
        this.globalUniforms.initialize();
        this.avatar.initialize(this);
        this.weapons.initialize(this);
        this.stage.initialize(this);
        this.environment.initialize(this);
        this.particles.initialize(this);
        this.skybox.initialize(this);
        this.debugGrid.initialize(this);
        this.state.initialize(this);
        
        // Events
        window.onresize = this.onResize.bind(this);
        document.onvisibilitychange = this.onVisibility.bind(this);
        window.onbeforeunload = this.onUnload.bind(this);

        if (!IS_DEVELOPMENT) {
            // Initialize Rollbar/Sentry for error reporting
        } else {
            // Show debug menu by default on development builds
            this.debugMenu.show();
        }

        window.requestAnimationFrame(this.tick.bind(this));

        return InitErrorCode.SUCCESS;
    }

    onConnect(serverId: string) {
        this.net.onConnect(serverId);
    }

    private tick(time: number) {
        this.clock.tick();
        
        this.updateFixed();
        this.update();
        this.render();

        this.input.afterFrame();

        this.debugMenu.update();

        window.requestAnimationFrame(this.tick.bind(this));
    }

    private updateFixed() {
        while (this.clock.updateFixed()) {
            this.input.updateFixed(this);

            // @TODO: Avatar prediction

            if (this.net.client.state === NetClientState.Active) {
                const cmd = assertDefined(this.userCommands.getUserCommand(this.clock.simFrame));
                this.net.client.transmitClientFrame(this.clock.simFrame, cmd);
            }
        }
    }

    private update() {
        // Interpolate the latest world state for rendering
        if (this.net.client.state === NetClientState.Active) {
            let displayFrameTime = this.clock.renderTime / this.clock.simDt;
            const valid = this.net.client.getSimState(displayFrameTime, this.displayFrame);
            if (valid) this.world.loadState(this.displayFrame);
        } else {
            // @HACK
            // this.displaySnapshot = baselineSnapshot;
        }

        this.net.update(this);
        this.resources.update();
        this.avatar.update(this);
        this.cameraSystem.update(this);
        this.sound.update(this);
        this.state.update(this);
        this.environment.update(this);
        this.particles.update(this);
        this.skybox.update(this);
        this.globalUniforms.update();
    }

    private render() {
        this.avatar.render(this);
        this.weapons.render(this);
        this.stage.render(this);
        this.particles.render(this);
        this.skybox.render(this);
        this.debugGrid.render(this);
        
        DebugRenderUtils.flush();

        this.compositor.render();
    };

    private onResize() {
        this.cameraSystem.resize(window.innerWidth / window.innerHeight);
        this.compositor.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    }

    private onVisibility() {
        const hidden = document.hidden;
        this.net.onVisibility(hidden);
    }

    private onUnload() {
        this.net.terminate();
    }
}