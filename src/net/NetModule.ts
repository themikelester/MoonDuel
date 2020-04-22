import { NetChannel, NetChannelEvent } from "./NetChannel";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetSchemas } from './schemas/schemas_generated';
import { flatbuffers } from 'flatbuffers';
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";
import { WebUdpSocket } from "./WebUdp";

const kPort = 8888;
const kServerAddress = window.location.protocol + "//" + window.location.hostname + ":" + kPort;

export class NetModuleClient {
    netChannel: NetChannel;

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize() {
    }

    onConnect(signalSocket: SignalSocket) {
        // Establish a WebUDP connection with the server
        const server = new NetChannel();
        const socket = new WebUdpSocket();

        socket.connect(signalSocket, signalSocket.serverId);
        server.initialize(socket);
        server.on(NetChannelEvent.Receive, (data: any) => {
            console.log('Received', data);
        });

        this.netChannel = server;
    }

    update() {
        // Send a heartbeat at 60hz
        NetSchemas.Heartbeat.startHeartbeat(this.builder);
        const heartbeat = NetSchemas.Heartbeat.endHeartbeat(this.builder);
        const message = NetSchemas.Message.createMessage(this.builder, this.messageId++, NetSchemas.Data.Heartbeat, heartbeat);
        this.builder.finish(message);
        this.broadcast(this.builder.asUint8Array());
        this.builder.clear();
    }
    
    broadcast(data: Uint8Array) {
        if (this.netChannel) this.netChannel.send(data);
    }
}

export class NetModuleServer {
    netChannels: NetChannel[] = [];

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize() {
    }

    onConnect(signalSocket: SignalSocket) {
        signalSocket.on(SignalSocketEvents.ClientJoined, (clientId: ClientId) => {
            // Create a new client and listen for it to connect
            const channel = new NetChannel();
            const socket = new WebUdpSocket();

            socket.connect(signalSocket, clientId);
            channel.on(NetChannelEvent.Receive, this.onMessage.bind(this, clientId));
            channel.initialize(socket);

            this.netChannels.push(channel);
        })
    }

    onMessage(clientId: ClientId, msg: Uint8Array) {
        console.log(`Received message from ${clientId}:`, msg);
    }

    update() {
    }
    
    broadcast(data: Uint8Array) {
        for (const client of this.netChannels) {
            client.send(data);
        }
    }
}