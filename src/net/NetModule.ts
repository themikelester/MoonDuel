import { NetChannel, NetChannelEvent } from "./NetChannel";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetSchemas } from './schemas/schemas_generated';
import { flatbuffers } from 'flatbuffers';
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";
import { WebUdpSocket } from "./WebUdp";
import { UserCommandBuffer } from "../UserCommand";
import { NetClient } from "./NetClient";
import { AvatarSystem } from "../Avatar";

const kPort = 8888;
const kServerAddress = window.location.protocol + "//" + window.location.hostname + ":" + kPort;

interface Dependencies {
    avatar: AvatarSystem;
}

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
    }
    
    broadcast(data: Uint8Array) {
        if (this.netChannel) this.netChannel.send(data);
    }
}

export class NetModuleServer {
    context: Dependencies;
    clients: NetClient[] = [];

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize(deps: Dependencies) {
        this.context = deps;
    }

    onConnect(signalSocket: SignalSocket) {
        signalSocket.on(SignalSocketEvents.ClientJoined, async (clientId: ClientId) => {
            // Create a new client and listen for it to join
            const client = new NetClient();
            const clientConnected = client.initialize(signalSocket, clientId);
            await clientConnected;

            console.debug(`[Server] NetChannel: Client ${clientId} connected`);
            this.clients.push(client);
        })
    }

    update() {
    }
    
    broadcast(data: Uint8Array) {
        for (const client of this.clients) {
            client.channel.send(data);
        }
    }
}