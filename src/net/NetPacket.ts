import { assert, defined } from "../util";

export type SequenceNumber = number;

export const kPacketHeaderSize = 8;
export const kSequenceNumberDomain = 2**16;
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