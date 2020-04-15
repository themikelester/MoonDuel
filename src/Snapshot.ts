import { Clock } from "./Clock";
import { AvatarState, AvatarSystem } from "./Avatar";
import { DebugMenu } from "./DebugMenu";
import { defined } from "./util";

class Snapshot {
    avatar: AvatarState = new AvatarState();
}

interface Dependencies {
    clock: Clock;
    avatar: AvatarSystem;
}

export class SnapshotManager {
    snapshot: Snapshot = new Snapshot;

    private buffer: Snapshot[] = [];
    private bufferLength: number = Infinity;

    recordDuration = 5;
    private recordIndex?: number;
    private playIndex?: number;

    initialize() {
        const menu = DebugMenu.addFolder('Snapshot');
        menu.add(this, 'recordDuration', 1, 15);
        menu.add(this, 'record');
        menu.add(this, 'playback', 1, 15);
    }

    record() {
        this.recordIndex = 0;
        setTimeout(() => {
            delete this.recordIndex;
            console.log(this.buffer);
        }, this.recordDuration * 1000.0)
    }

    playback() {
        this.playIndex = 0;
    }

    updateFixed(deps: Dependencies) {
        this.snapshot = this.createSnapshot(deps);
        
        if (defined(this.recordIndex)) {
            this.buffer[this.recordIndex++] = this.snapshot;
        }

        if (defined(this.playIndex)) {
            this.snapshot = this.buffer[this.playIndex];

            this.playIndex += 1;
            if (this.playIndex >= this.buffer.length) {
                delete this.playIndex;
            }
        }
    }

    createSnapshot(deps: Dependencies) {
        const snapshot: Snapshot = {
            avatar: deps.avatar.getSnapshot(),
        }
        return snapshot;
    }
}