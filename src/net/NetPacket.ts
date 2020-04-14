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

    private ackTimestamp?: number;
    private recieveTimestamp?: number;
    private sendTimestamp?: number;

    private readonly dataView: DataView;
    private readonly bytes: Uint8Array;

    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
        this.dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    onAllocate() {
        this.header = {
            sequence: -1,
            ack: -1,
            ackBitfield: 0,
        }
        this.ackTimestamp = undefined;
        this.recieveTimestamp = undefined;
        this.sendTimestamp = undefined;
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

        this.recieveTimestamp = performance.now();

        return this;
    }

    toBuffer(): Nullable<Uint8Array> {
        if (this.payload.byteLength > kPacketMaxPayloadSize) {
            return null;
        }

        this.dataView.setUint16(0, this.header.sequence, true);
        this.dataView.setUint16(2, this.header.ack, true);
        this.dataView.setUint32(4, this.header.ackBitfield, true);
        this.bytes.set(this.payload, kPacketHeaderSize);

        this.sendTimestamp = performance.now();

        return this.bytes.subarray(0, kPacketHeaderSize + this.payload.byteLength);
    }

    isAcknowledged() { 
        return defined(this.ackTimestamp);
    }

    setAcknowledged() {
        this.ackTimestamp = performance.now();
    }

    getRTT() {
        if (defined(this.ackTimestamp) && defined(this.sendTimestamp)) {
            return this.ackTimestamp - this.sendTimestamp;
        }
        return 0;
    }
}

export class PacketBuffer implements Iterable<Packet> {
    private packets: Packet[];
    private buffer: ArrayBuffer;
    private readonly capacity: number;

    private writeHead: number = 0;
    private readHead: number = 0;
    private full: boolean = false;

    constructor(capacity: number) {
        this.capacity = capacity;

        const packetBufferSize = (kPacketHeaderSize + kPacketMaxPayloadSize);
        this.buffer = new ArrayBuffer(packetBufferSize * capacity);

        this.packets = [];
        for (let i = 0; i < capacity; i++) {
            this.packets[i] = new Packet(new Uint8Array(this.buffer, i * packetBufferSize, packetBufferSize));
        }
    }

    // To support for..of loops
    [Symbol.iterator](): Iterator<Packet> {
        class PacketBufferIterator implements Iterator<Packet> {
            index: number = 0;
            count: number;

            constructor(private buffer: PacketBuffer) {
                this.count = buffer.count();
            }

            next(): IteratorResult<Packet, any> {
                if (this.index >= this.count) { return { value: null, done: true }; }
                
                const i = (this.buffer.readHead + this.index) % this.buffer.capacity;
                this.index += 1;
                return { value: this.buffer.packets[i] };
            }
        }

        return new PacketBufferIterator(this);
    }

    allocate(): Packet {
        const packet = this.packets[this.writeHead];
        packet.onAllocate();

        if (this.full) {
            this.readHead = (this.readHead + 1) % this.capacity;
        }
        this.writeHead = (this.writeHead + 1) % this.capacity;
        this.full = this.writeHead === this.readHead;

        return packet;
    }

    get(index: number) {
        assert(!this.isEmpty());
        const i = (this.readHead + index) % this.capacity;
        return this.packets[i];
    }

    isEmpty() {
        return (!this.full && (this.readHead == this.writeHead));
    }

    isFull() {
        return this.full;
    }

    count() {
        let count = this.capacity;
        if (!this.full) {
            if (this.writeHead >= this.readHead) {
                count = this.writeHead - this.readHead;
            }
            else {
                count = this.capacity + this.writeHead - this.readHead;
            }
        }
        return count;
    }
}

export function sequenceNumberGreaterThan(a: SequenceNumber, b: SequenceNumber) {
    return ((a > b) && (a - b <= 32768)) ||
        ((a < b) && (b - a > 32768));
}

export function sequenceNumberWrap(a: SequenceNumber) {
    return a % 65536;
}