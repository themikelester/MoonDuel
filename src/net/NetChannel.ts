
import { WebUdpSocket, WebUdpEvent } from './WebUdp';
import { EventDispatcher } from '../EventDispatcher';
import { defined, defaultValue } from '../util';

export enum NetChannelEvent {
    Receive = "receive",
};

export interface AckInfo {
    tag: number;
    rttTime: number;
    sentTime: number;
    ackTime: number;
}

export class NetChannelStats {
    averageRtt: number = 0;
    packetLoss: number = 0;
    inKbps: number = 0;
    outKbps: number = 0;
}

type SequenceNumber = number;

interface PacketHeader {
    sequence: SequenceNumber;
    ack: SequenceNumber;
    ackBitfield: number;
}

interface Packet {
    header: PacketHeader;
    tag: number;
    size: number;

    ackTime?: number;
    sendTime: number;
    rcvdTime: number;
}

const kPacketHeaderSize = 8;
const kSequenceNumberDomain = 2 ** 16;
const kSequenceNumberDomainHalf = kSequenceNumberDomain / 2;
export const kPacketMaxPayloadSize = 1024;

const kPacketHistoryLength = 512; // Approximately 8 seconds worth of packets at 60hz
const kMaxRTT = 1000; // Maximum round-trip-time before a packet is considered lost

const scratchPacketBuffer = new Uint8Array(kPacketMaxPayloadSize + kPacketHeaderSize);
const scratchPacketDataView = new DataView(scratchPacketBuffer.buffer);

/**
 * High level class controlling communication with the server. Handles packet reliability, buffering, and ping measurement.
 * @NOTE: This needs to be kept in sync with its counterpart on the server side, Client.cpp/h
 */
export class NetChannel extends EventDispatcher {
    public stats = new NetChannelStats();

    private socket: WebUdpSocket;

    private remoteSequence = -1;
    private localSequence = 0;
    private localHistory: Packet[] = [];
    private remoteHistory: Packet[] = [];

    private latestAck = {} as { sequence?: number, info?: AckInfo };

    get isOpen() { return this.socket.isOpen; }
    get ping() { return this.stats.averageRtt > 0 ? this.stats.averageRtt : undefined; }

    initialize(socket: WebUdpSocket) {
        this.socket = socket;
        this.socket.on(WebUdpEvent.Message, (evt) => this.receive(evt.data));

        const emptyHeader = {
            sequence: -1,
            ack: -1,
            ackBitfield: 0,
        };

        const emptyPacket = {
            tag: 0,
            size: 0,
            sendTime: -1,
            rcvdTime: -1,
        };

        for (let i = 0; i < kPacketHistoryLength; i++) {
            this.localHistory[i] = { ...emptyPacket, header: { ...emptyHeader }};
            this.remoteHistory[i] = { ...emptyPacket,  header: { ...emptyHeader }};
        }
    }

    computeStats() {
        const now = performance.now();
        let ackd = 0;
        let lost = 0;
        let rttAccum = 0;
        let rttCount = 0;
        let rcvdSize = 0;
        let sentSize = 0;
        let oldestSentTime = Infinity;
        let oldestRcvdTime = Infinity;

        // Compute all stats over a moving window equal to the length of the packet history
        for (let i = 0; i < Math.min(this.localSequence, kPacketHistoryLength); i++) {
            const sequence = this.localSequence - i;
            const packet = this.localHistory[sequence % kPacketHistoryLength];
            const invalid = packet.header.sequence !== sequence; // Stale, an old packet from a previous sequence loop
            if (invalid) continue;

            const age = now - packet.sendTime;

            // @TODO: Account for dropped packets by analyzing local/remote sequence and throwing out packets that don't belong

            // Packet loss
            if (age > kMaxRTT) {
                if (defined(packet.ackTime)) { ackd += 1; }
                else { lost += 1; }
            }

            // Average RTT
            if (defined(packet.ackTime)) {
                rttAccum += packet.ackTime - packet.sendTime
                rttCount += 1;
            }

            // Out bandwidth
            sentSize += packet.size;
            oldestSentTime = Math.min(oldestSentTime, packet.sendTime);
        }

        // Compute all stats over a moving window equal to the length of the packet history
        for (let i = 0; i < Math.min(this.remoteSequence, kPacketHistoryLength); i++) {
            const sequence = this.remoteSequence - i;
            const packet = this.remoteHistory[sequence % kPacketHistoryLength];
            const invalid = packet.header.sequence !== sequence; // Stale, an old packet from a previous sequence loop
            if (invalid) continue;

            // In bandwidth
            rcvdSize += packet.size;
            oldestRcvdTime = Math.min(oldestRcvdTime, packet.rcvdTime);
        }

        this.stats.packetLoss = (lost + ackd) > 0 ? lost / (lost + ackd) : 0;
        this.stats.averageRtt = rttCount > 0 ? rttAccum / rttCount : 0;
        this.stats.outKbps = sentSize / (now - oldestSentTime) * 8;
        this.stats.inKbps = rcvdSize / (now - oldestRcvdTime) * 8;

        return this.stats;
    }

    /**
     * Construct a packet with the specified payload and send it to the server. 
     * @NOTE: The payload is copied, no reference to it needs (or should) be maintained outside of this function
     * @param payload The payload to include in the packet
     * @param tag A numeric identifier which will be passed to a future Receive event once this packet is acknowledged
     */
    send(payload: Uint8Array, tag?: number) {
        if (payload.length > kPacketMaxPayloadSize) {
            console.warn('NetChannel: Attempted to send packet that was too large for buffer. Ignoring.');
            return;
        }

        // Allocate the packet
        const packet = this.localHistory[this.localSequence % kPacketHistoryLength];
        packet.header.sequence = this.localSequence;
        packet.header.ack = this.remoteSequence;
        packet.header.ackBitfield = this.writeAckBitfield(this.remoteHistory);
        packet.tag = defaultValue(tag, this.localSequence);
        packet.sendTime = performance.now();
        packet.ackTime = undefined;
        packet.size = kPacketHeaderSize + payload.byteLength;

        // Transmit the data
        scratchPacketDataView.setUint16(0, packet.header.sequence, true);
        scratchPacketDataView.setUint16(2, packet.header.ack, true);
        scratchPacketDataView.setUint32(4, packet.header.ackBitfield, true);

        scratchPacketBuffer.set(payload, kPacketHeaderSize);
        this.socket.send(scratchPacketBuffer.subarray(0, packet.size));

        this.localSequence = sequenceNumberWrap(this.localSequence + 1);
    }

    /**
     * Process a packet that was received from the server. 
     * Fires NetChannelEvent.Receive with the packet payload for any interested listeners. 
     * @param data The raw data received from the WebUDP connection
     */
    private receive(data: ArrayBuffer) {
        const view = new DataView(data);
        const sequence = view.getUint16(0, true);

        // If this packet is newer than the latest packet we've received, update
        if (sequenceNumberGreaterThan(sequence, this.remoteSequence)) {
            this.remoteSequence = sequence;

            // Parse and buffer the packet 
            const packet = this.remoteHistory[sequence % kPacketHistoryLength];
            packet.header.sequence = view.getUint16(0, true);
            packet.header.ack = view.getUint16(2, true);
            packet.header.ackBitfield = view.getUint32(4, true);
            packet.size = data.byteLength;
            packet.rcvdTime = performance.now();

            if (!defined(packet)) {
                console.warn('NetChannel: Received packet that was too large for buffer. Ignoring.');
                return;
            }

            // Update the acknowledged state of all of the recently sent packets
            const bitfield = packet.header.ackBitfield;
            for (let i = 0; i < 32; i++) {
                if (bitfield & 1 << i) {
                    const sequence = sequenceNumberWrap(packet.header.ack - i);
                    const p = this.localHistory[sequence % kPacketHistoryLength];
                    if (p.header.sequence === sequence && !defined(p.ackTime)) {
                        this.acknowledge(p);
                    }
                }
            }

            const payload = new Uint8Array(data, kPacketHeaderSize);
            this.fire(NetChannelEvent.Receive, payload, this.latestAck.info);
        } else {
            // Ignore the packet
            console.debug('NetChannel: Ignoring stale packet with sequence number', sequence);
        }
    }

    private acknowledge(packet: Packet) {
        packet.ackTime = performance.now();

        const ackInfo = {
            tag: packet.tag,
            ackTime: packet.ackTime,
            sentTime: packet.sendTime,
            rttTime: packet.ackTime - packet.sendTime,
        };

        // Track the latest acknowledged packet
        if (!defined(this.latestAck.sequence) || sequenceNumberGreaterThan(packet.header.sequence, this.latestAck.sequence)) {
            this.latestAck.info = ackInfo;
            this.latestAck.sequence = packet.header.sequence;
        }
    }

    private writeAckBitfield(history: Packet[]) {
        let bitfield = 0;
        for (const packet of history) {
            if (packet.header.sequence !== -1) {
                const bit = sequenceNumberWrap(this.remoteSequence - packet.header.sequence);
                if (bit < 32) {
                    bitfield |= 1 << bit;
                }
            }
        }
        return bitfield;
    }
}

function sequenceNumberGreaterThan(a: SequenceNumber, b: SequenceNumber) {
    return ((a > b) && (a - b <= kSequenceNumberDomainHalf)) ||
        ((a < b) && (b - a > kSequenceNumberDomainHalf));
}

function sequenceNumberWrap(a: SequenceNumber) {
    return ((a % kSequenceNumberDomain) + kSequenceNumberDomain) % kSequenceNumberDomain;
}