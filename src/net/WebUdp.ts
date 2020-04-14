import { EventDispatcher } from "../EventDispatcher";

export enum WebUdpEvent {
    Open = "open",
    Message = "message", 
};

export class WebUdpSocket extends EventDispatcher {
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