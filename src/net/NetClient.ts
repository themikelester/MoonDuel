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
    lastTransmittedFrame: number = -1;
    lastAcknowedgedFrame: number = -1;

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
        assert(frame === cmd.frame);
        this.userCommands.setUserCommand(cmd);

        // Construct the message
        let size = 5;
        this.msgBuffer[0] = 1; // Client frame
        this.msgView.setUint32(1, frame); // Frame number

        // Send all unacknowledged user commands 
        // @TODO: This could be smarter, we really only need to send the user commands that the server can still use
        const oldestCmdFrame = Math.max(this.lastAcknowedgedFrame, frame - 5, 0);
        for (let i = frame; i >= oldestCmdFrame; i--) {
            const cmd = this.userCommands.getUserCommand(i);
            if (!defined(cmd)) break;

            assert(cmd.frame === i);
            
            const byteLength = UserCommand.serialize(this.msgBuffer.subarray(size + 1), cmd);
            assert(byteLength < 256);
            this.msgBuffer[size] = byteLength; // The serialized length precedes the data
            size += 1 + byteLength;
        }

        this.channel.send(this.msgBuffer.subarray(0, size), frame);
        this.lastTransmittedFrame = frame;

        // @TODO: Send all unacknowledged user commands that are still buffered
    }

    receiveClientFrame(msg: Uint8Array) {
        if (msg.byteLength <= 5) {
            return;
        }

        const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
        const frame = view.getUint32(1);

        for (let offset = 5; offset < msg.byteLength;) {
            const size = view.getUint8(offset);
            offset += 1;

            const cmd = {} as UserCommand;
            const read = UserCommand.deserialize(cmd, msg.subarray(offset, offset + size));
            offset += read;
            
            // If we haven't already received this command, buffer it
            const newlySet = this.userCommands.setUserCommand(cmd);

            if (newlySet) {
                if (this.graphPanel) { 
                    const received = (frame === cmd.frame) ? NetGraphPacketStatus.Received : NetGraphPacketStatus.Filled;
                    const status = (frame <= this.lastRequestedFrame) ? NetGraphPacketStatus.Late : received;
                    this.graphPanel.setPacketStatus(cmd.frame, status); 
                }
            }
        }

        this.lastReceivedFrame = frame;
    }

    transmitServerFrame(snap: Snapshot) {
        this.msgBuffer[0] = 0; // Server frame

        // Buffer the state so that we can delta-compare later
        this.snapshot.setSnapshot(snap);

        // Send the latest state
        const snapSize = Snapshot.serialize(this.msgBuffer.subarray(1), snap);

        this.channel.send(this.msgBuffer.subarray(0, snapSize + 1), snap.frame);
        this.lastTransmittedFrame = snap.frame;
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

        return assertDefined(cmd);
    }

    onMessage(msg: Uint8Array, lastAcknowledgedFrame: number | undefined) {
        this.ping = this.channel.ping;
        
        if (defined(lastAcknowledgedFrame)) {
            this.lastAcknowedgedFrame = lastAcknowledgedFrame;
        }
        
        if (msg[0] === 0) this.receiveServerFrame(msg);
        else this.receiveClientFrame(msg);

        this.fire(NetClientEvents.Message, msg);
    }
}