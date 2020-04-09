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
        this.peer = new RTCPeerConnection({
            iceServers: [{
                urls: ["stun:stun.l.google.com:19302"]
            }]
        });
        var peer = this.peer;

        this.peer.onicecandidate = function (evt) {
            if (evt.candidate) {
                console.log("received ice candidate", evt.candidate);
            } else {
                console.log("all local candidates received");
            }
        };

        this.peer.ondatachannel = function (evt) {
            console.log("peer connection on data channel");
            console.log(evt);

        };

        this.channel = peer.createDataChannel("webudp", {
            ordered: false,
            maxRetransmits: 0
        });
        this.channel.binaryType = "arraybuffer";

        var channel = this.channel;

        channel.onopen = function () {
            console.log("data channel ready");
            socket.isOpen = true;
            socket.fire('onopen');
        };

        channel.onclose = function () {
            socket.isOpen = false;
            console.log("data channel closed");
        };

        channel.onerror = function (evt) {
            console.log("data channel error " + evt.error);
        };

        channel.onmessage = function (evt) {
            socket.fire('onmessage', evt);
        };

        peer.createOffer().then(function (offer) {
            return peer.setLocalDescription(offer);
        }).then(function () {
            var request = new XMLHttpRequest();
            request.open("POST", socket.address);
            request.onload = function () {
                if (request.status == 200) {
                    var response = JSON.parse(request.responseText);
                    peer.setRemoteDescription(new RTCSessionDescription(response.answer)).then(function () {
                        var candidate = new RTCIceCandidate(response.candidate);
                        peer.addIceCandidate(candidate).then(function () {
                            console.log("add ice candidate success");
                        }).catch(function (err) {
                            console.log("Error: Failure during addIceCandidate()", err);
                        });
                    })
                        .catch(function (e) {
                            console.log("set remote description fail", e);
                        });
                }
            };
            request.send(peer.localDescription!.sdp);
        }).catch(function (reason) {
            console.log("create offer fail " + reason);
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