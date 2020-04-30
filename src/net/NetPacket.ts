import { defined } from "../util";

export type SequenceNumber = number;

export const kPacketHeaderSize = 8;
export const kSequenceNumberDomain = 2 ** 16;
export const kSequenceNumberDomainHalf = kSequenceNumberDomain / 2;
export const kPacketMaxPayloadSize = 1024;

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

    get acknowledged() { return defined(this.ackTime); }

    ackTime?: number;
    sendTime: number;
    rcvdTime: number;

    constructor() {
        this.header = {
            sequence: -1,
            ack: -1,
            ackBitfield: 0,
        }
    }

    fromBuffer(buffer: ArrayBuffer, dataView: DataView): number {
        this.header.sequence = dataView.getUint16(0, true);
        this.header.ack = dataView.getUint16(2, true);
        this.header.ackBitfield = dataView.getUint32(4, true);

        this.size = buffer.byteLength;

        // Assume we just received this packet
        this.rcvdTime = performance.now();

        return kPacketHeaderSize;
    }

    toBuffer(buffer: Uint8Array, dataView: DataView, payload: Uint8Array): number {
        dataView.setUint16(0, this.header.sequence, true);
        dataView.setUint16(2, this.header.ack, true);
        dataView.setUint32(4, this.header.ackBitfield, true);
        buffer.set(payload, kPacketHeaderSize);

        // Assume we are transmitting the packet immediately, so mark it as unacknowledged
        this.sendTime = performance.now();
        this.ackTime = undefined;

        this.size = payload.byteLength + kPacketHeaderSize;
        return this.size;
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

export interface SizeBuf {
    data: Uint8Array;
    offset: number;
    allowOverflow: boolean;
    overflowed: boolean;
}

/**
 * Helper functions to ease serialization/deserialization. Based on the MSG structure from QuakeWorld. 
 * @see https://github.com/id-Software/Quake/blob/bf4ac424ce754894ac8f1dae6a3981954bc9852d/QW/client/common.c
 */
export namespace SizeBuf {
    export function create(buf: Uint8Array, allowOverflow: boolean = false): SizeBuf {
        return {
            data: buf,
            offset: 0,
            allowOverflow,
            overflowed: false,
        }
    }

    export function alloc(buf: SizeBuf, byteLength: number): number {
        const offset = buf.offset;

        if ((buf.offset + byteLength) > buf.data.byteLength) {
            if (!buf.allowOverflow)
                throw new Error(`SizeBuf.alloc: Overflow without allowflow set (${buf.data.byteLength})`);

            if (byteLength > buf.data.byteLength)
                throw new Error(`SizeBuf.alloc: ${byteLength} > full buffer size`);

            console.warn('SizeBuf.alloc: Overflow');
            clear(buf);
            buf.overflowed = true;
        }

        buf.offset += byteLength;
        return offset;
    }

    export function clear(buf: SizeBuf) {
        buf.offset = 0;
        buf.overflowed = false;
    }
}

export namespace Msg {
    const kMaxInt = 2**31 - 1;
    const kMinInt = -(2**31);

    const kMaxShort = 2**15 - 1;
    const kMinShort = -(2**15);

    const kMaxUint = 2**32 - 1;
    const kMaxUshort = 2**16 - 1;

    export function writeChar(buf: SizeBuf, c: number) {
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

        const offset = SizeBuf.alloc(buf, 1);
        buf.data[offset] = c;
    }

    export function writeShort(buf: SizeBuf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c)) 
                throw new Error('Msg.writeInt: type error');

            if (c < kMinShort || c > kMaxShort) 
                throw new Error('Msg.writeInt: range error');
        }

        const offset = SizeBuf.alloc(buf, 2);
        buf.data[offset + 0] = (c >> 0) & 0xFF;
        buf.data[offset + 1] = (c >> 8) & 0xFF;
    }

    export function writeInt(buf: SizeBuf, c: number) {
        //@ts-ignore
        if (ENV.PARANOID) {
            if (!Number.isInteger(c)) 
                throw new Error('Msg.writeInt: type error');

            if (c < kMinInt || c > kMaxInt) 
                throw new Error('Msg.writeInt: range error');
        }

        const offset = SizeBuf.alloc(buf, 4);
        buf.data[offset + 0] = (c >>  0) & 0xFF;
        buf.data[offset + 1] = (c >>  8) & 0xFF;
        buf.data[offset + 2] = (c >> 16) & 0xFF;
        buf.data[offset + 3] = (c >> 24) & 0xFF;
    }

    export function skip(buf: SizeBuf, c: number) {
        SizeBuf.alloc(buf, c);
    }

    export function readChar(buf: SizeBuf) {
        const offset = SizeBuf.alloc(buf, 1);
        const c = buf.data[offset];
        return (c >> 7) ? 0xFFFFFF00 | c : c;
    }

    export function readByte(buf: SizeBuf) {
        const offset = SizeBuf.alloc(buf, 1);
        return buf.data[offset];
    }

    export function readShort(buf: SizeBuf) {
        const offset = SizeBuf.alloc(buf, 2);
        const c = buf.data[offset] + (buf.data[offset + 1] << 8);
        return (c >> 15) ? 0xFFFF0000 | c : c;
    }

    export function readInt(buf: SizeBuf) {
        const offset = SizeBuf.alloc(buf, 4);
        let c = (buf.data[offset + 0])
              + (buf.data[offset + 1] << 8)
              + (buf.data[offset + 2] << 16)
              + (buf.data[offset + 3] << 24);
        return c;
    }
}