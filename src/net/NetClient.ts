import { NetChannel, NetChannelEvent, AckInfo } from "./NetChannel";
import { assert, defined, assertDefined, defaultValue } from "../util";
import { WebUdpSocket, WebUdpEvent } from "./WebUdp";
import { UserCommandBuffer, UserCommand, kEmptyCommand } from "../UserCommand";
import { EventDispatcher } from "../EventDispatcher";
import { ClientId } from "./SignalSocket";
import { SnapshotManager, Snapshot } from "../Snapshot";
import { NetGraphPacketStatus, NetGraphPanel, NetClientStats, NetClientStat } from "./NetDebug";
import { Buf } from "../Buf";
import { clamp, lerp } from "../MathHelpers";
import { Clock } from "../Clock";

export enum NetClientState {
    Free, 
    Disconnected, // We were connected, but it has been closed
    Connected,    // Socket is open, but no frames received
    Active,       // A frame has been received from the peer
    Background,   // We're still active, but running with reduced resources

    // The Quake 3 Arena states:
    // CS_FREE,		// can be reused for a new connection
    // CS_ZOMBIE,		// client has been disconnected, but don't reuse
    // 				// connection for a couple seconds
    // CS_CONNECTED,	// has been assigned to a client_t, but no gamestate yet
    // CS_PRIMED,		// gamestate has been sent, but client hasn't sent a usercmd
    // CS_ACTIVE		// client is fully in game
}

export enum NetClientEvents {
    Connected = 'con',
    Disconnected = 'dis',
    ServerTimeAdjust = 'stime',
    ReceiveServerFrame = 'rsf',
}

enum MsgId {
    ServerFrame = 0,
    ClientFrame = 1,
    VisChange = 2,

    _Count
}

const kMsgIdMask  = 0b00000111;
const kParityShift = 3;

assert((kMsgIdMask+1) >= MsgId._Count, "Don't forget to update the bitmask!");

/**
 * Send messages that will be sent repeatedly until acknowledged. Only one message may be in flight at a time.
 * @NOTE: This means that reliable messages will be sent AT MOST once every round-trip-time ms.
 */
class ReliableMessageManager {
    private buffer: Uint8Array[] = [];
    private sendTag?: number;
    private sendParity = 0;
    private recvParity = 0;

    getMessageForTransmission(tag: number) {
        if (this.buffer.length <= 0) return undefined;
        
        // Store the frame at which we're first sending this reliable message...
        if (!defined(this.sendTag)) { this.sendTag = tag; }

        return this.buffer[0];
    }

    ack(frame: number) {
        // ... If we get an ack for any frame after we send the message, it was received
        if (defined(this.sendTag) && Math.abs(frame) >= this.sendTag) {
            this.buffer.shift();
            this.sendTag = undefined;
        }
    }

    send(data: Uint8Array) {
        // The parity bit is toggle each transmission so that the receiver can detect duplicates
        data[0] |= (this.sendParity & 1) << kParityShift;
        this.sendParity ^= 1; 
        
        // Buffer the message until next transmit
        this.buffer.push(data);
    }

    receive(buf: Buf) {
        const idByte = Buf.peekByte(buf);

        // If we've already received this reliable message, ignore
        const parity = (idByte >> kParityShift) & 1;
        const alreadyReceived = parity != this.recvParity;
        if (!alreadyReceived) {
            this.recvParity ^= 1;
        }

        return alreadyReceived;
    }
}

export class NetClient extends EventDispatcher {
    id: string;
    state: NetClientState = NetClientState.Free;

    lastRequestedFrame: number = -1;
    lastReceivedFrame: number = -1;
    lastTransmittedFrame: number = -1;
    lastAcknowledgedFrame: number = -1;

    lastReceivedTime: number = -1;

    channel: NetChannel;
    stats: NetClientStats = new NetClientStats();
    get ping() { return this.stats.minMaxAve[NetClientStat.Ping][2]; }

    private snapshot: SnapshotManager = new SnapshotManager();
    private userCommands: UserCommandBuffer = new UserCommandBuffer();
    
    private fastestAck?: AckInfo;

    private reliable = new ReliableMessageManager();

    // Debugging
    graphPanel?: NetGraphPanel;
    
    constructor(private clock: Clock) {
        super();
    }

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
        this.channel.on(NetChannelEvent.Acknowledge, this.onAck.bind(this));
        this.channel.initialize(socket);

        this.stats.initialize();
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

    close() {
        this.state = NetClientState.Disconnected;
        this.channel.close();
    }

    setNetGraphPanel(graphPanel: NetGraphPanel) {
        this.graphPanel = graphPanel;
    }

    /**
     * Transmit only reliable messages. No frame data will be included. This is intended to be called when the main
     * client loop is not running so that reliable messages can be flushed.
     * @param index This must increase each time this function is called.
     */
    transmitReliable(index: number) {
        // The absolute value of tag must increase monotinically, including the lastTransmittedFrame,
        // so that the reliable layer can properly detect reception. It must be negative to avoid 
        // increasing lastAcknowledgedFrame on ack.
        const tag = -(this.lastTransmittedFrame + 1 + index);

        // If there are no more reliable messages, we're done
        const reliableMsg = this.reliable.getMessageForTransmission(tag);
        if (!reliableMsg) {
            return true;
        }

        console.debug('Transmitting reliable message');

        // Send the message
        const buf = this.channel.allocatePacket();
        buf.write(reliableMsg);
        this.channel.send(buf, tag);

        return false;
    }

    transmitClientFrame(frame: number, cmd: UserCommand) {
        // Buffer this frame's command so that we can retransmit if it is dropped
        assert(frame === cmd.frame);
        this.userCommands.setUserCommand(cmd);

        // Construct the message
        const buf = this.channel.allocatePacket();

        // Write any reliable messages
        const reliableMsg = this.reliable.getMessageForTransmission(frame);
        if (reliableMsg) buf.write(reliableMsg);

        // Write the user commands
        this.sendClientFrame(buf, frame, cmd);

        this.channel.send(buf, frame);
        this.lastTransmittedFrame = frame;

        this.channel.computeStats();
    }

    sendClientFrame(buf: Buf, frame: number, cmd: UserCommand) {
        let idByte = MsgId.ClientFrame;
        let cmdCount = 0;

        const idByteOffset = Buf.writeChar(buf, idByte); // Client frame
        Buf.writeInt(buf, frame); // Frame number

        // Send all unacknowledged user commands 
        // @TODO: This could be smarter, we really only need to send the user commands that the server can still use
        const oldestCmdFrame = Math.max(this.lastAcknowledgedFrame, frame - 5, 0);
        for (let i = frame; i >= oldestCmdFrame; i--) {
            const cmd = this.userCommands.getUserCommand(i);
            if (!defined(cmd)) break;

            assert(cmd.frame === i);

            cmdCount += 1;
            UserCommand.serialize(buf, cmd);
        }

        // Use the upper nibble of the ID byte to store the command count
        idByte |= cmdCount << 4;
        buf.data[idByteOffset] = idByte;
    }

    receiveClientFrame(msg: Buf, receiveTime: number) {
        const count = Buf.readByte(msg) >> 4;
        const frame = Buf.readInt(msg);

        for (let i = 0; i < count; i++) {
            const cmd = {} as UserCommand;
            UserCommand.deserialize(cmd, msg);

            cmd.frame = frame - i;

            // If we haven't already received this command, buffer it
            const newlySet = this.userCommands.setUserCommand(cmd);

            if (newlySet) {
                if (this.graphPanel) {
                    const received = (i === 0) ? NetGraphPacketStatus.Received : NetGraphPacketStatus.Filled;
                    const status = (cmd.frame <= this.lastRequestedFrame) ? NetGraphPacketStatus.Late : received;
                    this.graphPanel.setPacketStatus(cmd.frame, status);
                }
            }
        }

        this.lastReceivedFrame = frame;
        this.lastReceivedTime = receiveTime;
    }

    transmitServerFrame(snap: Snapshot) {
        // Buffer the state so that we can delta-compare later
        this.snapshot.setSnapshot(snap);

        // Let the client know how many frames ahead (or behind) it is
        const frameDiff = this.lastReceivedFrame - this.lastRequestedFrame;

        const buf = this.channel.allocatePacket();
        
        // Pass the frameDiff as a signed 4-bit in the upper nibble of the idByte
        let idByte = MsgId.ServerFrame;
        idByte |= (clamp(frameDiff, -8, 7) & 0b1111) << 4;
        Buf.writeByte(buf, idByte);

        // Write the time that this server held on to the latest acknowledged packet
        // This is used to compute the difference between ping (just transit time) and RTT (full round trip time)
        const procTime = this.lastReceivedTime > 0 ? performance.now() - this.lastReceivedTime : 0;
        const procByte = clamp(Math.round(procTime / this.clock.simDt * 255), 0, 255); // @TODO: Func for encoding fixed precision floats
        Buf.writeByte(buf, procByte);

        // Encode the time it took to simulate this frame, as well as the current server time. 
        // Current server time is computed as `frame * simDt + framePhase + frameCompTime`
        const currentTime = this.clock.getCurrentServerTime();
        const frameCompTime = currentTime - this.clock.serverTime;
        const framePhase = this.clock.serverTime - this.clock.simDt * snap.frame;
        Buf.writeByte(buf, clamp(Math.round(framePhase / this.clock.simDt * 255), 0, 255));
        Buf.writeByte(buf, clamp(Math.round(frameCompTime / this.clock.simDt * 255), 0, 255));
    
        // Send the latest state
        Snapshot.serialize(buf, snap);

        this.channel.send(buf, snap.frame);
        this.lastTransmittedFrame = snap.frame;

        this.channel.computeStats();
    }

    receiveServerFrame(msg: Buf, latestAck: AckInfo) {
        const idByte = Buf.readByte(msg);
        const frameNibble = (idByte >> 4);
        const frameDiff = (frameNibble >> 3) ? (0xFFFFFFF0 | frameNibble) : frameNibble;

        const procByte = Buf.readByte(msg);
        const procTime = procByte / 255 * this.clock.simDt;
        const ping = (latestAck && procByte > 0) ? latestAck.rttTime - procTime : undefined;

        const serverPhase = Buf.readByte(msg) / 255 * this.clock.simDt;
        const compTime = Buf.readByte(msg) / 255 * this.clock.simDt;

        const snap = new Snapshot();
        Snapshot.deserialize(msg, snap);
        this.snapshot.setSnapshot(snap);

        this.lastReceivedFrame = snap.frame;

        // Compute server time based on the packet with the lowest RTT, which should yield the most accurate result
        if (ping && (!this.fastestAck || latestAck.rttTime < this.fastestAck.rttTime)) {
            this.fastestAck = latestAck;

            const serverTimeFromPacket = snap.frame * this.clock.simDt + serverPhase + compTime;
            const serverTime = serverTimeFromPacket + ping * 0.5;
            this.fire(NetClientEvents.ServerTimeAdjust, serverTime);
        }

        this.stats.onReceiveFrame(ping, compTime);

        if (this.graphPanel) {
            // Mark non-received frames between the last requested and now as filled
            // @NOTE: If they come later (but before they're requested) they can still mark themselves as received
            for (let i = this.lastRequestedFrame + 1; i < snap.frame; i++) {
                if (!this.snapshot.hasSnapshot(i)) this.graphPanel.setPacketStatus(i, NetGraphPacketStatus.Filled);
            }

            const status = (snap.frame <= this.lastRequestedFrame) ? NetGraphPacketStatus.Late : NetGraphPacketStatus.Received;
            this.graphPanel.setPacketStatus(snap.frame, status);
        }
        
        this.fire(NetClientEvents.ReceiveServerFrame, frameDiff, snap);
    }
    
    transmitVisibilityChange(visible: boolean) {
        let bits = 0;
        if (visible) bits |= 0xF0;
        bits |= MsgId.VisChange & kMsgIdMask;

        const data = new Uint8Array([bits]); 
        this.reliable.send(data);
    }

    receiveVisibilityChange(msg: Buf) {
        const ignore = this.reliable.receive(msg);
        const visible = (Buf.readByte(msg) & ~kMsgIdMask) > 0;

        if (!ignore) {
            this.state = visible ? NetClientState.Active : NetClientState.Background;
            console.log(`[Client ${this.id}] Received new visibility status: ${visible ? 'visible' : 'hidden' }`);
        }
    }

    getSnapshot(frame: number, dst: Snapshot) {
        this.lastRequestedFrame = Math.ceil(frame);
        return this.snapshot.lerpSnapshot(frame, dst);
    }

    getUserCommand(frame: number) {
        this.lastRequestedFrame = frame;
        let cmd = this.userCommands.getUserCommand(frame);

        // If this client is backgrounded, we can't receive messages so always report empty commands 
        if (this.state === NetClientState.Background) {
            return kEmptyCommand;
        }

        // If we have not yet received an input for this frame, complain, and use the most recent
        if (!defined(cmd)) {
            console.warn(`[Client ${this.id}] Missing input for frame ${frame}`);
            cmd = this.userCommands.getUserCommand();
        }

        return assertDefined(cmd);
    }

    onAck(ack: AckInfo) {
        // If the tag is positive it represents a frame number
        // Otherwise this packet does not contain frame data
        if (ack.tag > 0) {
            const frame = ack.tag;
            if (frame > this.lastAcknowledgedFrame) {
                this.lastAcknowledgedFrame = frame;
            }
        }

        this.reliable.ack(ack.tag);
    }

    onMessage(msg: Buf, latestAck: AckInfo, receiveTime: number) {
        if (this.state === NetClientState.Connected) {
            this.state = NetClientState.Active;
        }

        while (msg.offset < msg.data.byteLength) {
            const idByte = Buf.peekByte(msg)
            const msgId = idByte & kMsgIdMask;
            let error = false;

            switch(msgId) {
                case MsgId.ServerFrame: this.receiveServerFrame(msg, latestAck); break;
                case MsgId.ClientFrame: this.receiveClientFrame(msg, receiveTime); break;
                case MsgId.VisChange: this.receiveVisibilityChange(msg); break;
                default: console.warn('Received unknown message. Ignoring.'); error = true; break; 
            }

            if (error) break;
        }
    }
}