import { NetChannel, NetChannelEvent } from "./NetChannel";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetSchemas } from './schemas/schemas_generated';
import { flatbuffers } from 'flatbuffers';
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";
import { WebUdpSocket, WebUdpSocketFactory, WebUdpEvent } from "./WebUdp";
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

    onConnect(serverId: ClientId) {
        // Establish a WebUDP connection with the server
        const server = new NetChannel();
        const socket = new WebUdpSocket();

        socket.connect(serverId);
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
    signalSocket: SignalSocket;
    clients: NetClient[] = [];

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize(deps: Dependencies) {
        this.context = deps;
    }

    async onConnect(signalSocket: SignalSocket) {
        this.signalSocket = signalSocket;
        const listener = new WebUdpSocketFactory(signalSocket);
        await listener.listen(async (socket: WebUdpSocket) => {
            const client = new NetClient();
            const clientConnected = client.initialize(socket);
            await clientConnected;

            console.debug(`[Server] NetChannel: Client ${client.id} connected`);
            this.clients.push(client);
        });
    }

    update() {
    }
    
    broadcast(data: Uint8Array) {
        for (const client of this.clients) {
            client.channel.send(data);
        }
    }
}