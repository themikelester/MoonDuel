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
    client: NetClient;

    initialize(context: Dependencies) {
        this.context = context;
    }

    onConnect(serverId: ClientId) {
        // Establish a WebUDP connection with the server
        const socket = new WebUdpSocket();
        this.client = new NetClient();
        this.client.initialize(socket);

        socket.connect(serverId);
        this.client.channel.on(NetChannelEvent.Receive, (data: any) => {
            // @HACK: Assume it's state
            this.context.snapshot.receive(data);
        });
    }

    update() {
    }
    
    broadcast(data: Uint8Array) {
        if (this.client) this.client.channel.send(data);
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