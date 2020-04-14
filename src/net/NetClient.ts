
import { WebUdpSocket, WebUdpEvent } from './WebUdp';
import { sequenceNumberGreaterThan, sequenceNumberWrap, PacketBuffer } from './NetPacket';
import { EventDispatcher } from '../EventDispatcher';
import { defined } from '../util';

export enum NetClientEvent {
    Connect = "connect",
    Receive = "receive",
    Acknowledge = "acknowledge",
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
    private localHistory: PacketBuffer = new PacketBuffer(kPacketHistoryLength);
    private remoteHistory: PacketBuffer = new PacketBuffer(kPacketHistoryLength);

    initialize(serverAddress: string) {
        this.socket = new WebUdpSocket(serverAddress);
        this.socket.on(WebUdpEvent.Open, this.onOpen.bind(this));
        this.socket.on(WebUdpEvent.Message, this.onMessage.bind(this));
        this.socket.connect();
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

    private readAckBitfield(bitfield: number, sequence: number, history: PacketBuffer) {
        for (const packet of history) {
            const bit = sequenceNumberWrap(sequence - packet.header.sequence);
            const ackd = bitfield & (1 << bit);
            if (ackd && !packet.isAcknowledged()) {
                packet.setAcknowledged();
                this.fire(NetClientEvent.Acknowledge, packet.payload);
            }
        }
        return bitfield;
    }

    private writeAckBitfield(sequence: number, history: PacketBuffer) {
        let bitfield = 0;
        for (const packet of history) {
            const bit = sequenceNumberWrap(sequence - packet.header.sequence);
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
        const packet = this.remoteHistory.allocate().fromBuffer(data);
        if (!defined(packet)) {
            console.warn('NetClient: Received packet that was too large for buffer. Ignoring.');
            return;
        }

        // If this packet is newer than the latest packet we've received, update
        if (sequenceNumberGreaterThan(packet.header.sequence, this.remoteSequence)) {
            this.remoteSequence = packet.header.sequence;
        }

        // Update the acknowledged state of all of the recently sent packets
        this.readAckBitfield(packet.header.ackBitfield, packet.header.ack, this.localHistory);

        this.fire(NetClientEvent.Receive, packet.payload);
    }

    /**
     * Construct a packet with the specified payload and send it to the server
     * @NOTE: The payload is copied, no reference to it needs (or should) be maintained outside of this function
     * @param payload The payload to include in the packet
     */
    send(payload: Uint8Array) {
        const packet = this.localHistory.allocate();

        packet.header.sequence = this.localSequence;
        packet.header.ack = this.remoteSequence;
        packet.header.ackBitfield = this.writeAckBitfield(this.remoteSequence, this.remoteHistory);
        packet.payload = payload;

        const bytes = packet.toBuffer();
        if (!defined(bytes)) {
            console.warn('NetClient: Attempted to send packet that was too large for buffer. Ignoring.');
            return;
        }

        this.socket.send(bytes);

        this.localSequence += 1;
    }

    /**
     * Compute the average round-trip-time between this client and the server.
     * This is the local timestamp difference between when the packet was constructed, and when another packet was 
     * received which acknowledged it. This is a bit inflated from the true packet latency, since it also includes
     * time the packet was buffered on the client, and server processing time. 
     * @TODO: If the server is processing at a fixed tick rate, we could subtract half to get a more accurate average
     */
    getAverageRTT() {
        let total = 0;
        for (const packet of this.localHistory) {
            total += packet.getRTT();
        }
        return total / this.localHistory.count();
    }
}