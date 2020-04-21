import { Client } from './client';
import { Server } from './server';
import { SignalSocket, SignalSocketEvents } from './net/SignalSocket';

const kPort = 8888;
const kServerAddress = window.location.protocol + "//" + window.location.hostname + ":" + kPort;

// Google Analytics
declare var gtag: (command: string, eventName: string, eventParameters: { [key: string]: string }) => void;

// Declare useful objects for easy access.
declare global {
    interface Window {
        client: any;
        server: any;
        debug: any;
    }
}

// Begin connecting to the requested room
const signalSocket = new SignalSocket();
signalSocket.connect(kServerAddress, 'default');
signalSocket.on(SignalSocketEvents.JoinedRoom, () => {
    const isServer = signalSocket.serverId === signalSocket.clientId;
    
    // @HACK: If we're the first run in the room, run as a headless dedicated server
    if (isServer) {
        const server = new Server();
        server.onConnect(signalSocket);
        window.server = server;
    } else {
        // Start loading and running the client
        window.client = new Client();
        window.client.onConnect(signalSocket);
    }
});
