import { NetChannel, NetChannelEvent } from "./NetChannel";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetSchemas } from './schemas/schemas_generated';
import { flatbuffers } from 'flatbuffers';
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";
import { WebUdpSocket } from "./WebUdp";

const kPort = 8888;
const kServerAddress = window.location.protocol + "//" + window.location.hostname + ":" + kPort;

export class NetModule {
    isServer: boolean;

    NetChannels: NetChannel[] = [];

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize() {
    }

    onConnectServer(signalSocket: SignalSocket) {
        signalSocket.on(SignalSocketEvents.ClientJoined, (clientId: ClientId) => {
            // Create a new client and listen for it to connect
            const client = new NetChannel();
            const socket = new WebUdpSocket();

            socket.connect(signalSocket, clientId);
            client.initialize(socket);

            this.NetChannels.push(client);
        })
    }

    onConnectClient(signalSocket: SignalSocket) {
        // Establish a WebUDP connection with the server
        const server = new NetChannel();
        const socket = new WebUdpSocket();

        socket.connect(signalSocket, signalSocket.serverId);
        server.initialize(socket);
        server.on(NetChannelEvent.Receive, (data: any) => {
            console.log('Received', data);
        });

        this.NetChannels = [server];
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
    
    private broadcast(data: Uint8Array) {
        for (const client of this.NetChannels) {
            client.send(data);
        }
    }
}