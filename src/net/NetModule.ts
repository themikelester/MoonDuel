import { SignalSocket, ClientId } from "./SignalSocket";
import { WebUdpSocket, WebUdpSocketFactory } from "./WebUdp";
import { NetClient, NetClientEvents, NetClientState } from "./NetClient";
import { AvatarSystemServer } from "../Avatar";
import { Snapshot } from "../Snapshot";
import { Clock } from "../Clock";
import { assert, defined } from "../util";

import { NetGraph } from './NetDebug';

interface ClientDependencies {
    clock: Clock;
    toplevel: HTMLElement;
}

interface ServerDependencies {
    avatar: AvatarSystemServer;
    clock: Clock;
}

export class NetModuleClient {
    context: ClientDependencies;
    client: NetClient = new NetClient();
    synced: boolean = false;
    graph = new NetGraph();

    initialize(context: ClientDependencies) {
        this.context = context;

        // @HACK:
        this.context.toplevel.appendChild(this.graph.dom);
    }

    onConnect(serverId: ClientId) {
        // Establish a WebUDP connection with the server
        this.client.on(NetClientEvents.Message, this.onMessage.bind(this));
        this.client.connect(serverId);

        this.client.on(NetClientEvents.Connected, () => {
            if (this.graph) this.client.setNetGraphPanel(this.graph.addPanel(`Client: ${this.client.id}`));
        })
    }

    onMessage(data: Uint8Array) {
        // Once our ping is calculated, sync our simulation time to that of the server
        if (!this.synced && defined(this.client.ping)) {
            const latestFrame = this.client.lastReceivedFrame;
            const latestTime = latestFrame * this.context.clock.simDt;
            const serverTime = latestTime + (0.5 * this.client.ping);
            this.context.clock.syncToServerTime(serverTime, this.client.ping);
            this.synced = true;
        }
    }

    update({ }) {
        this.updateNetGraph();
    }

    private updateNetGraph() {
        const clock = this.context.clock;
        this.client.graphPanel?.update(this.client.ping, clock.serverTime, clock.renderTime, clock.clientTime);

        if (window.server) window.server.net.updateNetGraph();
    }
}

export class NetModuleServer {
    context: ServerDependencies;
    signalSocket: SignalSocket;
    clients: NetClient[] = [];
    graph?: NetGraph;

    initialize(deps: ServerDependencies) {
        this.context = deps;
        this.graph = window.client?.net.graph;
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

        if (this.graph) client.setNetGraphPanel(this.graph.addPanel(`Server: ${client.id}`));
    }

    onClientDisconnected(client: NetClient) {
        console.log('Client disconnected:', client);
        // this.context.avatar.removeAvatar(client.id);

        if (client.graphPanel) { this.graph?.removePanel(client.graphPanel); }
    }

    onClientMessage(client: NetClient, data: Uint8Array) {
    }

    transmitToClients(snap: Snapshot) {
        for (const client of this.clients) {
            client.transmitServerFrame(snap);
        }
    }

    private updateNetGraph() {
        if (this.graph) {
            for (const client of this.clients) {
                const clientServerTime = window.client.clock.serverTime;
                client.graphPanel?.update(client.ping, clientServerTime, undefined, this.context.clock.serverTime);
            }
        }
    }
}