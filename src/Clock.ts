import { DebugMenu } from "./DebugMenu";
import { assert } from "./util";
import { clamp } from "./MathHelpers";

const kClientTimeWarpMax = 0.05; // The maximum percentage of regular speed at which clientTime can progress to reach its target.
                                 // I.e. if client time is behind its target, it increase X% faster than real time.
const kRenderTimeWarpMax = 0.25;

const kClientTimeSnapDelta = 250; // If the difference between clientTime and its target is greater than this (in ms), 
                                  // clientTime will snap to its target rather than warping to reach it smoothly. This
                                  // often occurs upon connection.
const kRenderTimeSnapDelta = 250;

export class Clock {
    // All times are in milliseconds (ms) and are updated each display frame
    public renderTime: number = 0; // The display time, which is when the the simulation state will be sampled and rendered. 
    public serverTime: number = 0; // The (best guess) simulation time of the server. This is always ahead of renderTime.
    public clientTime: number = 0; // The simulation time of the client.
    
    // Frame numbers are updated each simulation frame 
    public simFrame: number = 0; // The integer frame number of the current simulation frame

    // Time deltas are updated each display frame
    public realDt: number = 0;   // The actual CPU-time delta since last display frame
    public renderDt: number = 0; // The delta for renderTime, which is a modulated form of realDt (can be paused, slowed, sped up).
    public readonly simDt: number = 16; // The fixed time step of the simulation

    private realTime = 0.0;
    private clientDelay = 0.0;
    private renderDelay = 0.0;

    // Debug
    private paused = false;
    private speed = 1.0;
    private stepDt = 0.0;

    initialize({ debugMenu }: { debugMenu: DebugMenu }) {
        if (window.client?.debugMenu === debugMenu) {
            debugMenu.add(this, 'paused').onChange(() => { if (window.server) window.server.clock.paused = this.paused });
            debugMenu.add(this, 'speed', 0.05, 2.0, 0.05).onChange(() => { if (window.server) window.server.clock.speed = this.speed });
            debugMenu.add(this, 'step').onChange(() => { if (window.server) window.server.clock.step() });
        }
            
        this.zero();
    }

    zero() {
        this.serverTime = 0;
        this.clientTime = 0;
        this.renderTime = 0;
        this.simFrame = 0;
    }

    syncToServerTime(serverTime: number) {
        // Update all the timers, so that the next DT will be relative to this time
        this.tick();

        const serverTimeDelta = serverTime - this.serverTime;
        this.serverTime = serverTime;
        return serverTimeDelta;
    }

    setClientDelay(delayMs: number) {
        assert(delayMs <= 0, 'ClientDelay is expected to be negative');
        this.clientDelay = delayMs;
    }

    setRenderDelay(delayMs: number) {
        assert(delayMs >= 0, 'RenderDelay is expected to be positive');
        this.renderDelay = delayMs;
    }

    tick() {
        const time = performance.now();

        // Measure the real time since the last tick()
        this.realDt = time - this.realTime;
        this.realTime = time;

        this.realDt *= this.speed;
        if (this.paused) this.realDt = this.stepDt;

        // Server time
        this.serverTime += this.realDt;

        // Client time
        // If it is behind the target time, speed it up by 5%, otherwise slow it by 5%.
        // Unless the time delta is huge, in which case just snap to the target time.
        const targetClientTime = this.serverTime - this.clientDelay;
        const deltaClientTime = targetClientTime - this.clientTime;
        if (deltaClientTime > kClientTimeSnapDelta) {
            this.clientTime = targetClientTime;
            const clientFrame = this.clientTime / this.simDt;

            this.simFrame = Math.floor(clientFrame);
        } else {
            const minDt = this.realDt * (1 - kClientTimeWarpMax);
            const maxDt = this.realDt * (1 + kClientTimeWarpMax);

            const clientDt = clamp(deltaClientTime, minDt, maxDt);
            this.clientTime += clientDt;
        }

        // RenderTime
        // Similar logic to client time, but different values
        const targetRenderTime = this.serverTime - this.renderDelay;
        const deltaRenderTime = targetRenderTime - this.renderTime;
        if (deltaRenderTime > kRenderTimeSnapDelta) {
            this.renderTime = targetRenderTime
        } else {
            const minDt = this.realDt * (1 - kRenderTimeWarpMax);
            const maxDt = this.realDt * (1 + kRenderTimeWarpMax);
            
            this.renderDt = clamp(deltaRenderTime, minDt, maxDt);
            this.renderTime += this.renderDt;
        }

        this.stepDt = 0.0;
    }

    updateFixed() {
        const simAccum = this.clientTime - (this.simDt * this.simFrame);
        const shouldStep = simAccum >= this.simDt;

        if (shouldStep) {
            this.simFrame += 1;
        }

        return shouldStep;
    }

    /**
     * Get the server time as of RIGHT NOW, not as of last tick.
     */
    getCurrentServerTime() {
        const dt = performance.now() - this.realTime;
        return this.serverTime + dt;
    }

    /**
     * Pause the clock (if it isn't already), and step one frame the next time update() is called.
     * @param stepDurationMs The timestep for next frame (in milliseconds). Defaults to 16.6ms.
     * @note The current `speed` settings affects the timestep duration
     */
    step(stepDurationMs: number = this.simDt) {
        this.paused = true;

        // Step so that we simulate the next frame
        this.stepDt = stepDurationMs;
    }
}