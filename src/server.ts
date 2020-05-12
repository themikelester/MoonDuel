
import { GITHUB_REVISION_URL, IS_DEVELOPMENT} from './version';

// Modules
import { AvatarSystemServer } from './Avatar';
import { Clock } from './Clock';
import { NetModuleServer } from './net/NetModule';
import { ResourceManager } from './resources/ResourceLoading';
import { SnapshotManager, Snapshot } from './Snapshot';
import { UserCommandBuffer } from './UserCommand';
import { SignalSocket, SignalSocketEvents, ClientId } from './net/SignalSocket';
import { DebugMenu } from './DebugMenu';
import { World } from './World';

export const enum InitErrorCode {
    SUCCESS,
}

export class Server {
    public debugMenu: DebugMenu = new DebugMenu();
    public world = new World();

    // Modules
    public avatar = new AvatarSystemServer();
    public clock = new Clock();
    public net = new NetModuleServer();
    public resources = new ResourceManager();
    public snapshot = new SnapshotManager();
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
            this.avatar.updateFixed(this);
            const snap = this.snapshot.createSnapshot(this);
            this.snapshot.setSnapshot(snap);
            this.net.transmitToClients(snap);
        }

        if (tickCount !== 1) { console.warn('[Server] Uneven fixed frame tick:', tickCount); }
    }

    private update() {
    }

    private onUnload() {
        this.net.terminate();
    }
}