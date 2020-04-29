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

    get acknowledged() { return defined(this.ackTime); }

    private ackTime?: number;
    private sendTime: number;

    constructor() {
        this.header = {
            sequence: -1,
            ack: -1,
            ackBitfield: 0,
        }
    }

    fromBuffer(dataView: DataView): number {
        this.header.sequence = dataView.getUint16(0, true);
        this.header.ack = dataView.getUint16(2, true);
        this.header.ackBitfield = dataView.getUint32(4, true);
        return kPacketHeaderSize;
    }

    toBuffer(dataView:DataView): number {
        dataView.setUint16(0, this.header.sequence, true);
        dataView.setUint16(2, this.header.ack, true);
        dataView.setUint32(4, this.header.ackBitfield, true);
        
        // Assume we are transmitting the packet immediately, so mark it as unacknowledged
        this.sendTime = performance.now();
        this.ackTime = undefined;

        return kPacketHeaderSize;
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