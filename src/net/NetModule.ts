import { NetClient, NetClientEvent } from "./NetClient";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetSchemas } from './schemas/schemas_generated';
import { flatbuffers } from 'flatbuffers';

let kPort = 9555;

export class NetModule {
    netClient: NetClient;

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize() {
        this.netClient = new NetClient();
        this.netClient.on(NetClientEvent.Connect, this.onConnect.bind(this));
        this.netClient.on(NetClientEvent.Receive, this.onReceive.bind(this));

        // @TODO: A real way of choosing a server location
        this.netClient.initialize(window.location.protocol + "//" + window.location.hostname + ":" + kPort);
    }

    update() {
        // Send a heartbeat at 60hz
        NetSchemas.Heartbeat.startHeartbeat(this.builder);
        const heartbeat = NetSchemas.Heartbeat.endHeartbeat(this.builder);
        const message = NetSchemas.Message.createMessage(this.builder, this.messageId++, NetSchemas.Data.Heartbeat, heartbeat);
        this.builder.finish(message);
        this.netClient.send(this.builder.asUint8Array());
        this.builder.clear();
    }

    /**
     * Called when we first establish a WebUDP/NetClient connection to the server
     */
    onConnect() {
        console.debug('NetModule: Connected to server');
    }
    
    /**
     * Called when we receive a message from the server
     */
    onReceive(data: Uint8Array) {
        const buf = new flatbuffers.ByteBuffer(data);
        const payload = NetSchemas.Message.getRootAsMessage(buf);
        console.log(`MessageID: ${payload.messageId()}`);
    }
}