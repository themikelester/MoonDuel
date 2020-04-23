import * as socketio from 'socket.io-client';
import { EventDispatcher } from '../EventDispatcher';

export type ClientId = string;

export enum SignalSocketEvents {
    JoinedRoom = 'joined',
    ClientJoined = 'clientjoin',
    Message = 'message',
    RoomMessage = 'roomMessage',
}

interface ClientDetails {
    id: ClientId,
    room: string,
}

interface RoomDetails {
    name: string,
    server: ClientId,
    clients: Record<ClientId, ClientDetails>;
}

interface ClientMessage {
    to: ClientId,
    from: ClientId,
    data: any,
}

interface RoomMessage {
    from: ClientId,
    data: any,
}

const kPort = 8888;
const kServerAddress = window.location.protocol + "//" + window.location.hostname + ":" + kPort;

/**
 * Represents a persistent connection to the signalling server, via websocket. 
 * WebUDP connections are established (via WebRTC) by talking to peers through this server.
 */
export class SignalSocket extends EventDispatcher {
    private room: RoomDetails;
    private socket: SocketIOClient.Socket;

    /**
     * Establish a connection to the server, and join a specific room
     * @param address URL of the server
     * @param roomName Room to join
     */
    connect(address: string = kServerAddress) {
        return new Promise(resolve => {
            this.socket = socketio.connect(address);

            this.socket.on('connect', () => {
                console.debug('SignalSocket: Connected to MoonBeacon with ID:', this.socket.id);
            });

            this.socket.on('roomJoined', (details: RoomDetails) => {
                console.debug('SignalSocket: Joined room:', details);
                this.room = details;
                resolve();
            });

            this.socket.on('clientJoined', (client: ClientDetails) => {
                console.debug('SignalSocket: Client joined:', client);
                this.room.clients[client.id] = client;
                this.fire(SignalSocketEvents.ClientJoined, client.id);
            });

            this.socket.on('clientLeaving', (clientId: ClientId, reason: string) => {
                console.debug('SignalSocket: Client left:', clientId);
                delete this.room.clients[clientId];
            });

            this.socket.on('message', (msg: ClientMessage) => {
                console.debug('SignalSocket: Message received', msg);
                this.fire(SignalSocketEvents.Message, msg.data, msg.from);
            });

            this.socket.on('messageRoom', (msg: RoomMessage) => {
                this.fire(SignalSocketEvents.RoomMessage, msg.data, msg.from);
            });
        });
    }

    /**
     * Send a message to a specific client in the room
     * @param to Id of the client to target
     * @param data The message payload
     */
    send(to: ClientId, data: Object) {
        const msg: ClientMessage = {
            from: this.clientId,
            to,
            data,
        };

        console.debug('SignalSocket: Sending message', msg);
        this.socket.emit('message', msg);
    }

    /**
     * Send a message to every client in the room
     * @param data The message payload
     */
    broadcast(data: Object) {
        const msg: RoomMessage = {
            from: this.clientId,
            data,
        };

        this.socket.emit('messageRoom', msg);
    }
    
    /**
     * Get the STUN and TURN servers that should be used during the WebRTC handshake.
     * The returned objet can be passed directly to the RTCPeerConnection constructor.
     */
    requestIceServers(): Promise<RTCConfiguration> {
        return new Promise((resolve, reject) => {
            this.socket.emit('iceServers', (iceServers: RTCIceServer[]) => {
                resolve({ iceServers });
            });
        });
    }

    close() {
        this.socket.close();
    }

    /**
     * Get the ClientIDs of all other clients in the room.
     */
    get clients() {
        return Object.keys(this.room.clients);
    }

    /**
     * Get the ClientID that has been designated as the server. 
     * @NOTE: This may be our own ClientID, which means we are the server
     */
    get serverId() {
        return this.room.server;
    }

    /**
     * Get our ClientId (messages sent to this ID will be delivered to us)
     */
    get clientId() {
        return this.socket.id;
    }
}
