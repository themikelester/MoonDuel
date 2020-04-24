import { Clock } from "./Clock";
import { AvatarState, AvatarSystemServer } from "./Avatar";
import { defined, assert } from "./util";
import { delerp } from "./MathHelpers";
import { DebugMenu } from "./DebugMenu";
import { NetModuleServer } from "./net/NetModule";

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
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function serialize(snap: Snapshot): Uint8Array {
    const str = JSON.stringify(snap);
    return encoder.encode(str);
}

function deserialize(data: Uint8Array): Snapshot {
    const str = decoder.decode(data);
    return JSON.parse(str);
}

interface Dependencies {
    clock: Clock;
}

export class SnapshotManager {
    public displaySnapshot = new Snapshot();

    private buffer: Snapshot[] = [];
    private latestFrame: number;

    private bufferFrameCount: number;

    initialize({ debugMenu }: { debugMenu: DebugMenu }) {
        this.bufferFrameCount = 5 * 64;

        const menu = debugMenu.addFolder('Snapshot');
        menu.add(this, 'bufferFrameCount', 64, 64 * 10, 64);
    }

    update(game: Dependencies) {
        let displaySnapshotTime = game.clock.renderTime / game.clock.simDt;
        const valid = this.getSnapshot(displaySnapshotTime, this.displaySnapshot);
    }

    updateFixed(deps: { clock: Clock, avatar: AvatarSystemServer }) {
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

    receive(msg: Uint8Array) {
        const snap = deserialize(msg);
        this.buffer[snap.frame % this.bufferFrameCount] = snap;
        this.latestFrame = snap.frame;
    }

    transmit({ net }: { net: NetModuleServer }) {
        // @HACK:
        const lastState = this.buffer[this.latestFrame % this.bufferFrameCount];
        const data = serialize(lastState);

        if (data.byteLength > 0) net.broadcast(data);
    }

    createSnapshot({ clock, avatar }: { clock: Clock, avatar: AvatarSystemServer }) {
        const lastSnapshot = this.buffer[this.latestFrame % this.bufferFrameCount];
        const snapshot = new Snapshot();
        if (lastSnapshot) Snapshot.copy(snapshot, lastSnapshot);

        snapshot.frame = clock.simFrame;
        snapshot.avatars = avatar.getSnapshot();

        return snapshot;
    }
}