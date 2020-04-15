import { DebugMenu } from "./DebugMenu";

const kDefaultStepDuration = 1000.0 / 60.0;

export class Clock {
    // All times are in milliseconds (ms)
    public dt: number = 0;
    public time: number = 0;
    public realDt: number = 0;
    public realTime: number = 0;
    public startTime: number = performance.now();

    public simFrame: number = 0; // The current frame index of the simulation
    public simAccum: number = 0; // The accumulated dt in frames, gets decremented each time the simulation is run
    public simStep: number = 20.0;

    public paused = false;
    public speed = 1.0;

    private stepDt = 0.0;

    initialize() {
        DebugMenu.add(this, 'paused');
        DebugMenu.add(this, 'speed', 0.05, 2.0, 0.05);
        DebugMenu.add(this, 'simStep', 8, 512, 8);
        DebugMenu.add(this, 'step');
    }

    update(time: number) {
        this.realDt = time - this.realTime;
        this.realTime = time;

        this.dt = this.paused ? this.stepDt : this.realDt * this.speed;
        this.time = this.time + this.dt;

        this.simAccum += this.dt / this.simStep;

        this.stepDt = 0.0
    }

    updateFixed() {
        this.simAccum -= 1.0;
        this.simFrame += 1;
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