import { Clock } from "./Clock";
import { AvatarState, AvatarSystem } from "./Avatar";
import { DebugMenu } from "./DebugMenu";
import { defined, assert } from "./util";
import { delerp } from "./MathHelpers";

export class Snapshot {
    frame: number;
    avatar: AvatarState = new AvatarState();

    static lerp(a: Snapshot, b: Snapshot, t: number, result: Snapshot) {
        AvatarState.lerp(a.avatar, b.avatar, t, result.avatar);
        return result;
    }
}

interface Dependencies {
    clock: Clock;
    avatar: AvatarSystem;
}

export class SnapshotManager {
    public displaySnapshot = new Snapshot();

    private buffer: Snapshot[] = [];
    private latestFrame: number;

    private bufferFrameCount: number;
    private interpolationDelaySec: number = 0.032;

    initialize() {
        this.bufferFrameCount = 5 * 64;

        const menu = DebugMenu.addFolder('Snapshot');
        menu.add(this, 'bufferFrameCount', 64, 64 * 10, 64);
        menu.add(this, 'interpolationDelaySec', 0, 0.240, 0.008);
    }

    update(game: Dependencies) {
        let displaySnapshotTime = game.clock.simFrame - 1.0 + game.clock.simAccum - (this.interpolationDelaySec * 1000.0 / game.clock.simStep);
        const valid = this.getSnapshot(displaySnapshotTime, this.displaySnapshot);
    }

    updateFixed(deps: Dependencies) {
        this.buffer[deps.clock.simFrame % this.bufferFrameCount] = this.createSnapshot(deps);
        this.latestFrame = deps.clock.simFrame;
    }

    getSnapshot(simTime: number, result: Snapshot): boolean {
        const oldestFrame = Math.max(0, this.latestFrame - this.bufferFrameCount - 1);
        if (simTime < oldestFrame) {
            console.warn('Requested snapshot older than buffer length')
            return false;
        }

        // Find the first snapshot BEFORE the requested time
        let aFrame = Math.floor(simTime);
        while (aFrame >= oldestFrame && !defined(this.buffer[aFrame % this.bufferFrameCount])) { aFrame -= 1; };

        // Find the first snapshot AFTER the requested time
        let bFrame = Math.ceil(simTime);
        while (bFrame <= this.latestFrame && !defined(this.buffer[bFrame % this.bufferFrameCount])) { bFrame -= 1; };

        const aValid = aFrame >= oldestFrame;
        const bValid = bFrame <= this.latestFrame;
        const a = this.buffer[aFrame % this.bufferFrameCount];
        const b = this.buffer[bFrame % this.bufferFrameCount];

        if (aValid && !bValid) {
            // Extrapolate snapshot for t1 based on t0-1 and t0;
            console.warn('Extrapolation not yet implemented')
            return false;
        } else if (!aValid && bValid) {
            // Inverse extrapolate snapshot for t0 based on t1 and t1+1;
            console.warn('Extrapolation not yet implemented')
            return false;
        } else if (!aValid && !bValid) {
            // No valid snapshots on either side
            console.warn('No valid snapshot for this frame');
            return false;
        } else {
            // Interpolate
            const t = delerp(aFrame, bFrame, simTime);
            Snapshot.lerp(a, b, t, result);
            return true;
        }
    }

    createSnapshot(deps: Dependencies) {
        const snapshot: Snapshot = {
            frame: deps.clock.simFrame,
            avatar: deps.avatar.getSnapshot(),
        }
        return snapshot;
    }
}