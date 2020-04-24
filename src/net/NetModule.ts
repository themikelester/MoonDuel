import { NetChannel, NetChannelEvent } from "./NetChannel";
import { SignalSocket, ClientId } from "./SignalSocket";
import { WebUdpSocket, WebUdpSocketFactory } from "./WebUdp";
import { NetClient, NetClientEvents } from "./NetClient";
import { AvatarSystemServer } from "../Avatar";
import { SnapshotManager } from "../Snapshot";

interface Dependencies {
    avatar: AvatarSystemServer;
    snapshot: SnapshotManager;
}

export class NetModuleClient {
    context: Dependencies;
    netChannel: NetChannel;

    initialize(context: Dependencies) {
        this.context = context;
    }

    onConnect(serverId: ClientId) {
        // Establish a WebUDP connection with the server
        const server = new NetChannel();
        const socket = new WebUdpSocket();

        socket.connect(serverId);
        server.initialize(socket);
        server.on(NetChannelEvent.Receive, (data: any) => {
            // @HACK: Assume it's state
            this.context.snapshot.receive(data);
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

    initialize(deps: Dependencies) {
        this.context = deps;
    }

    async onConnect(signalSocket: SignalSocket) {
        this.signalSocket = signalSocket;
        const listener = new WebUdpSocketFactory(signalSocket);
        await listener.listen(async (socket: WebUdpSocket) => {
            const client = new NetClient();
            client.on(NetClientEvents.Connected, this.onClientConnected.bind(this, client));
            client.on(NetClientEvents.Disconnected, this.onClientDisconnected.bind(this, client));
            client.initialize(socket);
            this.clients.push(client);
        });
    }

    onClientConnected(client: NetClient) {
        this.context.avatar.addAvatar(client.id);
    }

    onClientDisconnected(client: NetClient) {
        // this.context.avatar.removeAvatar(client.id);
    }

    update() {
    }
    
    broadcast(data: Uint8Array) {
        for (const client of this.clients) {
            client.channel.send(data);
        }
    }
}