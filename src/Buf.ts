import { assert, defined, assertDefined } from "./util";

/**
 * Helper functions to ease serialization/deserialization. Based on the MSG structure from QuakeWorld. 
 * @see https://github.com/id-Software/Quake/blob/bf4ac424ce754894ac8f1dae6a3981954bc9852d/QW/client/common.c
 */
export class Buf {
    data: Uint8Array;
    offset: number;

    // @HACK:
    dataView: DataView;

    constructor(data: Uint8Array) {
        this.data = data;
        this.offset = 0;
        this.dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    alloc(byteLength: number): number | null {
        const offset = this.offset;

        // If we would overflow, return -1 
        if ((this.offset + byteLength) > this.data.byteLength) {
            return null;
        }

        this.offset += byteLength;
        return offset;
    }

    write(data: Uint8Array) {
        const offset = this.alloc(data.byteLength);
        if (offset === null) return false;
        
        this.data.set(data, offset);
        return true;
    }

    clear() {
        this.offset = 0;
        return this;
    }

    finish() {
        const buf = this.data.subarray(0, this.offset);
        this.offset = 0;
        return buf;
    }
}

export namespace Buf {
    const kMaxInt = 2 ** 31 - 1;
    const kMinInt = -(2 ** 31);

    const kMaxShort = 2 ** 15 - 1;
    const kMinShort = -(2 ** 15);

    export function writeChar(buf: Buf, c: number) {
        // @TODO: Typescript declarations for an ENV struct, which would replace version.ts
        // @TODO: Separate ENV definitions for dev and prod
        // @NOTE: ENV variable are evaluated at compile time and will be excluded if false
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c))
                throw new Error('Msg.writeInt: type error');

            if (c < -128 || c > 127)
                throw new Error('Msg.writeChar: range error');
        }

        const offset = assertDefined(buf.alloc(1));
        buf.data[offset] = c;
        return offset;
    }

    export function writeByte(buf: Buf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c))
                throw new Error('Msg.writeInt: type error');

            if (c < 0 || c > 255)
                throw new Error('Msg.writeChar: range error');
        }

        const offset = assertDefined(buf.alloc(1));
        buf.data[offset] = c;
        return offset;
    }

    export function writeShort(buf: Buf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c))
                throw new Error('Msg.writeInt: type error');

            if (c < kMinShort || c > kMaxShort)
                throw new Error('Msg.writeInt: range error');
        }

        const offset = assertDefined(buf.alloc(2));
        buf.data[offset + 0] = (c >> 0) & 0xFF;
        buf.data[offset + 1] = (c >> 8) & 0xFF;
        return offset;
    }

    export function writeInt(buf: Buf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c))
                throw new Error('Msg.writeInt: type error');

            if (c < kMinInt || c > kMaxInt)
                throw new Error('Msg.writeInt: range error');
        }

        const offset = assertDefined(buf.alloc(4));
        buf.data[offset + 0] = (c >> 0) & 0xFF;
        buf.data[offset + 1] = (c >> 8) & 0xFF;
        buf.data[offset + 2] = (c >> 16) & 0xFF;
        buf.data[offset + 3] = (c >> 24) & 0xFF;
        return offset;
    }

    export function writeAngle16(buf: Buf, angleRad: number) {
        return writeShort(buf, Math.floor(angleRad * 65536 / (Math.PI * 2)));
    }

    // @HACK
    export function writeFloat(buf: Buf, f: number) {
        const offset = assertDefined(buf.alloc(4));
        buf.dataView.setFloat32(offset, f, true);
        return offset;
    }

    // @HACK
    export function writeString(buf: Buf, str: string) {
        assert(str.length < 256);
        const offset = Buf.writeByte(buf, str.length);
        for (let i = 0; i < str.length; i++) {
            Buf.writeByte(buf, str.charCodeAt(i));
        }
        return offset;
    }

    export function skip(buf: Buf, c: number) {
        const offset = assertDefined(buf.alloc(c));
        return offset;
    }

    export function readChar(buf: Buf) {
        const offset = assertDefined(buf.alloc(1));
        const c = buf.data[offset];
        return (c >> 7) ? 0xFFFFFF00 | c : c;
    }

    export function readByte(buf: Buf) {
        const offset = assertDefined(buf.alloc(1));
        return buf.data[offset];
    }

    export function peekByte(buf: Buf) {
        return buf.data[buf.offset];
    }

    export function readShort(buf: Buf) {
        const offset = assertDefined(buf.alloc(2));
        const c = buf.data[offset] + (buf.data[offset + 1] << 8);
        return (c >> 15) ? 0xFFFF0000 | c : c;
    }

    export function readInt(buf: Buf) {
        const offset = assertDefined(buf.alloc(4));
        let c = (buf.data[offset + 0])
            + (buf.data[offset + 1] << 8)
            + (buf.data[offset + 2] << 16)
            + (buf.data[offset + 3] << 24);
        return c;
    }

    export function readAngle16(buf: Buf) {
        return readShort(buf) * (Math.PI * 2) / 65536;
    }

    // @HACK
    export function readFloat(buf: Buf) {
        const offset = assertDefined(buf.alloc(4));
        return buf.dataView.getFloat32(offset, true);
    }

    // @HACK
    export function readString(buf: Buf) {
        const strLen = Buf.readByte(buf);
        const str = String.fromCharCode.apply(null, buf.data.subarray(buf.offset, buf.offset + strLen));
        Buf.skip(buf, strLen);
        return str;
    }
}