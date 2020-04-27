import { NetChannel, NetChannelEvent } from "./NetChannel";
import { assert, defined, assertDefined } from "../util";
import { WebUdpSocket, WebUdpEvent } from "./WebUdp";
import { UserCommandBuffer, UserCommand } from "../UserCommand";
import { EventDispatcher } from "../EventDispatcher";
import { ClientId } from "./SignalSocket";
import { SnapshotManager, Snapshot } from "../Snapshot";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetGraph, NetGraphPacketStatus, NetGraphPanel } from "./NetDebug";

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

    ping?: number = -1;
    lastRequestedFrame: number = -1;
    lastReceivedFrame: number = -1;

    channel: NetChannel;

    private snapshot: SnapshotManager = new SnapshotManager();
    private userCommands: UserCommandBuffer = new UserCommandBuffer();
    
    private msgBuffer = new Uint8Array(kPacketMaxPayloadSize);
    private msgView = new DataView(this.msgBuffer.buffer);
    
    // Debugging
    graphPanel?: NetGraphPanel;

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

    setNetGraphPanel(graphPanel: NetGraphPanel) {
        this.graphPanel = graphPanel;
    }

    transmitClientFrame(frame: number, cmd: UserCommand) {
        // Buffer this frame's command so that we can retransmit if it is dropped
        this.userCommands.setUserCommand(frame, cmd);

        // Construct the message
        this.msgBuffer[0] = 1; // Client frame
        this.msgView.setUint32(1, frame); // Frame number
        const size = UserCommand.serialize(this.msgBuffer.subarray(5), cmd);

        this.channel.send(this.msgBuffer.subarray(0, size + 5));

        // @TODO: Send all unacknowledged user commands that are still buffered
    }

    receiveClientFrame(msg: Uint8Array) {
        if (msg.byteLength <= 5) {
            return;
        }

        const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
        const frame = view.getUint32(1);
        const cmd = UserCommand.deserialize(msg.subarray(5));
        this.userCommands.setUserCommand(frame, cmd);

        this.lastReceivedFrame = frame;

        if (this.graphPanel) { 
            const status = (frame <= this.lastRequestedFrame) ? NetGraphPacketStatus.Late : NetGraphPacketStatus.Received;
            this.graphPanel.setPacketStatus(frame, status); 
        }
    }

    transmitServerFrame(snap: Snapshot) {
        this.msgBuffer[0] = 0; // Server frame

        // Buffer the state so that we can delta-compare later
        this.snapshot.setSnapshot(snap);

        // Send the latest state
        const snapSize = Snapshot.serialize(this.msgBuffer.subarray(1), snap);

        this.channel.send(this.msgBuffer.subarray(0, snapSize + 1));
    }

    receiveServerFrame(msg: Uint8Array) {
        if (msg.byteLength > 1) {
            const snap = Snapshot.deserialize(msg.subarray(1));
            this.snapshot.setSnapshot(snap);

            this.lastReceivedFrame = snap.frame;

            if (this.graphPanel) { 
                const status = (snap.frame <= this.lastRequestedFrame) ? NetGraphPacketStatus.Late : NetGraphPacketStatus.Received;
                this.graphPanel.setPacketStatus(snap.frame, status); 
            }
        }
    }

    getSnapshot(frame: number, dst: Snapshot) {
        this.lastRequestedFrame = Math.ceil(frame);
        return this.snapshot.lerpSnapshot(frame, dst);
    }

    getUserCommand(frame: number) {
        this.lastRequestedFrame = frame;
        let cmd = this.userCommands.getUserCommand(frame);

        // If we have not yet received an input for this frame, complain, and use the most recent
        if (!defined(cmd)) {
            console.warn(`Client ${this.id} missing input for frame ${frame}`);
            cmd = this.userCommands.getUserCommand();
        }

        assertDefined(cmd);
        return cmd;
    }

    onMessage(msg: Uint8Array) {
        this.ping = this.channel.ping;
        
        if (msg[0] === 0) this.receiveServerFrame(msg);
        else this.receiveClientFrame(msg);

        this.fire(NetClientEvents.Message, msg);
    }
}