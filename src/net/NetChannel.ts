
import { WebUdpSocket, WebUdpEvent } from './WebUdp';
import { sequenceNumberGreaterThan, sequenceNumberWrap, Packet, kPacketMaxPayloadSize, AckInfo, kPacketHeaderSize } from './NetPacket';
import { EventDispatcher } from '../EventDispatcher';
import { defined, defaultValue } from '../util';
import { clamp } from '../MathHelpers';

export enum NetChannelEvent {
    Receive = "receive",
};

const kPacketHistoryLength = 512; // Approximately 8 seconds worth of packets at 60hz
const kMaxRTT = 1000; // Maximum round-trip-time before a packet is considered lost

const scratchPacketBuffer = new Uint8Array(kPacketMaxPayloadSize + kPacketHeaderSize);
const scratchPacketDataView = new DataView(scratchPacketBuffer.buffer);

export class NetChannelStats {
    averageRtt: number = 0; 
    packetLoss: number = 0;
    inKbps: number = 0;
    outKbps: number = 0;
}

interface ReliablePayload {
    payload: Uint8Array;
    tag?: number
}

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

    private reliableBuf: ReliablePayload[] = [];

    private latestAck = {} as { sequence?: number, info?: AckInfo };

    get isOpen() { return this.socket.isOpen; }
    get ping() { return this.stats.averageRtt > 0 ? this.stats.averageRtt : undefined; }

    initialize(socket: WebUdpSocket) {
        this.socket = socket;
        this.socket.on(WebUdpEvent.Message, this.onMessage.bind(this));

        for (let i = 0; i < kPacketHistoryLength; i++) {
            this.localHistory[i] = new Packet();
            this.remoteHistory[i] = new Packet();
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
                if (packet.acknowledged) { ackd += 1; }
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
     * Send a payload that will be resent until it is acknowledged. It will be transmitted with the next call to send().
     * @NOTE: The payload is copied, no reference to it needs (or should) be maintained outside of this function
     * @param payload The payload to include in the packet
     * @param tag A numeric identifier which will be passed to a future Receive event once this packet is acknowledged
     */
    sendReliable(payload: Uint8Array, tag?: number): boolean {
        this.reliableBuf.push({ payload, tag });
        return true;
    }

    /**
     * Construct a packet with the specified payload and send it to the server
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
        // @TODO: set reliable tag
        packet.sendTime = performance.now();
        packet.ackTime = undefined;
        packet.size = kPacketHeaderSize + payload.byteLength; // @TODO: + reliable payload size

        // Transmit the data
        packet.writeHeader(scratchPacketDataView);
        // @TODO: write reliable payload
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
            packet.readHeader(view);
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
                    if (p.header.sequence === sequence && !p.acknowledged) {
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

    private onMessage(evt: MessageEvent) {
        const data = evt.data;
        if (data instanceof ArrayBuffer) {
            this.receive(data);
        } else {
            console.log("received:", data);
        }
    }

    private acknowledge(packet: Packet) {
        const ackInfo = packet.acknowledge();

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