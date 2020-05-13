import { EventDispatcher } from "../EventDispatcher";
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";
import { assert, assertDefined, defined } from "../util";
import { IS_DEVELOPMENT } from "../version";

export enum WebUdpEvent {
    Open = "open",
    Close = "close",
    Message = "message",
};

interface ClientOffer {
    offer: RTCSessionDescriptionInit,
}

interface ClientAnswer {
    answer: RTCSessionDescriptionInit,
}

export class WebUdpSocketFactory extends EventDispatcher {
    signalSocket: SignalSocket;
    iceServers: RTCConfiguration;

    constructor(signalSocket: SignalSocket) {
        super();
        this.signalSocket = signalSocket;
    }

    async listen(onNewConnectionCallback: (socket: WebUdpSocket) => void) {
        this.signalSocket.on(SignalSocketEvents.Message, this.onMessage.bind(this, onNewConnectionCallback));
        this.iceServers = await this.signalSocket.requestIceServers();
    }

    async onMessage(callback: (socket: WebUdpSocket) => void, msg: ClientOffer, from: ClientId) {
        console.debug('WebUDP: Received message', msg);
        assertDefined(msg.offer, 'Expected an offer');

        // Spawn a new WebUdpSocket for each offer received
        const socket = new WebUdpSocket();
        socket.accept(this.signalSocket, msg, from);
        callback(socket);
    }
}

export class WebUdpSocket extends EventDispatcher {
    clientId: ClientId;
    peerId: ClientId;

    peer: Nullable<RTCPeerConnection>;
    channel: Nullable<RTCDataChannel>;

    get isOpen() {
        return this.channel && this.channel.readyState === 'open';
    }

    /**
     * Attempt to initiate a WebRTC connection with a peer via the signal server.
     * @NOTE: The peer must already be listening for offers. See WebUdpSocketFactory.
     * @param peerId the peer's ClientID
     */
    connect(peerId: string): Promise<any> {
        assert(!defined(this.peer), 'WebUdpSocket.connect/listen() may only be called once');

        this.peerId = peerId;

        // Connect to the signal server 
        const signalSocket = new SignalSocket();
        const connectedToSignalServer = signalSocket.connect().then(() => {
            this.clientId = signalSocket.clientId
        });

        // Begin the WebRTC handshake
        connectedToSignalServer.then(async () => {
            // Don't ping any STUN/TURN servers during development
            const iceServers = IS_DEVELOPMENT ? {} : await signalSocket.requestIceServers();
    
            this.peer = this.createPeer(iceServers);
            
            // Watch for any important changes on the WebRTC connection
            this.peer.onconnectionstatechange = () => {
                switch(this.peer!.connectionState) {
                    case "connected": break;
                    case "disconnected": break;
                    case "failed": this.close(); break;
                    case "closed": this.close(); break;
                  }
            };
    
            // Start pinging STUN/TURN servers to generate ICE candidates
            const iceCandidatesPromise = this.getIceCandidates();
    
            // But if we're the "local", we create the data channel
            const channel = this.peer.createDataChannel('webudp', {
                ordered: false,
                maxRetransmits: 0,
            });
            this.setDataChannel(channel);
    
            // And initiate the connection by creating and sending an offer
            const rtcOffer = await this.peer.createOffer();
            await this.peer.setLocalDescription(rtcOffer);
    
            // Wait for all ICE candidates to be created
            await iceCandidatesPromise;
    
            // Send the SDP and ICE candidates in one message
            const offer: ClientOffer = { offer: assertDefined(this.peer.localDescription) };
            signalSocket.send(this.peerId, offer);
    
            signalSocket.once(SignalSocketEvents.Message, (msg: ClientAnswer, from: ClientId) => {
                const answer = assertDefined(msg.answer, 'Expected "answer" message from remote peer');
                console.debug('WebUDP: Received answer', msg.answer);
    
                // Accept the answer
                this.peer!.setRemoteDescription(msg.answer);
    
                // @TODO: Also close after timeout, or on error
                signalSocket.close();
            });
        });

        return connectedToSignalServer;
    }

    /**
     * Accept an offer from a peer, and reply with an answer. If the peer accepts, This WebUdpSocket will open. 
     * This is intended to be called by WebUdpSocketFactory when it receives an offer from the signaling server.
     */
    async accept(signalSocket: SignalSocket, offer: ClientOffer, peerId: string) {
        assert(!defined(this.peer), 'WebUdpSocket.connect/listen() may only be called once');

        this.peerId = peerId;
        this.clientId = signalSocket.clientId;

        // @TODO: This only needs to happen once on the server
        const iceServers = IS_DEVELOPMENT ? {} : await signalSocket.requestIceServers();

        this.peer = this.createPeer(iceServers);

        // Start pinging STUN/TURN servers to generate ICE candidates
        const iceCandidatesPromise = this.getIceCandidates();

        // Construct an answer and send it back to our peer via the signal server
        await this.peer.setRemoteDescription(offer.offer);
        const answer = await this.peer.createAnswer();
        this.peer.setLocalDescription(answer);

        // Wait for all of our ICE candidates to generate, then send them back with the answer
        await iceCandidatesPromise;
        signalSocket.send(this.peerId, { answer: this.peer.localDescription });

        // Once the remote accepts the answer, WebRTC will construct the data channel and we'll be good to go
        this.peer.ondatachannel = evt => {
            this.setDataChannel(evt.channel);
        }
    }

    send(data: string | Blob | ArrayBuffer | ArrayBufferView): boolean {
        if (this.channel && this.isOpen) {
            this.channel.send(data as any);
            return true;
        }

        return false;
    };

    close() {
        if (defined(this.peer)) {
            this.fire(WebUdpEvent.Close);

            // Close the RTCDataChannel
            if (this.channel) this.channel.close();

            // Close the RTCPeerConnection
            if (this.peer) this.peer.close();

            // ... and set clear references to avoid reuse
            this.peer = null;
            this.channel = null;
        }
    };

    private createPeer(config: RTCConfiguration) {
        return new RTCPeerConnection(config);
    }

    private onDataChannelOpen() {
        console.debug('WebUDP: DataChannel open'); 

        this.fire(WebUdpEvent.Open); 
    }

    private onDataChannelClosed() {
        console.debug('WebUDP: DataChannel closed'); 
        this.close();
    }

    private onDataChannelError(evt: RTCErrorEvent) {
        // Chrome appears to send errors if the RTCPeerConnection is closed immediately after the RTCDataChannel. 
        // It sends an 'RTCError: Transport channel closed' just before the close event. Ignore it.
        if (this.channel?.readyState !== 'closed') {
            console.error("WebUdpPeer: Data channel error:", evt.error);
        }
    }

    private setDataChannel(dataChannel: RTCDataChannel) {
        dataChannel.binaryType = 'arraybuffer';
        dataChannel.onopen = this.onDataChannelOpen.bind(this);
        dataChannel.onclose = this.onDataChannelClosed.bind(this);
        dataChannel.onerror = this.onDataChannelError.bind(this);
        dataChannel.onmessage = msg => { this.fire(WebUdpEvent.Message, msg); }
        this.channel = dataChannel;
    }

    private getIceCandidates(): Promise<RTCIceCandidate[]> {
        return new Promise(resolve => {
            const candidates: RTCIceCandidate[] = [];
            this.peer!.onicecandidate = evt => {
                if (evt.candidate) {
                    console.debug('WebUDP: Received ICE candidate', evt.candidate);
                    candidates.push(evt.candidate);
                } else {
                    console.debug('WebUDP: Received all ICE candidates');
                    resolve(candidates);
                }
            };
        })
    }
}