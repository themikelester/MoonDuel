import { DebugMenu } from "./DebugMenu";

const kDefaultStepDuration = 1000.0 / 60.0;

export class Clock {
    // All times are in milliseconds (ms)
    public realTime: number = 0; // The time for the current display frame
    public simTime: number = 0; // The time for the current simulation frame, which is always behind real time
    public time: number = 0; // The scene time, which can be behind or ahead of the sim time due to dilation/contraction

    public realDt: number = 0;
    public _simDt: number = 20;
    public dt: number = 0;

    public simFrame: number = 0;

    public paused = false;
    public speed = 1.0;

    private platformTime = 0.0;
    private stepDt = 0.0;

    initialize() {
        DebugMenu.add(this, 'paused');
        DebugMenu.add(this, 'speed', 0.05, 2.0, 0.05);
        DebugMenu.add(this, 'simDt', 8, 512, 8);
        DebugMenu.add(this, 'step');
    }

    tick(platformTime: number) {
        const platformDt = platformTime - this.platformTime;
        this.platformTime = platformTime;

        this.realDt = platformDt;
        this.realTime += this.realDt;
        
        this.dt = this.paused ? this.stepDt : this.realDt * this.speed;
        this.time = this.time + this.dt;

        this.stepDt = 0.0
    }

    updateFixedLate() {
        this.simTime += this.simDt;
        this.simFrame += 1;
    }
    
    /**
     * If the fixed simulation timestep is modified, the times must be reset so that the simulation 
     * frame can always be accurately computed from the simulation time.
     */
    set simDt(value: number) {
        this.realTime = 0;
        this.simTime = 0;
        this.simFrame = 0;
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