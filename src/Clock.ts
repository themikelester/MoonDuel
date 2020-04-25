import { DebugMenu } from "./DebugMenu";

const kDefaultStepDuration = 1000.0 / 60.0;

export class Clock {
    // All times are in milliseconds (ms)
    public realTime: number = 0; // The real CPU time for the current display frame
    public simTime: number = 0; // The time for the current simulation frame, which is always behind real time
    public renderTime: number = 0; // The display time, which is when the the simulation state will be sampled and rendered. 
                                   // @NOTE: This can be behind or ahead of the sim time due to dilation/contraction

    public serverTime: number = -1; // The estimated simulation time on the server. (If we are the server, same as simTime).

    public realDt: number = 0;
    public renderDt: number = 0;

    public simFrame: number = 0; // The integer frame number of the current simulation frame
    private _simDt: number = 16; // The fixed time step of the simulation
    private _renderTimeDelay: number = this.simDt * 2; // The initial delay between renderTime and realTime

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
        this._renderTimeDelay = Math.max(this._renderTimeDelay, this.simDt);
        this.realTime = 0;
        this.simTime = 0;
        this.simFrame = 0;
        this.renderTime = this.realTime - this._renderTimeDelay;
    }

    syncToServerTime(serverTime: number) {
        this.serverTime = serverTime;
        this.simTime = serverTime + 50.0; // @TODO: Need to set this somehow
        this.simFrame = this.simTime / this.simDt;
        this.renderTime = this.serverTime - this._renderTimeDelay;
    }

    tick(platformTime: number) {
        const platformDt = platformTime - this.platformTime;
        this.platformTime = platformTime;

        this.realDt = platformDt;
        this.realTime += this.realDt;

        // Keep server time in sync if it has been set
        if (this.serverTime !== -1) {
            this.serverTime += platformDt;
        }
        
        this.renderDt = this.paused ? this.stepDt : this.realDt * this.speed;
        this.renderTime = this.renderTime + this.renderDt;

        this.stepDt = 0.0
    }

    updateFixed() {
        this.simTime += this.simDt;
        this.simFrame += 1;
    }

    set renderTimeDelay(value: number) {
        this._renderTimeDelay = value;
        this.renderTime = this.realTime - this._renderTimeDelay;
    }

    get renderTimeDelay() {
        return this._renderTimeDelay;
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