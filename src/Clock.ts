import { DebugMenu } from "./DebugMenu";

const kDefaultStepDuration = 1000.0 / 60.0;

export class Clock {
    // All times are in milliseconds (ms)
    public realTime: number = 0; // The real CPU time for the current display frame. May be synced with the server.
    public simTime: number = 0; // The time for the current simulation frame. This should always be ahead of renderTime.
    public renderTime: number = 0; // The display time, which is when the the simulation state will be sampled and rendered. 

    public simAccum: number = 0;

    public realDt: number = 0;
    public renderDt: number = 0;

    public simFrame: number = 0; // The integer frame number of the current simulation frame
    private _simDt: number = 16; // The fixed time step of the simulation
    private renderTimeDelay: number = 100; // The initial delay between renderTime and realTime

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
        this.realTime = 0;
        this.simTime = 0;
        this.simFrame = 0;
    }

    syncToServerTime(serverTime: number, ping: number) {
        this.realTime = serverTime;
        this.simTime = serverTime + ping * 0.5 + this.simDt * 2.0; // @TODO: Need to set this somehow
        this.simFrame = this.simTime / this.simDt;
        this.renderTimeDelay = ping * 0.5 + this.simDt * 2.0;
    }

    tick(platformTime: number) {
        const platformDt = platformTime - this.platformTime;
        this.platformTime = platformTime;

        this.realDt = platformDt;
        this.realTime += this.realDt;
        
        this.renderDt = this.paused ? this.stepDt : this.realDt * this.speed;
        this.renderTime = this.realTime - this.renderTimeDelay;

        this.simAccum += platformDt;

        this.stepDt = 0.0
    }

    updateFixed() {
        this.simAccum -= this.simDt;
        this.simTime += this.simDt;
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