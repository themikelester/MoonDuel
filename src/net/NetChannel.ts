
import { WebUdpSocket, WebUdpEvent } from './WebUdp';
import { sequenceNumberGreaterThan, sequenceNumberWrap, Packet, kPacketMaxPayloadSize, AckInfo, kPacketHeaderSize } from './NetPacket';
import { EventDispatcher } from '../EventDispatcher';
import { defined, defaultValue } from '../util';
import { lerp } from '../MathHelpers';

export enum NetChannelEvent {
    Receive = "receive",
};

const kPacketHistoryLength = 512; // Approximately 8 seconds worth of packets at 60hz
const kPingMinAcks = 10; // The minimum number of ACKs that we need before computing the Ping/RTT
const kPingMovingAveragePower = 1.0/10.0;
const kMaxRTT = 1000; // Maximum round-trip-time before a packet is considered lost

const scratchPacketBuffer = new Uint8Array(kPacketMaxPayloadSize + kPacketHeaderSize);
const scratchPacketDataView = new DataView(scratchPacketBuffer.buffer);

/**
 * High level class controlling communication with the server. Handles packet reliability, buffering, and ping measurement.
 * @NOTE: This needs to be kept in sync with its counterpart on the server side, Client.cpp/h
 */
export class NetChannel extends EventDispatcher {
    private averageRtt: number = 0; // Moving average of packet round-trip-time
    private ackCount: number = 0;

    private socket: WebUdpSocket;

    private remoteSequence = -1;
    private localSequence = 0;
    private localHistory: Packet[] = [];
    private remoteHistory: Packet[] = [];

    private latestAck = {} as { sequence?: number, info?: AckInfo };

    get isOpen() { return this.socket.isOpen; }
    get ping() { return (this.ackCount < kPingMinAcks) ? undefined : this.averageRtt; }

    get packetLoss() {
        const now = performance.now();
        let sent = 0;
        let lost = 0;

        for (let i = 0; i < kPacketHistoryLength; i++) {
            const packet = this.localHistory[i];
            const age = now - this.localHistory[i].sendTime;
            if (age > kMaxRTT) {
                sent += 1;
                if (!packet.acknowledged) { lost += 1; }
            } 
        }

        return sent > 0 ? lost / sent : 0;
    }

    initialize(socket: WebUdpSocket) {
        this.socket = socket;
        this.socket.on(WebUdpEvent.Message, this.onMessage.bind(this));

        for (let i = 0; i < kPacketHistoryLength; i++) {
            this.localHistory[i] = new Packet();
            this.remoteHistory[i] = new Packet();
        }
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

        const payloadOffset = packet.toBuffer(scratchPacketDataView);
        scratchPacketBuffer.set(payload, payloadOffset);
        const bufferSize = payloadOffset + payload.byteLength;

        this.socket.send(scratchPacketBuffer.subarray(0, bufferSize));

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
            const payloadOffset = packet.fromBuffer(view);
            const payload = new Uint8Array(data, payloadOffset);

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
        const packetRtt = ackInfo.rttTime;

        this.ackCount += 1;

        // Track the latest acknowledged packet
        if (!defined(this.latestAck.sequence) || sequenceNumberGreaterThan(packet.header.sequence, this.latestAck.sequence)) { 
            this.latestAck.info = ackInfo; 
            this.latestAck.sequence = packet.header.sequence;
        }
        
        // Compute ping using an exponential moving average, but not until we have enough valid samples.
        // Sum initial samples so that they can be averaged as the first sample point for the moving average. 
        if (this.ackCount <= kPingMinAcks) {
            this.averageRtt += packetRtt;

            if (this.ackCount === kPingMinAcks) {
                this.averageRtt /= kPingMinAcks;
            }
        } else {
            this.averageRtt = lerp(this.averageRtt, packetRtt, kPingMovingAveragePower);
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