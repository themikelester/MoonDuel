import { InputAction } from "./Input";

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
}