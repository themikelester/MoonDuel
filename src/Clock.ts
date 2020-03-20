import { DebugMenu } from "./DebugMenu";

export class Clock {
    public dt: number = 0;
    public time: number = 0;
    public realDt: number = 0;
    public realTime: number = 0;

    public paused = false;
    public speed = 1.0;

    initialize() {
        DebugMenu.add(this, 'paused');
        DebugMenu.add(this, 'speed', 0.001, 8.0);
    }

    update(time: number) {
        this.realDt = time - this.realTime;
        this.realTime = time;

        this.dt = this.paused ? 0.0 : this.realDt * this.speed;
        this.time = this.time + this.dt;
    }
}