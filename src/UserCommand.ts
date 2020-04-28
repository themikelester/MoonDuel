import { InputAction } from "./Input";
import { defined, assert } from "./util";

export class UserCommand {
    frame: number;
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
    
    static deserialize(dst: UserCommand, data: Uint8Array): number {
        const str = decoder.decode(data);
        Object.assign(dst, JSON.parse(str));
        return data.byteLength;
    }
}

const kEmptyCommand: UserCommand = {
    frame: -1,
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

    setUserCommand(cmd: UserCommand) {
        assert(Number.isInteger(cmd.frame));
        
        // Return false if a command has already been buffered for this frame
        const existingCmd = this.buffer[cmd.frame % this.bufferSize];
        if (defined(existingCmd) && existingCmd.frame === cmd.frame) {
            return false;
        }

        this.buffer[cmd.frame % this.bufferSize] = cmd;
        this.lastFrame = cmd.frame;
        return true;
    }

    getUserCommand(frame: number = this.lastFrame) {
        assert(Number.isInteger(frame));

        // If the latest frame is requested, and no command has ever been set, use the empty command
        if (frame === -1) return { ...kEmptyCommand, frame };

        const cmd = this.buffer[frame % this.bufferSize];

        if (!defined(cmd) || cmd.frame !== frame) { 
            // No command for this frame
            return undefined
        } else {
            return cmd;
        }
    }
}