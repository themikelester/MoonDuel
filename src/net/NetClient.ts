import { NetChannel, NetChannelEvent } from "./NetChannel";
import { assert } from "../util";
import { WebUdpSocket, WebUdpEvent } from "./WebUdp";
import { UserCommandBuffer } from "../UserCommand";
import { EventDispatcher } from "../EventDispatcher";
import { ClientId } from "./SignalSocket";

export enum NetClientState {
    Free,
    Connected,
    Disconnected,

    // The Quake 3 Arena states:
	// CS_FREE,		// can be reused for a new connection
	// CS_ZOMBIE,		// client has been disconnected, but don't reuse
	// 				// connection for a couple seconds
	// CS_CONNECTED,	// has been assigned to a client_t, but no gamestate yet
	// CS_PRIMED,		// gamestate has been sent, but client hasn't sent a usercmd
	// CS_ACTIVE		// client is fully in game
}

export enum NetClientEvents { 
    Connected = 'connected',
    Disconnected = 'disconnected',
    Message = 'message',
}

export class NetClient extends EventDispatcher {
    id: string;
    state: NetClientState = NetClientState.Free;

    ping: number = -1;
    rate: number = -1; // bytes per second

    channel: NetChannel;

    userCommands: UserCommandBuffer = new UserCommandBuffer();

    private initialize(socket: WebUdpSocket) {
        assert(this.state === NetClientState.Free);
        console.debug(`NetClient: ${this.id} is attempting to connect`);

        socket.on(WebUdpEvent.Open, () => {
            console.debug(`NetClient: ${this.id} connected`);
            this.state = NetClientState.Connected;
            this.fire(NetClientEvents.Connected);
        });

        socket.on(WebUdpEvent.Close, () => {
            console.debug(`NetClient: ${this.id} disconnected`);
            this.state = NetClientState.Disconnected;
            this.fire(NetClientEvents.Disconnected);
        });
        
        this.channel = new NetChannel();

        this.channel.on(NetChannelEvent.Receive, this.onMessage.bind(this));
        this.channel.initialize(socket);
    }

    /**
     * The Client calls this to connect to a specific ClientID that will act as the server
     */
    async connect(serverId: ClientId) {
        const socket = new WebUdpSocket();
        
        // Wait for the WebUdp socket to be assigned a ClientID by the signalling server
        await socket.connect(serverId);
        this.id = socket.clientId;

        this.initialize(socket);
    }

    /**
     * Accept a connection to a Client's NetClient produced by a WebUdpSocketFactory.
     */
    accept(socket: WebUdpSocket) {
        this.id = socket.peerId;
        this.initialize(socket);
    }

    onMessage(msg: Uint8Array) {
        this.ping = this.channel.averageRtt;
        
        this.fire.bind(NetClientEvents.Message, msg);
    }
}