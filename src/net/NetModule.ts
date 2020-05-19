import { SignalSocket, ClientId } from "./SignalSocket";
import { WebUdpSocket, WebUdpSocketFactory } from "./WebUdp";
import { NetClient, NetClientEvents, NetClientState } from "./NetClient";
import { AvatarSystemServer, AvatarSystemClient } from "../Avatar";
import { Clock } from "../Clock";
import { assert, defined, arrayRemove } from "../util";

import { NetGraph } from './NetDebug';
import { DebugMenu } from "../DebugMenu";
import { lerp, clamp } from "../MathHelpers";
import { SimStream, SimState, World } from "../World";

interface ClientDependencies {
    clock: Clock;
    toplevel: HTMLElement;
    debugMenu: DebugMenu;
    avatar: AvatarSystemClient;
    world: World;
}

interface ServerDependencies {
    avatar: AvatarSystemServer;
    clock: Clock;
    world: World;
}

export class NetModuleClient {
    context: ClientDependencies;
    client: NetClient;
    graph = new NetGraph();

    private clientAhead: number = 125;
    private renderDelay: number = 125;

    private transmitInterval?: number;

    private averageServerFrameDiff = 0.0;
    private averageClientFrameDiff = 0.0;
    private renderDelayTimestamp = 0.0;

    private showStats = false;
    private showGraph = false;

    initialize(context: ClientDependencies) {
        this.context = context;
        const clock = this.context.clock;

        this.client = new NetClient(context.clock);
        this.client.setSimStream(context.world.stream);

        const debugMenu = this.context.debugMenu.addFolder('Net');
        debugMenu.add(this, 'clientAhead', 0, 1000, 16).onChange(() => clock.setClientDelay(-this.clientAhead));
        debugMenu.add(this, 'renderDelay', 0, 1000, 16).onChange(() => clock.setRenderDelay(this.renderDelay));
        debugMenu.add(this, 'showStats').onChange((enabled: boolean) => this.client.stats.setEnabled(enabled));
        debugMenu.add(this, 'showGraph').onChange((enabled: boolean) => this.graph.setEnabled(enabled));

        // @HACK:
        this.context.toplevel.appendChild(this.graph.dom);
        this.context.toplevel.appendChild(this.client.stats.dom);
    }

    terminate() {
        this.client.close();
    }

    onConnect(serverId: ClientId) {
        // Set the client and render times to their default values for a networked game
        this.context.clock.setClientDelay(-this.clientAhead);
        this.context.clock.setRenderDelay(this.renderDelay);

        // Establish a WebUDP connection with the server
        this.client.on(NetClientEvents.ServerTimeAdjust, this.onServerTimeAdjust.bind(this));
        this.client.on(NetClientEvents.ReceiveServerFrame, this.onServerFrame.bind(this));
        this.client.on(NetClientEvents.Activated, this.onJoined.bind(this));
        this.client.connect(serverId);

        this.client.on(NetClientEvents.Connected, () => {
            if (this.graph) this.client.setNetGraphPanel(this.graph.addPanel(`Client: ${this.client.id}`));
        })
    }

    onJoined() {
        this.context.avatar.onJoined(this.client.clientIndex);
    }
    
    onServerFrame(frameDiff: number, simState: SimState) {
        this.context.world.addState(simState);

        // @TODO: I think this should be in NetClient
        this.averageServerFrameDiff = lerp(frameDiff, this.averageServerFrameDiff, 0.95);

        const kTargetServerFrameDiff = 1.5; // Try to keep 1.5 frames buffered on the server
        const kAdjustSpeed = 0.01; // ClientAhead will move 1% towards its instananeous ideal each frame

        // Try to keep clientTime so that kTargetFrameDiff frames are buffered on the server
        // It takes RTT ms to detect feedback from these changes, so modify the clientAhead slow enough to avoid overcompensating
        const clientTimeDelta = (kTargetServerFrameDiff - this.averageServerFrameDiff) * this.context.clock.simDt;
        this.clientAhead = clamp(this.clientAhead + (clientTimeDelta * kAdjustSpeed), 0, 250);
        this.context.clock.setClientDelay(-this.clientAhead);

        // RenderTime needs to be handled a bit differently. Since it directly corresponds to the perceived speed 
        // of world objects, even small renderDelay changes can be jarring and should happen has as infrequently as possible.
        const kTargetClientFrameDiff = 3; // Try to keep 3 frames buffered on the client for 2 frames of packet loss protection
        const kClientSlidingAverageWeight = 0.9; // Lower numbers will give recent values more weight in the average 
        const kMaxRenderDelay = 250 // Maximum delay from serverTime (in ms)
        const kRenderDelayAdjustPeriod = 3000 // Minimum time to wait before adjusting renderTime again
        const kMinAdjustment = this.context.clock.simDt * 1; // Don't make any adjustments to renderDelay smaller than this

        // If a frame arrives late, it also means that we have not received any subsequent frames 
        // (because it would have been discarded at a lower net stack layer). This means that it 
        // wasn't dropped, but the transit time from the server may have increased. If we see 
        // frames consistently coming late (or early) then we consider the transit time changed
        // and adjust the render delay. 
        const clientFrameDiff = (simState.frame - this.client.lastRequestedFrame);
        this.averageClientFrameDiff = lerp(clientFrameDiff, this.averageClientFrameDiff, kClientSlidingAverageWeight);

        // If a frame arrives after we needed it (it's late by more than kTargetClientFrameDiff, i.e. super late),
        // adjust render time immediately so that it would have arrived on time. 
        if (clientFrameDiff < 0) {
            const delayDelta = (kTargetClientFrameDiff - clientFrameDiff) * this.context.clock.simDt;
            
            this.renderDelay = clamp(this.renderDelay + delayDelta, 0, kMaxRenderDelay);
            this.context.clock.setRenderDelay(this.renderDelay);
            this.renderDelayTimestamp = performance.now();
            this.averageClientFrameDiff = kTargetClientFrameDiff;
        }

        const timeSinceRenderDelayChange = performance.now() - this.renderDelayTimestamp;
        if (timeSinceRenderDelayChange > kRenderDelayAdjustPeriod) {
            const delayDelta = (kTargetClientFrameDiff - this.averageClientFrameDiff) * this.context.clock.simDt;
            if (Math.abs(delayDelta) > kMinAdjustment) {
                this.renderDelay = clamp(this.renderDelay + delayDelta, 0, kMaxRenderDelay);

                console.debug(`Adjusting renderTime by ${delayDelta} ms`);
                this.context.clock.setRenderDelay(this.renderDelay);
                this.averageClientFrameDiff = kTargetClientFrameDiff;
            }

            this.renderDelayTimestamp = performance.now();
        }
    }

    onServerTimeAdjust(serverTime: number) {
        const serverTimeDelta = this.context.clock.syncToServerTime(serverTime);
        console.debug(`Adjusting serverTime by ${serverTimeDelta.toFixed(2)} ms`);
    }

    onVisibility(hidden: boolean) {
        if (this.client.state !== NetClientState.Active) return;
        
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
        this.client.stats.update();
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
    clients: Nullable<NetClient>[] = [];
    graph?: NetGraph;

    initialize(deps: ServerDependencies) {
        this.context = deps;
        this.graph = window.client?.net.graph;
    }

    terminate() {
        if (this.signalSocket) this.signalSocket.close();
        for (const client of this.clients) {
            if (client) client.close();
        }
    }

    async onConnect(signalSocket: SignalSocket) {
        this.signalSocket = signalSocket;
        const listener = new WebUdpSocketFactory(signalSocket);
        await listener.listen(async (socket: WebUdpSocket) => {
            const client = new NetClient(this.context.clock);
            client.setSimStream(this.context.world.stream);
            client.on(NetClientEvents.Connected, this.onClientConnected.bind(this, client));
            client.on(NetClientEvents.Disconnected, this.onClientDisconnected.bind(this, client));
            client.accept(socket);

            let idx = this.clients.indexOf(null);
            if (idx < 0) idx = this.clients.length;
            
            this.clients[idx] = client;
            client.clientIndex = idx;

            client.transmitConnectionInfo(idx);
        });
    }

    onClientConnected(client: NetClient) {
        console.log('Client connected:', client);
        this.context.avatar.addAvatar(client.clientIndex);

        if (this.graph) client.setNetGraphPanel(this.graph.addPanel(`Server: ${client.id}`));
    }

    onClientDisconnected(client: NetClient) {
        console.log('Client disconnected:', client);
        this.context.avatar.removeAvatar(client.clientIndex);
        const idx = this.clients.indexOf(client);
        this.clients[idx] = null;

        if (client.graphPanel) { this.graph?.removePanel(client.graphPanel); }
    }

    transmitToClients(frame: number) {
        for (const client of this.clients) {
            if (client) client.transmitServerFrame(frame);
        }
    }

    private updateNetGraph() {
        if (this.graph) {
            for (const client of this.clients) {
                const clientServerTime = window.client.clock.serverTime;
                if (client) client.graphPanel?.update(client.ping, clientServerTime, undefined, this.context.clock.getCurrentServerTime());
            }
        }
    }
}