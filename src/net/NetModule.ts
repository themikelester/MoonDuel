import { NetClient, NetClientEvent } from "./NetClient";
import { kPacketMaxPayloadSize } from "./NetPacket";
import { NetSchemas } from './schemas/schemas_generated';
import { flatbuffers } from 'flatbuffers';
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";
import { WebUdpSocket } from "./WebUdp";

const kPort = 8888;
const kServerAddress = window.location.protocol + "//" + window.location.hostname + ":" + kPort;

export class NetModule {
    signalSocket: SignalSocket = new SignalSocket();
    isServer: boolean;

    netClients: NetClient[] = [];

    messageId = 0;
    builder = new flatbuffers.Builder(kPacketMaxPayloadSize);

    initialize() {
        // Connect to the signalling server
        this.signalSocket.connect(kServerAddress, 'default');
        
        this.signalSocket.on(SignalSocketEvents.JoinedRoom, () => {
            this.isServer = this.signalSocket.serverId === this.signalSocket.clientId;
            
            if (!this.isServer) {
                // Establish a WebUDP connection with the server
                const server = new NetClient();
                const socket = new WebUdpSocket();

                socket.connect(this.signalSocket, this.signalSocket.serverId);
                server.initialize(socket);
                server.on(NetClientEvent.Receive, (data: any) => {
                    console.log('Received', data);
                });

                this.netClients = [server];
            }

            if (this.isServer) {
                this.signalSocket.on(SignalSocketEvents.ClientJoined, (clientId: ClientId) => {
                    // Create a new client and listen for it to connect
                    const client = new NetClient();
                    const socket = new WebUdpSocket();

                    socket.connect(this.signalSocket, clientId);
                    client.initialize(socket);

                    this.netClients.push(client);
                })
            }
        });
    }

    update() {
        // Send a heartbeat at 60hz
        NetSchemas.Heartbeat.startHeartbeat(this.builder);
        const heartbeat = NetSchemas.Heartbeat.endHeartbeat(this.builder);
        const message = NetSchemas.Message.createMessage(this.builder, this.messageId++, NetSchemas.Data.Heartbeat, heartbeat);
        this.builder.finish(message);
        this.broadcast(this.builder.asUint8Array());
        this.builder.clear();
    }
    
    private broadcast(data: Uint8Array) {
        for (const client of this.netClients) {
            client.send(data);
        }
    }
}