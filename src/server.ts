
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

export const enum InitErrorCode {
    SUCCESS,
}

export class Server {
    public debugMenu: DebugMenu = new DebugMenu();

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
        const time = performance.now();
        this.clock.tick(time);

        this.updateFixed();
        this.update();
    }
    
    private updateFixed() {
        while (this.clock.updateFixed()) {
            this.avatar.updateFixed(this);
            const snap = this.snapshot.createSnapshot(this);
            this.snapshot.setSnapshot(snap);
            this.net.transmitToClients(snap);
        }
    }

    private update() {
    }

    private onUnload() {
        this.net.terminate();
    }
}