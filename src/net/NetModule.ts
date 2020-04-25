import { NetChannel, NetChannelEvent } from "./NetChannel";
import { SignalSocket, ClientId } from "./SignalSocket";
import { WebUdpSocket, WebUdpSocketFactory } from "./WebUdp";
import { NetClient, NetClientEvents, NetClientState } from "./NetClient";
import { AvatarSystemServer } from "../Avatar";
import { SnapshotManager, Snapshot } from "../Snapshot";

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
        this.client = new NetClient();
        this.client.connect(serverId);
        this.client.on(NetClientEvents.Message, this.onMessage.bind(this));
    }

    onMessage(data: Uint8Array) {
        // @HACK: Assume it's state
        const snap = Snapshot.deserialize(data); 
        this.context.snapshot.setSnapshot(snap);
    }
    
    broadcast(data: Uint8Array) {
        if (this.client && this.client.state === NetClientState.Connected) {
            this.client.channel.send(data);
        }
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
            client.on(NetClientEvents.Message, this.onClientMessage.bind(this, client));
            client.accept(socket);
            this.clients.push(client);
        });
    }

    onClientConnected(client: NetClient) {
        console.log('Client connected:', client);
        this.context.avatar.addAvatar(client.id);
    }

    onClientDisconnected(client: NetClient) {
        console.log('Client disconnected:', client);
        // this.context.avatar.removeAvatar(client.id);
    }

    onClientMessage(client: NetClient, data: Uint8Array) {            
        // @HACK: Assume it's a usercommand
        client.userCommands.receive(data);
    }

    broadcast(data: Uint8Array) {
        for (const client of this.clients) {
            client.channel.send(data);
        }
    }
}