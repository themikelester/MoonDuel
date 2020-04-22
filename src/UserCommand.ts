import { InputAction } from "./Input";
import { NetModuleClient } from "./net/NetModule";

export interface UserCommand {
    headingX: number;
    headingZ: number;
    verticalAxis: number;
    horizontalAxis: number;
    actions: InputAction;
};

const kEmptyCommand: UserCommand = {
    headingX: 0,
    headingZ: 1,
    verticalAxis: 0,
    horizontalAxis: 0,
    actions: 0,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function serialize(cmd: UserCommand): Uint8Array {
    // @TODO: Quantize on setUserCommand. Any prediction happening on the client should use a cmd that is equivalent to the one returned by serialize() and then deserialize()
    // @TODO: Much better compression
    const str = JSON.stringify(cmd);
    return encoder.encode(str);
}

function deserialize(data: Uint8Array): UserCommand {
    const str = decoder.decode(data);
    return JSON.parse(str);
}

export class UserCommandBuffer {
    private buffer: UserCommand[] = [];
    private bufferSize = 0;
    private lastFrame = 0;

    initialize() {
        // @TODO: Choose a real length, perhaps based on simDt?
        this.bufferSize = 64;
    }

    setUserCommand(frame: number, cmd: UserCommand) {
        this.buffer[frame % this.bufferSize] = cmd;
        this.lastFrame = frame;
    }

    getUserCommand(frame: number = this.lastFrame) {
        if (frame <= this.lastFrame - this.bufferSize || frame > this.lastFrame) {
            console.warn('Requested UserCommand outside of buffer');
            return kEmptyCommand;
        }

        return this.buffer[frame % this.bufferSize];
    }

    receive(msg: Uint8Array) {
        const cmd = deserialize(msg);
        console.log('Received command:', cmd);
    }

    /**
     * Send a buffer of user commands to the server
     */
    transmit({ net }: { net: NetModuleClient}) {
        // @HACK:
        const lastCommand = this.getUserCommand();
        const data = serialize(lastCommand);

        net.broadcast(data);
    }
}