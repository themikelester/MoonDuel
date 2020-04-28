import { DebugMenu } from "./DebugMenu";

const kDefaultStepDuration = 1000.0 / 60.0;

export class Clock {
    // All times are in milliseconds (ms) and are updated each display frame
    public renderTime: number = 0; // The display time, which is when the the simulation state will be sampled and rendered. 
    public serverTime: number = 0; // The (best guess) simulation time of the server. This is always ahead of renderTime.
    public clientTime: number = 0; // The simulation time of the client.
    
    // Frame numbers are updated each simulation frame 
    public simFrame: number = 0; // The integer frame number of the current simulation frame
    private _simDt: number = 16; // The fixed time step of the simulation

    public simAccum: number = 0;

    public realDt: number = 0;
    public renderDt: number = 0;

    private renderTimeDelay: number = 100; // The initial delay between renderTime and serverTime

    public paused = false;
    public speed = 1.0;

    private platformTime = 0.0;
    private stepDt = 0.0;

    initialize({ debugMenu }: { debugMenu: DebugMenu }) {
        debugMenu.add(this, 'paused');
        debugMenu.add(this, 'speed', 0.05, 2.0, 0.05);
        debugMenu.add(this, 'simDt', 8, 512, 8);
        debugMenu.add(this, 'step');
        debugMenu.add(this, 'renderTimeDelay', 0, 240, 8);
        this.zero();
    }

    zero() {
        this.renderTimeDelay = Math.max(this.renderTimeDelay, this.simDt);
        this.serverTime = 0;
        this.clientTime = 0;
        this.simFrame = 0;
    }

    syncToServerTime(serverTime: number, ping: number) {
        this.serverTime = serverTime;
        this.clientTime = serverTime + ping * 0.5 + this.simDt * 2.0; // @TODO: Need to set this somehow
        this.simFrame = this.clientTime / this.simDt;
        this.renderTimeDelay = ping * 0.5 + this.simDt * 2.0;
    }

    tick(platformTime: number) {
        const platformDt = platformTime - this.platformTime;
        this.platformTime = platformTime;

        this.realDt = platformDt;
        this.serverTime += this.realDt;
        
        this.renderDt = this.paused ? this.stepDt : this.realDt * this.speed;
        this.renderTime = this.serverTime - this.renderTimeDelay;

        this.simAccum += platformDt;

        this.stepDt = 0.0
    }

    updateFixed() {
        this.simAccum -= this.simDt;
        this.clientTime += this.simDt;
        this.simFrame += 1;
    }
    
    /**
     * If the fixed simulation timestep is modified, the times must be reset so that the simulation 
     * frame can always be accurately computed from the simulation time.
     */
    set simDt(value: number) {
        this.zero();
        this._simDt = value;
    }

    get simDt() {
        return this._simDt;
    }

    /**
     * Pause the clock (if it isn't already), and step one frame the next time update() is called.
     * @param stepDurationMs The timestep for next frame (in milliseconds). Defaults to 16.6ms.
     * @note The current `speed` settings affects the timestep duration
     */
    step(stepDurationMs: number = kDefaultStepDuration) {
        this.paused = true;
        this.stepDt = stepDurationMs * this.speed;
    }
}