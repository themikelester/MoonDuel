import { EventDispatcher } from "./EventDispatcher";

export class WebUdpSocket extends EventDispatcher {
    address: string;
    isOpen: boolean = false;

    channel: RTCDataChannel;
    peer: RTCPeerConnection;

    constructor(address: string) {
        super();
        this.address = address;
    }

    connect() {
        var socket = this;

        // @TODO: Pick more ICE servers? Support TURN?
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
            socket.fire('open');
        };

        this.channel.onclose = function () {
            socket.isOpen = false;
            console.debug("WebUDP: Data channel closed");
        };

        this.channel.onerror = function (evt) {
            console.error("WebUDP: Data channel error", evt);
        };

        this.channel.onmessage = function (evt) {
            socket.fire('message', evt);
        };

        this.peer.createOffer().then(offer => {
            return this.peer.setLocalDescription(offer);
        }).then(() => {
            var request = new XMLHttpRequest();
            request.open("POST", socket.address);
            request.onload = () => {
                if (request.status == 200) {
                    var response = JSON.parse(request.responseText);
                    this.peer.setRemoteDescription(new RTCSessionDescription(response.answer)).then(() => {
                        var candidate = new RTCIceCandidate(response.candidate);
                        this.peer.addIceCandidate(candidate).then(function () {
                            console.log("WebUDP: Add remote ice candidate success");
                        }).catch(function (err) {
                            console.error("WebUDP: Failure during remote addIceCandidate()", err);
                        });
                    }).catch(function (e) {
                        console.error("WebUDP: Set remote description fail", e);
                    });
                }
            };
            request.send(this.peer.localDescription!.sdp);
        }).catch(function (reason) {
            console.error("WebUDP: Create offer fail " + reason);
        });
    }

    send(data: string) {
        if (this.isOpen) {
            this.channel.send(data);
            return true;
        }

        return false;
    };

    close() {
        this.channel.close();
    };
}