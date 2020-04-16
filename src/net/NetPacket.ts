import { assert, defined } from "../util";

export type SequenceNumber = number;

const kPacketHeaderSize = 8;
export const kPacketMaxPayloadSize = 1024;

interface PacketHeader {
    sequence: SequenceNumber;
    ack: SequenceNumber;
    ackBitfield: number;
}

export class Packet {
    header: PacketHeader;
    payload: Uint8Array;

    private readonly dataView: DataView;
    private readonly bytes: Uint8Array;

    constructor(bytes: Uint8Array) {
        this.header = {
            sequence: -1,
            ack: -1,
            ackBitfield: 0,
        }
        this.bytes = bytes;
        this.dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    fromBuffer(buffer: ArrayBuffer): Nullable<this> {
        if (buffer.byteLength > this.bytes.byteLength) {
            return null;
        }
        
        this.bytes.set(new Uint8Array(buffer));

        this.header.sequence = this.dataView.getUint16(0, true);
        this.header.ack = this.dataView.getUint16(2, true);
        this.header.ackBitfield = this.dataView.getUint32(4, true);
        this.payload = this.bytes.subarray(kPacketHeaderSize, buffer.byteLength);

        return this;
    }

    toBuffer(): Uint8Array {
        assert(this.payload.byteLength <= kPacketMaxPayloadSize);

        this.dataView.setUint16(0, this.header.sequence, true);
        this.dataView.setUint16(2, this.header.ack, true);
        this.dataView.setUint32(4, this.header.ackBitfield, true);
        this.bytes.set(this.payload, kPacketHeaderSize);

        return this.bytes.subarray(0, kPacketHeaderSize + this.payload.byteLength);
    }
}

export class PacketBuffer {
    public packets: Packet[];
    private buffer: ArrayBuffer;
    private readonly capacity: number;

    constructor(capacity: number) {
        this.capacity = capacity;

        const packetBufferSize = (kPacketHeaderSize + kPacketMaxPayloadSize);
        this.buffer = new ArrayBuffer(packetBufferSize * capacity);

        this.packets = [];
        for (let i = 0; i < capacity; i++) {
            this.packets[i] = new Packet(new Uint8Array(this.buffer, i * packetBufferSize, packetBufferSize));
        }
    }
}

export function sequenceNumberGreaterThan(a: SequenceNumber, b: SequenceNumber) {
    return ((a > b) && (a - b <= 32768)) ||
        ((a < b) && (b - a > 32768));
}

export function sequenceNumberWrap(a: SequenceNumber) {
    return a % 65536;
}