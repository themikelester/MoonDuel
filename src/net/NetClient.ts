import { NetChannel, NetChannelEvent } from "./NetChannel";
import { assert } from "../util";
import { WebUdpSocket, WebUdpEvent } from "./WebUdp";
import { UserCommandBuffer } from "../UserCommand";

enum NetClientState {
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

export class NetClient {
    id: string;
    state: NetClientState = NetClientState.Free;

    ping: number = -1;
    rate: number = -1; // bytes per second

    channel: NetChannel;

    userCommands: UserCommandBuffer = new UserCommandBuffer();

    initialize(socket: WebUdpSocket) {
        assert(this.state === NetClientState.Free);
        console.debug(`NetClient: ${socket.peerId} is attempting to connect`);

        socket.on(WebUdpEvent.Open, () => {
            console.debug(`NetClient: ${socket.peerId} connected`);
            this.state = NetClientState.Connected;
        });

        socket.on(WebUdpEvent.Close, () => {
            console.debug(`NetClient: ${socket.peerId} disconnected`);
            this.state = NetClientState.Disconnected;
        });
        
        this.id = socket.peerId;
        this.channel = new NetChannel();

        this.channel.on(NetChannelEvent.Receive, this.onMessage.bind(this));
        this.channel.initialize(socket);
    }

    onMessage(msg: Uint8Array) {
        // @HACK: Assume it's a usercommand
        this.userCommands.receive(msg);
    }
}