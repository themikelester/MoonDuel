import { NetChannel, NetChannelEvent } from "./NetChannel";
import { assert, defined, assertDefined } from "../util";
import { WebUdpSocket, WebUdpEvent } from "./WebUdp";
import { UserCommandBuffer, UserCommand } from "../UserCommand";
import { EventDispatcher } from "../EventDispatcher";
import { ClientId } from "./SignalSocket";
import { SnapshotManager, Snapshot } from "../Snapshot";
import { kPacketMaxPayloadSize, AckInfo, Msg, MsgBuf } from "./NetPacket";
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
    lastAcknowledgedFrame: number = -1;

    channel: NetChannel;

    private snapshot: SnapshotManager = new SnapshotManager();
    private userCommands: UserCommandBuffer = new UserCommandBuffer();

    private msgBuf = MsgBuf.create(new Uint8Array(kPacketMaxPayloadSize));

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
        const buf = MsgBuf.clear(this.msgBuf);
        Msg.writeChar(buf, 1); // Client frame
        Msg.writeInt(buf, frame); // Frame number

        // Send all unacknowledged user commands 
        // @TODO: This could be smarter, we really only need to send the user commands that the server can still use
        const oldestCmdFrame = Math.max(this.lastAcknowledgedFrame, frame - 5, 0);
        for (let i = frame; i >= oldestCmdFrame; i--) {
            const cmd = this.userCommands.getUserCommand(i);
            if (!defined(cmd)) break;

            assert(cmd.frame === i);

            UserCommand.serialize(buf, cmd);
        }

        this.channel.send(buf.data.subarray(0, buf.offset), frame);
        this.lastTransmittedFrame = frame;

        this.channel.computeStats();
    }

    receiveClientFrame(msg: Uint8Array) {
        if (msg.byteLength <= 5) {
            return;
        }

        const buf = MsgBuf.create(msg);
        Msg.skip(buf, 1);
        const frame = Msg.readInt(buf);

        for (let i = 0; buf.offset < buf.data.byteLength; i++) {
            const cmd = {} as UserCommand;
            UserCommand.deserialize(cmd, buf);

            cmd.frame = frame - i;

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
        // Buffer the state so that we can delta-compare later
        this.snapshot.setSnapshot(snap);

        const buf = MsgBuf.clear(this.msgBuf);
        Msg.writeByte(buf, 0); // Server frame

        // Send the latest state
        Snapshot.serialize(buf, snap);

        this.channel.send(buf.data.subarray(0, buf.offset), snap.frame);
        this.lastTransmittedFrame = snap.frame;

        this.channel.computeStats();
    }

    receiveServerFrame(msg: Uint8Array) {
        if (msg.byteLength > 1) {
            const buf = MsgBuf.create(msg);
            Msg.skip(buf, 1);

            const snap = new Snapshot();
            Snapshot.deserialize(buf, snap);
            this.snapshot.setSnapshot(snap);

            this.lastReceivedFrame = snap.frame;

            if (this.graphPanel) {
                // Mark non-received frames between the last requested and now as filled
                // @NOTE: If they come later (but before they're requested) they can still mark themselves as received
                for (let i = this.lastRequestedFrame + 1; i < snap.frame; i++) {
                    if (!this.snapshot.hasSnapshot(i)) this.graphPanel.setPacketStatus(i, NetGraphPacketStatus.Filled);
                }

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

    onMessage(msg: Uint8Array, lastAcknowledged?: AckInfo) {
        this.ping = this.channel.ping;

        if (defined(lastAcknowledged)) {
            this.lastAcknowledgedFrame = lastAcknowledged.tag;
        }

        if (msg[0] === 0) this.receiveServerFrame(msg);
        else this.receiveClientFrame(msg);

        this.fire(NetClientEvents.Message, msg, lastAcknowledged);
    }
}