
import { WebUdpSocket, WebUdpEvent } from './WebUdp';
import { sequenceNumberGreaterThan, sequenceNumberWrap, PacketBuffer, Packet, kPacketMaxPayloadSize } from './NetPacket';
import { EventDispatcher } from '../EventDispatcher';
import { defined, assert, assertDefined } from '../util';

export enum NetClientEvent {
    Connect = "connect",
    Receive = "receive",
};

const kPacketHistoryLength = 32;

/**
 * High level class controlling communication with the server. Handles packet reliability, buffering, and ping measurement.
 * @NOTE: This needs to be kept in sync with its counterpart on the server side, Client.cpp/h
 */
export class NetClient extends EventDispatcher {
    private socket: WebUdpSocket;

    private remoteSequence = 0;
    private localSequence = 0;
    private ackBuffer: boolean[] = new Array(kPacketHistoryLength).fill(false);
    private localHistory: Packet[] = new PacketBuffer(kPacketHistoryLength).packets;
    private remoteHistory: Packet[] = new PacketBuffer(kPacketHistoryLength).packets;

    initialize(socket: WebUdpSocket) {
        this.socket = socket;
        this.socket.on(WebUdpEvent.Open, this.onOpen.bind(this));
        this.socket.on(WebUdpEvent.Message, this.onMessage.bind(this));
    }

    private onOpen(evt: WebUdpEvent) {
        console.log('Connected to server');
        this.fire(NetClientEvent.Connect);
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
            const bit = sequenceNumberWrap(this.remoteSequence - packet.header.sequence);
            if (bit < 32) {
                bitfield |= 1 << bit;
            }
        }
        return bitfield;
    }

    /**
     * Process a packet that was received from the server. 
     * Fires NetClientEvent.Receive with the packet payload for any interested listeners. 
     * @param data The raw data received from the WebUDP connection
     */
    private receive(data: ArrayBuffer) {
        const sequence = new Uint16Array(data)[0];

        // If this packet is older than our buffer allows, throw it away
        if (sequence <= this.remoteSequence - kPacketHistoryLength) {
            return;
        }

        // Parse and buffer the packet 
        const packet = this.remoteHistory[sequence % kPacketHistoryLength].fromBuffer(data);
        if (!defined(packet)) {
            console.warn('NetClient: Received packet that was too large for buffer. Ignoring.');
            return;
        }

        // If this packet is newer than the latest packet we've received, update
        if (sequenceNumberGreaterThan(packet.header.sequence, this.remoteSequence)) {
            this.remoteSequence = packet.header.sequence;
        }

        // Update the acknowledged state of all of the recently sent packets
        const bitfield = packet.header.ackBitfield;
        for (let i = 0; i < 32; i++) {
            if (bitfield & 1 << i) { this.ackBuffer[(packet.header.ack + i) % kPacketHistoryLength] = true; }
        }

        this.fire(NetClientEvent.Receive, packet.payload);
    }

    /**
     * Construct a packet with the specified payload and send it to the server
     * @NOTE: The payload is copied, no reference to it needs (or should) be maintained outside of this function
     * @param payload The payload to include in the packet
     */
    send(payload: Uint8Array) {
        if (payload.length > kPacketMaxPayloadSize) {
            console.warn('NetClient: Attempted to send packet that was too large for buffer. Ignoring.');
            return;
        }
        
        // Allocate the packet (being careful to set its unacknowledged state)
        const packet = this.localHistory[this.localSequence % kPacketHistoryLength];
        this.ackBuffer[this.localSequence % kPacketHistoryLength] = false;

        packet.header.sequence = this.localSequence;
        packet.header.ack = this.remoteSequence;
        packet.header.ackBitfield = this.writeAckBitfield(this.remoteHistory);
        packet.payload = payload;

        const bytes = packet.toBuffer();
        this.socket.send(bytes);

        this.localSequence += 1;
    }

    get isOpen() {
        return this.socket.isOpen;
    }

    isAcknowledged(sequence: number) {
        if (sequence <= this.remoteSequence - kPacketHistoryLength) {
            return false;
        }

        return this.ackBuffer[sequence % kPacketHistoryLength];
    }
}