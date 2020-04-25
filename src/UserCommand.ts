import { InputAction } from "./Input";
import { NetModuleClient } from "./net/NetModule";

export class UserCommand {
    headingX: number;
    headingZ: number;
    verticalAxis: number;
    horizontalAxis: number;
    actions: InputAction;

    static serialize(dst: Uint8Array, cmd: UserCommand): number {
        // @TODO: Quantize on setUserCommand. Any prediction happening on the client should use a cmd that is equivalent to the one returned by serialize() and then deserialize()
        // @TODO: Much better compression
        const str = JSON.stringify(cmd);
        const buf = encoder.encode(str);
        dst.set(buf);
        return buf.byteLength;
    }
    
    static deserialize(data: Uint8Array): UserCommand {
        const str = decoder.decode(data);
        return JSON.parse(str);
    }
}

const kEmptyCommand: UserCommand = {
    headingX: 0,
    headingZ: 1,
    verticalAxis: 0,
    horizontalAxis: 0,
    actions: 0,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class UserCommandBuffer {
    private buffer: UserCommand[] = [];
    private bufferSize = 64; // @TODO: Choose a real length, perhaps based on simDt?
    private lastFrame = -1;

    setUserCommand(frame: number, cmd: UserCommand) {
        this.buffer[frame % this.bufferSize] = cmd;
        this.lastFrame = frame;
    }

    getUserCommand(frame: number = Math.max(0, this.lastFrame)) {
        if (frame <= this.lastFrame - this.bufferSize || frame > this.lastFrame) {
            console.warn('Requested UserCommand outside of buffer');
            return kEmptyCommand;
        }

        return this.buffer[frame % this.bufferSize];
    }
}