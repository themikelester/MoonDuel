import { NetChannel, NetChannelEvent } from "./NetChannel";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetSchemas } from './schemas/schemas_generated';
import { flatbuffers } from 'flatbuffers';
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";
import { WebUdpSocket } from "./WebUdp";
import { UserCommandBuffer } from "../UserCommand";

const kPort = 8888;
const kServerAddress = window.location.protocol + "//" + window.location.hostname + ":" + kPort;

interface Dependencies {
    userCommands: UserCommandBuffer;
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
    netChannels: NetChannel[] = [];

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize(deps: Dependencies) {
        this.context = deps;
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
        // @HACK: Assume it's a usercommand
        this.context.userCommands.receive(msg);
    }

    update() {
    }
    
    broadcast(data: Uint8Array) {
        for (const client of this.netChannels) {
            client.send(data);
        }
    }
}