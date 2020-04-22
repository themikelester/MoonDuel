import { NetChannel, NetChannelEvent } from "./NetChannel";
import { SignalSocket, ClientId } from "./SignalSocket";
import { assert } from "../util";
import { WebUdpSocket } from "./WebUdp";
import { UserCommandBuffer } from "../UserCommand";

enum NetClientState {
    Free,
    Connected,
}

export class NetClient {
    id: string;
    state: NetClientState = NetClientState.Free;

    ping: number = -1;
    rate: number = -1; // bytes per second

    channel: NetChannel;

    userCommands: UserCommandBuffer = new UserCommandBuffer();

    initialize(signalSocket: SignalSocket, clientId: ClientId) {
        assert(this.state === NetClientState.Free);
        this.id = clientId;

        this.channel = new NetChannel();
        const socket = new WebUdpSocket();

        socket.connect(signalSocket, clientId);
        this.channel.on(NetChannelEvent.Receive, this.onMessage.bind(this));
        this.channel.initialize(socket);
    }

    onMessage(msg: Uint8Array) {
        // @HACK: Assume it's a usercommand
        this.userCommands.receive(msg);
    }
}