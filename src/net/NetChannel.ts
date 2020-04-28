
import { WebUdpSocket, WebUdpEvent } from './WebUdp';
import { sequenceNumberGreaterThan, sequenceNumberWrap, PacketBuffer, Packet, kPacketMaxPayloadSize, kSequenceNumberDomain } from './NetPacket';
import { EventDispatcher } from '../EventDispatcher';
import { defined, assert, defaultValue } from '../util';
import { lerp, wrappedDistance } from '../MathHelpers';

export enum NetChannelEvent {
    Receive = "receive",
};

const kPacketHistoryLength = 32;
const kPingMinAcks = 10; // The minimum number of ACKs that we need before computing the Ping/RTT
const kPingMovingAveragePower = 1.0/10.0;

/**
 * High level class controlling communication with the server. Handles packet reliability, buffering, and ping measurement.
 * @NOTE: This needs to be kept in sync with its counterpart on the server side, Client.cpp/h
 */
export class NetChannel extends EventDispatcher {
    private averageRtt: number = 0; // Moving average of packet round-trip-time
    private ackCount: number = 0;

    private socket: WebUdpSocket;

    private remoteSequence = 0;
    private localSequence = 0;
    private localHistory: Packet[] = new PacketBuffer(kPacketHistoryLength).packets;
    private remoteHistory: Packet[] = new PacketBuffer(kPacketHistoryLength).packets;

    private latestAck?: Packet;

    initialize(socket: WebUdpSocket) {
        this.socket = socket;
        this.socket.on(WebUdpEvent.Message, this.onMessage.bind(this));
    }

    private onMessage(evt: MessageEvent) {
        const data = evt.data;
        if (data instanceof ArrayBuffer) {
            this.receive(data);
        } else {
            console.log("received:", data);
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

    /**
     * Process a packet that was received from the server. 
     * Fires NetChannelEvent.Receive with the packet payload for any interested listeners. 
     * @param data The raw data received from the WebUDP connection
     */
    private receive(data: ArrayBuffer) {
        const view = new DataView(data);
        const sequence = view.getUint16(0, true);

        // If this packet is older than our buffer allows, throw it away
        if (wrappedDistance(this.remoteSequence, sequence, kSequenceNumberDomain) >= kPacketHistoryLength) {
            return;
        }

        // Parse and buffer the packet 
        const packet = this.remoteHistory[sequence % kPacketHistoryLength].fromBuffer(data);
        if (!defined(packet)) {
            console.warn('NetChannel: Received packet that was too large for buffer. Ignoring.');
            return;
        }

        // If this packet is newer than the latest packet we've received, update
        if (sequenceNumberGreaterThan(packet.header.sequence, this.remoteSequence)) {
            this.remoteSequence = packet.header.sequence;
            
            // Update the acknowledged state of all of the recently sent packets
            const bitfield = packet.header.ackBitfield;
            for (let i = 0; i < 32; i++) {
                if (bitfield & 1 << i) {
                    const sequence = packet.header.ack - i; 
                    const p = this.localHistory[sequence % kPacketHistoryLength];
                    if (p.header.sequence === sequence && !p.acknowledged) {
                        this.acknowledge(p);
                    }
                }
            }

            this.fire(NetChannelEvent.Receive, packet.payload, this.latestAck?.tag);
        } else {
            // Ignore the packet
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
        packet.payload = payload;
        packet.tag = defaultValue(tag, this.localSequence);

        const bytes = packet.toBuffer();
        this.socket.send(bytes);

        this.localSequence = sequenceNumberWrap(this.localSequence + 1);
    }

    get isOpen() {
        return this.socket.isOpen;
    }

    get ping() {
        return (this.ackCount < kPingMinAcks) ? undefined : this.averageRtt;
    }

    private acknowledge(packet: Packet) {
        const packetRtt = packet.acknowledge();

        this.ackCount += 1;
        assert(this.ackCount <= this.localSequence);

        // Track the latest acknowledged packet
        if (!defined(this.latestAck) || sequenceNumberGreaterThan(packet.header.sequence, this.latestAck.header.sequence)) { 
            this.latestAck = packet; 
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
}