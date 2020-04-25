import { Clock } from "./Clock";
import { AvatarState, AvatarSystemServer } from "./Avatar";
import { defined, assert } from "./util";
import { delerp } from "./MathHelpers";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Snapshot {
    frame: number;

    static kAvatarCount = 3;
    avatars: AvatarState[] = [];

    constructor() {
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            this.avatars[i] = new AvatarState();
        }
    }

    static lerp(result: Snapshot, a: Snapshot, b: Snapshot, t: number) {
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            AvatarState.lerp(result.avatars[i], a.avatars[i], b.avatars[i], t);
        }
        return result;
    }

    static copy(result: Snapshot, a: Snapshot) {
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            AvatarState.copy(result.avatars[i], a.avatars[i]);
        }
        return result;
    }

    static serialize(dst: Uint8Array, snap: Snapshot): number {
        // @HACK
        const str = JSON.stringify(snap);
        const buf = encoder.encode(str);
        dst.set(buf);
        return buf.byteLength;
    }
    
    static deserialize(data: Uint8Array): Snapshot {
        // @HACK
        const str = decoder.decode(data);
        return JSON.parse(str);
    }
}

export class SnapshotManager {
    private buffer: Snapshot[] = [];
    private latestFrame: number = -1;

    private bufferFrameCount: number = 64;

    setSnapshot(snap: Snapshot) {
        assert(snap.frame > (this.latestFrame - this.bufferFrameCount));
        this.buffer[snap.frame % this.bufferFrameCount] = snap;
        this.latestFrame = Math.max(this.latestFrame, snap.frame);
    }

    getSnapshot(simFrame: number = this.latestFrame) {
        assert(simFrame > (this.latestFrame - this.bufferFrameCount));
        return this.buffer[simFrame % this.bufferFrameCount];
    }

    lerpSnapshot(simTime: number, result: Snapshot): boolean {
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
            if (a === b) {
                Snapshot.copy(result, a);
                return true;
            }

            // Interpolate
            const t = delerp(aFrame, bFrame, simTime);
            Snapshot.lerp(result, a, b, t);
            return true;
        }
    }

    /**
     * Sample all necessary systems to create a new snapshot of the current state of the world
     */
    createSnapshot({ clock, avatar }: { clock: Clock, avatar: AvatarSystemServer }) {
        const lastSnapshot = this.buffer[this.latestFrame % this.bufferFrameCount];
        const snapshot = new Snapshot();
        if (lastSnapshot) Snapshot.copy(snapshot, lastSnapshot);

        snapshot.frame = clock.simFrame;
        snapshot.avatars = avatar.getSnapshot();

        return snapshot;
    }
}