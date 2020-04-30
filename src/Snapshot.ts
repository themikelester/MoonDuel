import { Clock } from "./Clock";
import { AvatarState, AvatarSystemServer } from "./Avatar";
import { defined, assert } from "./util";
import { delerp } from "./MathHelpers";
import { MsgBuf, Msg } from "./net/NetPacket";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Snapshot {
    frame: number;

    static kAvatarCount = 6;
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

    static serialize(buf: MsgBuf, snap: Snapshot) {
        Msg.writeInt(buf, snap.frame);
        for (let i = 0; i < this.kAvatarCount; i++) {
            AvatarState.serialize(buf, snap.avatars[i]);
        }
    }

    static deserialize(buf: MsgBuf, snap: Snapshot) {
        snap.frame = Msg.readInt(buf);
        for (let i = 0; i < this.kAvatarCount; i++) {
            AvatarState.deserialize(buf, snap.avatars[i]);
        }
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
        while (aFrame >= oldestFrame && this.buffer[aFrame % this.bufferFrameCount]?.frame !== aFrame) { aFrame -= 1; };

        // Find the first snapshot AFTER the requested time
        let bFrame = Math.ceil(simTime);
        while (bFrame <= this.latestFrame && this.buffer[bFrame % this.bufferFrameCount]?.frame !== bFrame) { bFrame += 1; };

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