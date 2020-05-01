import { defined, assert } from "../util";

export type SequenceNumber = number;

export const kPacketHeaderSize = 8;
export const kSequenceNumberDomain = 2 ** 16;
export const kSequenceNumberDomainHalf = kSequenceNumberDomain / 2;
export const kPacketMaxPayloadSize = 1024;
export const kPacketMaxReliablePayloadSize = 16;

interface PacketHeader {
    sequence: SequenceNumber;
    ack: SequenceNumber;
    ackBitfield: number;
}

export interface AckInfo {
    tag: number;
    rttTime: number;
    sentTime: number;
    ackTime: number;
}

export class Packet {
    header: PacketHeader;
    tag: number;
    size: number;

    reliableId?: number;

    ackTime?: number;
    sendTime: number;
    rcvdTime: number;

    get acknowledged() { return defined(this.ackTime); }

    constructor() {
        this.header = {
            sequence: -1,
            ack: -1,
            ackBitfield: 0,
        }
    }

    writeHeader(dataView: DataView) {
        dataView.setUint16(0, this.header.sequence, true);
        dataView.setUint16(2, this.header.ack, true);
        dataView.setUint32(4, this.header.ackBitfield, true);
    }

    readHeader(dataView: DataView) {
        this.header.sequence = dataView.getUint16(0, true);
        this.header.ack = dataView.getUint16(2, true);
        this.header.ackBitfield = dataView.getUint32(4, true);
    }

    acknowledge(): AckInfo {
        this.ackTime = performance.now();
        return {
            tag: this.tag,
            ackTime: this.ackTime,
            sentTime: this.sendTime,
            rttTime: this.ackTime - this.sendTime,
        }
    }
}

export function sequenceNumberGreaterThan(a: SequenceNumber, b: SequenceNumber) {
    return ((a > b) && (a - b <= kSequenceNumberDomainHalf)) ||
        ((a < b) && (b - a > kSequenceNumberDomainHalf));
}

export function sequenceNumberWrap(a: SequenceNumber) {
    return ((a % kSequenceNumberDomain) + kSequenceNumberDomain) % kSequenceNumberDomain;
}

export interface MsgBuf {
    data: Uint8Array;
    offset: number;
    allowOverflow: boolean;
    overflowed: boolean;

    // @HACK:
    dataView: DataView;
}

/**
 * Helper functions to ease serialization/deserialization. Based on the MSG structure from QuakeWorld. 
 * @see https://github.com/id-Software/Quake/blob/bf4ac424ce754894ac8f1dae6a3981954bc9852d/QW/client/common.c
 */
export namespace MsgBuf {
    export function create(buf: Uint8Array, allowOverflow: boolean = false): MsgBuf {
        return {
            data: buf,
            offset: 0,
            allowOverflow,
            overflowed: false,

            // @HACK:
            dataView: new DataView(buf.buffer, buf.byteOffset, buf.byteLength),
        }
    }

    export function alloc(buf: MsgBuf, byteLength: number): number {
        const offset = buf.offset;

        if ((buf.offset + byteLength) > buf.data.byteLength) {
            if (!buf.allowOverflow)
                throw new Error(`MsgBuf.alloc: Overflow without allowflow set (${buf.data.byteLength})`);

            if (byteLength > buf.data.byteLength)
                throw new Error(`MsgBuf.alloc: ${byteLength} > full buffer size`);

            console.warn('MsgBuf.alloc: Overflow');
            clear(buf);
            buf.overflowed = true;
        }

        buf.offset += byteLength;
        return offset;
    }

    export function clear(buf: MsgBuf) {
        buf.offset = 0;
        buf.overflowed = false;
        return buf;
    }
}

export namespace Msg {
    const kMaxInt = 2**31 - 1;
    const kMinInt = -(2**31);

    const kMaxShort = 2**15 - 1;
    const kMinShort = -(2**15);

    export function writeChar(buf: MsgBuf, c: number) {
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

        const offset = MsgBuf.alloc(buf, 1);
        buf.data[offset] = c;
    }

    export function writeByte(buf: MsgBuf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c)) 
                throw new Error('Msg.writeInt: type error');

            if (c < 0 || c > 255) 
                throw new Error('Msg.writeChar: range error');
        }

        const offset = MsgBuf.alloc(buf, 1);
        buf.data[offset] = c;
    }

    export function writeShort(buf: MsgBuf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c)) 
                throw new Error('Msg.writeInt: type error');

            if (c < kMinShort || c > kMaxShort) 
                throw new Error('Msg.writeInt: range error');
        }

        const offset = MsgBuf.alloc(buf, 2);
        buf.data[offset + 0] = (c >> 0) & 0xFF;
        buf.data[offset + 1] = (c >> 8) & 0xFF;
    }

    export function writeInt(buf: MsgBuf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c)) 
                throw new Error('Msg.writeInt: type error');

            if (c < kMinInt || c > kMaxInt) 
                throw new Error('Msg.writeInt: range error');
        }

        const offset = MsgBuf.alloc(buf, 4);
        buf.data[offset + 0] = (c >>  0) & 0xFF;
        buf.data[offset + 1] = (c >>  8) & 0xFF;
        buf.data[offset + 2] = (c >> 16) & 0xFF;
        buf.data[offset + 3] = (c >> 24) & 0xFF;
    }

    export function writeAngle16(buf: MsgBuf, angleRad: number) {
        writeShort(buf, Math.round(angleRad * 65536/(Math.PI * 2)))
    }

    // @HACK
    export function writeFloat(buf: MsgBuf, f: number) {
        const offset = MsgBuf.alloc(buf, 4);
        buf.dataView.setFloat32(offset, f, true);
    }

    // @HACK
    export function writeString(buf: MsgBuf, str: string) {
        assert(str.length < 256);
        Msg.writeByte(buf, str.length);
        for (let i = 0; i < str.length; i++) {
            Msg.writeByte(buf, str.charCodeAt(i));
        }
    }

    export function skip(buf: MsgBuf, c: number) {
        MsgBuf.alloc(buf, c);
    }

    export function readChar(buf: MsgBuf) {
        const offset = MsgBuf.alloc(buf, 1);
        const c = buf.data[offset];
        return (c >> 7) ? 0xFFFFFF00 | c : c;
    }

    export function readByte(buf: MsgBuf) {
        const offset = MsgBuf.alloc(buf, 1);
        return buf.data[offset];
    }

    export function readShort(buf: MsgBuf) {
        const offset = MsgBuf.alloc(buf, 2);
        const c = buf.data[offset] + (buf.data[offset + 1] << 8);
        return (c >> 15) ? 0xFFFF0000 | c : c;
    }

    export function readInt(buf: MsgBuf) {
        const offset = MsgBuf.alloc(buf, 4);
        let c = (buf.data[offset + 0])
              + (buf.data[offset + 1] << 8)
              + (buf.data[offset + 2] << 16)
              + (buf.data[offset + 3] << 24);
        return c;
    }

    export function readAngle16(buf: MsgBuf) {
        return readShort(buf) * (Math.PI * 2) / 65536;
    }

    // @HACK
    export function readFloat(buf: MsgBuf) {
        const offset = MsgBuf.alloc(buf, 4);
        return buf.dataView.getFloat32(offset, true);
    }

    // @HACK
    export function readString(buf: MsgBuf) {
        const strLen = Msg.readByte(buf);
        const str = String.fromCharCode.apply(null, buf.data.subarray(buf.offset, buf.offset + strLen));
        Msg.skip(buf, strLen);
        return str;
    }
}