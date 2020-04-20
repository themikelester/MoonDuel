import { EventDispatcher } from "../EventDispatcher";
import { SignalSocket, SignalSocketEvents, ClientId } from "./SignalSocket";

export enum WebUdpEvent {
    Open = "open",
    Close = "close",
    Message = "message",
};

interface ClientMessageData {
    offer?: RTCSessionDescriptionInit,
    answer?: RTCSessionDescriptionInit,
    iceCandidate?: RTCIceCandidate,
}

export class WebUdpSocket extends EventDispatcher {
    signalSocket: SignalSocket;
    peerId: ClientId;

    channel: RTCDataChannel;
    peer: RTCPeerConnection;
    isOpen: boolean = false;

    async connect(signalSocket: SignalSocket, peerId?: ClientId) {
        this.signalSocket = signalSocket;
        this.signalSocket.on(SignalSocketEvents.Message, this.onMessage.bind(this));

        this.peer = new RTCPeerConnection(signalSocket.iceServers);

        this.peer.onicecandidate = evt => {
            if (evt.candidate) {
                console.debug('WebUDP: Received ICE candidate', evt.candidate);
                signalSocket.send(this.peerId, { iceCandidate: evt.candidate });
            } else {
                console.debug('WebUDP: Received all ICE candidates');
            }
        };

        const channelOptions = {
            ordered: false,
            maxRetransmits: 0,
        };

        this.channel = this.peer.createDataChannel('webudp', channelOptions);
        this.channel.binaryType = 'arraybuffer';
        this.channel.onopen = () => { this.isOpen = true; this.fire(WebUdpEvent.Open); }
        this.channel.onclose = () => { this.isOpen = false; this.fire(WebUdpEvent.Close); }
        this.channel.onerror = evt => { console.error("WebUdpPeer: Data channel error", evt); }
        this.channel.onmessage = msg => {
            console.log('WebUDP: Received message', msg);
            this.fire(WebUdpEvent.Message, msg);
        }

        // If a peer is not specified, just listen for a connection
        if (peerId) {
            this.peerId = peerId;

            // Create our offer and send it to our peer via the signal server
            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);
            signalSocket.send(this.peerId, { offer });
        }
    }

    async onMessage(msg: ClientMessageData, from: ClientId) {
        // Ignore messages that are not from our peer 
        // (there may be multiple WebRTC handshakes in flight if we're the server)
        if (this.peerId && from !== this.peerId) {
            return;
        }

        console.debug('WebUDP: Received message', msg);

        if (msg.answer) {
            console.debug('WebUDP: Received answer', msg.answer);
            this.peer.setRemoteDescription(msg.answer);
        }

        // Construct an answer and send it back to our peer via the signal server
        if (msg.offer) {
            this.peerId = from;
            await this.peer.setRemoteDescription(msg.offer);
            const answer = await this.peer.createAnswer();
            this.peer.setLocalDescription(answer);
            this.signalSocket.send(this.peerId, { answer });
        }

        if (msg.iceCandidate) {
            this.peer.addIceCandidate(msg.iceCandidate);
        }
    }

    send(data: string | Blob | ArrayBuffer | ArrayBufferView): boolean {
        if (this.isOpen) {
            this.channel.send(data as any);
            return true;
        }

        return false;
    };

    close() {
        this.channel.close();
    };
}

export class WebUdpSocketServer extends EventDispatcher {
    address: string;
    isOpen: boolean = false;

    channel: RTCDataChannel;
    peer: RTCPeerConnection;

    constructor(address: string) {
        super();
        this.address = address;
    }

    async connect() {
        var socket = this;

        // @TODO: Pick more ICE servers? Support TURN?
        // @NOTE: Firefox requires a TURN server to work
        this.peer = new RTCPeerConnection({
            iceServers: [{
                urls: ["stun:stun.l.google.com:19302"]
            }]
        });

        this.peer.onicecandidate = function (evt) {
            if (evt.candidate) {
                console.debug("WebUDP: Received ice candidate", evt.candidate);
            } else {
                console.debug("WebUDP: All local candidates received");
            }
        };

        this.peer.ondatachannel = function (evt) {
            console.debug("WebUDP: Peer connection on data channel", evt);
        };

        this.channel = this.peer.createDataChannel("webudp", {
            ordered: false,
            maxRetransmits: 0
        });
        this.channel.binaryType = "arraybuffer";

        this.channel.onopen = function () {
            console.debug("WebUDP: Data channel ready");
            socket.isOpen = true;
            socket.fire(WebUdpEvent.Open);
        };

        this.channel.onclose = function () {
            socket.isOpen = false;
            console.debug("WebUDP: Data channel closed");
        };

        this.channel.onerror = function (evt) {
            console.error("WebUDP: Data channel error", evt);
        };

        this.channel.onmessage = function (evt) {
            socket.fire(WebUdpEvent.Message, evt);
        };

        const offer = await this.peer.createOffer();
        await this.peer.setLocalDescription(offer);

        var request = new XMLHttpRequest();
        request.open("POST", socket.address);
        request.onload = async () => {
            if (request.status == 200) {
                const response = JSON.parse(request.responseText);
                await this.peer.setRemoteDescription(new RTCSessionDescription(response.answer));

                var candidate = new RTCIceCandidate(response.candidate);
                await this.peer.addIceCandidate(candidate);
                console.debug("WebUDP: Add remote ice candidate success");
            }
        };
        request.send(this.peer.localDescription!.sdp);
    }
    
    send(data: string | Blob | ArrayBuffer | ArrayBufferView): boolean {
        if (this.isOpen) {
            this.channel.send(data as any);
            return true;
        }

        return false;
    };

    close() {
        this.channel.close();
    };
}