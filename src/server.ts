
import { GITHUB_REVISION_URL, IS_DEVELOPMENT} from './version';

// Modules
import { AvatarSystem } from './Avatar';
import { Clock } from './Clock';
import { NetModule } from './net/NetModule';
import { ResourceManager } from './resources/ResourceLoading';
import { SnapshotManager } from './Snapshot';
import { UserCommandBuffer } from './UserCommand';

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL_GENERIC,
}

class Server {
    public headless: boolean = true;

    // Modules
    public avatar = new AvatarSystem();
    public clock = new Clock();
    public net = new NetModule();
    public resources = new ResourceManager();
    public snapshot = new SnapshotManager();
    public userCommands = new UserCommandBuffer();
    
    constructor() {
        this.init();
    }

    public async init() {
        console.log(`Source for this build available at ${GITHUB_REVISION_URL}`);

        // Initialize Modules
        this.resources.initialize();
        this.clock.initialize();
        this.net.initialize();
        this.avatar.initialize(this);
        this.snapshot.initialize();
        this.userCommands.initialize();

        if (!IS_DEVELOPMENT) {
            // Initialize Rollbar/Sentry for error reporting
        } else {
        }

        const kTickDelay = 16; // ms between calls to this.tick()
        setInterval(this.tick.bind(this), kTickDelay);

        return InitErrorCode.SUCCESS;
    }

    private tick(time: number) {
        this.clock.tick(time);

        this.updateFixed();
        this.update();
    }
    
    private updateFixed() {
        while ((this.clock.realTime - this.clock.simTime) >= this.clock.simDt) {
            this.clock.updateFixed();
            this.avatar.updateFixed(this);
            this.snapshot.updateFixed(this);
        }
    }

    private update() {
        this.net.update();  
        this.snapshot.update(this);  
        this.resources.update();
        this.avatar.update(this);
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

window.main = new Server();
