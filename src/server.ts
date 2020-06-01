
import { GITHUB_REVISION_URL, IS_DEVELOPMENT} from './version';

// Modules
import { AvatarSystemServer } from './Avatar';
import { Clock } from './Clock';
import { NetModuleServer } from './net/NetModule';
import { ResourceManager } from './resources/ResourceLoading';
import { UserCommandBuffer } from './UserCommand';
import { SignalSocket, SignalSocketEvents, ClientId } from './net/SignalSocket';
import { DebugMenu } from './DebugMenu';
import { SimStream, World } from './World';
import { WeaponSystem } from './Weapon';
import { CollisionSystem, StaticCollisionSystem } from './Collision';

export const enum InitErrorCode {
    SUCCESS,
}

export class Server {
    public debugMenu: DebugMenu = new DebugMenu();
    public world = new World();
    public collision = new CollisionSystem();
    public staticCollision = new StaticCollisionSystem();

    // Modules
    public avatar = new AvatarSystemServer();
    public weapon = new WeaponSystem(this.world);
    public clock = new Clock();
    public net = new NetModuleServer();
    public resources = new ResourceManager();
    public userCommands = new UserCommandBuffer();
    
    constructor() {
        this.init();
    }

    public async init() {
        console.log(`Source for this build available at ${GITHUB_REVISION_URL}`);
        
        // Events
        window.onbeforeunload = this.onUnload.bind(this);

        // Initialize Modules
        this.resources.initialize();
        this.clock.initialize(this);
        this.net.initialize(this);
        this.avatar.initialize(this);
        this.weapon.initialize(this);

        // @HACK:
        this.staticCollision.setStageRadius(2000);

        if (!IS_DEVELOPMENT) {
            // Initialize Rollbar/Sentry for error reporting
        } else {
        }

        const kTickDelay = 16; // ms between calls to this.tick()
        setInterval(this.tick.bind(this), kTickDelay);

        return InitErrorCode.SUCCESS;
    }

    onConnect(signalSocket: SignalSocket) {
        this.net.onConnect(signalSocket);
    }

    private tick() {
        this.clock.tick();

        this.updateFixed();
        this.update();
    }
    
    private updateFixed() {
        let tickCount = 0;
        while (this.clock.updateFixed()) {
            tickCount += 1;

            this.collision.clear();

            this.avatar.updateFixed(this);
            this.weapon.updateFixed(this);

            this.avatar.updateFixedLate(this);

            this.world.captureState(this.clock.simFrame);
            this.net.transmitToClients(this.clock.simFrame);
        }

        if (tickCount !== 1) { console.warn('[Server] Uneven fixed frame tick:', tickCount); }
    }

    private update() {
        this.resources.update();
        // this.collision.debugRender();
    }

    private onUnload() {
        this.net.terminate();
    }
}