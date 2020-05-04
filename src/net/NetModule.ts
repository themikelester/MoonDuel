import { SignalSocket, ClientId } from "./SignalSocket";
import { WebUdpSocket, WebUdpSocketFactory } from "./WebUdp";
import { NetClient, NetClientEvents } from "./NetClient";
import { AvatarSystemServer } from "../Avatar";
import { Snapshot } from "../Snapshot";
import { Clock } from "../Clock";
import { assert, defined, arrayRemove } from "../util";

import { NetGraph } from './NetDebug';
import { DebugMenu } from "../DebugMenu";
import { AckInfo } from "./NetChannel";
import { lerp, clamp } from "../MathHelpers";

interface ClientDependencies {
    clock: Clock;
    toplevel: HTMLElement;
    debugMenu: DebugMenu;
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

    private clientAhead: number = 0;
    private renderDelay: number = 0;

    private fastestAck?: AckInfo;
    private transmitInterval?: number;

    private averageFrameDiff = 0.0;

    initialize(context: ClientDependencies) {
        this.context = context;
        const clock = this.context.clock;

        const debugMenu = this.context.debugMenu.addFolder('Net');
        debugMenu.add(this, 'clientAhead', 0, 1000, 16).onChange(() => clock.setClientDelay(-this.clientAhead));
        debugMenu.add(this, 'renderDelay', 0, 1000, 16).onChange(() => clock.setRenderDelay(this.renderDelay));

        // @HACK:
        this.context.toplevel.appendChild(this.graph.dom);
    }

    terminate() {
        this.client.close();
    }

    onConnect(serverId: ClientId) {
        // Establish a WebUDP connection with the server
        this.client.on(NetClientEvents.ServerTimeAdjust, this.onServerTimeAdjust.bind(this));
        this.client.on(NetClientEvents.ReceiveServerFrame, this.onServerFrame.bind(this));
        this.client.connect(serverId);

        this.client.on(NetClientEvents.Connected, () => {
            if (this.graph) this.client.setNetGraphPanel(this.graph.addPanel(`Client: ${this.client.id}`));
        })
    }
    
    onServerFrame(frameDiff: number, snap: Snapshot) {
        // @TODO: I think this should be in NetClient
        this.averageFrameDiff = lerp(frameDiff, this.averageFrameDiff, 0.95);

        const kTargetClientFramesBuffered = 1.5; 

        // Try to keep clientTime so that kClientTimeTargetFramesBuffered are buffered on the server
        const frameDiffDelta = kTargetClientFramesBuffered - this.averageFrameDiff;
        const clientTimeDelta = frameDiffDelta * this.context.clock.simDt * 0.01;
        this.clientAhead = clamp(this.clientAhead + clientTimeDelta, 0, 250);
        this.context.clock.setClientDelay(-this.clientAhead);

        // Once our ping is calculated, adjust client and render times
        if (!this.synced && this.client.ping) {
            this.renderDelay = this.client.ping * 0.5 + this.context.clock.simDt * 3;
            this.context.clock.setRenderDelay(this.renderDelay);
            this.synced = true;
        }
    }

    onServerTimeAdjust(serverTime: number) {
        const serverTimeDelta = this.context.clock.syncToServerTime(serverTime);
        console.debug(`Adjusting serverTime by ${serverTimeDelta.toFixed(2)} ms`);
    }

    onVisibility(hidden: boolean) {
        this.client.transmitVisibilityChange(!hidden);

        // Send reliable messages now while we are still allowed to execute
        this.client.transmitReliable(0);

        if (hidden) {
            const kTransmissionDelayMs = 16; 
            let i = 1;

            // Continue transmitting reliable messages until they are all sent...
            this.transmitInterval = window.setInterval(() => {
                const finished = this.client.transmitReliable(i++);
                if (finished) {
                    clearInterval(this.transmitInterval);
                    this.transmitInterval
                }
            }, kTransmissionDelayMs);
        } else {
            // ... or if we become visible again
            if (defined(this.transmitInterval)) { 
                window.clearInterval(this.transmitInterval);
                this.transmitInterval = undefined;
            }
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

    terminate() {
        if (this.signalSocket) this.signalSocket.close();
        for (const client of this.clients) {
            client.close();
        }
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
        arrayRemove(this.clients, client);

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