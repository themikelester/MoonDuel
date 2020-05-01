import { InputAction } from "./Input";
import { defined, assert } from "./util";
import { Buf } from "./Buf";

export class UserCommand {
    frame: number; // Not transmitted 
    headingX: number; // Heading encoded as 16-bit angle
    headingZ: number;
    verticalAxis: number; // 2 bits (1, 0, -1)
    horizontalAxis: number; // 2 bits (1, 0, -1)
    actions: InputAction; // X bits

    static serialize(buf: Buf, cmd: UserCommand): number {
        // @TODO: Quantize on setUserCommand. Any prediction happening on the client should use a cmd that is equivalent to the one returned by serialize() and then deserialize()
        const heading = Math.atan2(cmd.headingZ, cmd.headingX);
        Buf.writeAngle16(buf, heading);
        
        let bits = 0;
        bits |= 0b00000011 & ((Math.sign(cmd.verticalAxis) + 1) << 0);
        bits |= 0b00001100 & ((Math.sign(cmd.horizontalAxis) + 1) << 2);
        bits |= 0b11110000 & (Math.sign(cmd.actions) << 4);
        Buf.writeByte(buf, bits);

        return 3;
    }
    
    static deserialize(dst: UserCommand, buf: Buf): number {
        const heading = Buf.readAngle16(buf);
        dst.headingX = Math.cos(heading);
        dst.headingZ = Math.sin(heading);
        
        let bits = Buf.readByte(buf);
        dst.verticalAxis   = ((bits & 0b00000011) >> 0) - 1;
        dst.horizontalAxis = ((bits & 0b00001100) >> 2) - 1;
        dst.actions        = (bits & 0b11110000) >> 4;

        return 3;
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