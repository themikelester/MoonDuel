import { Client } from './client';
import { Server } from './server';
import { SignalSocket } from './net/SignalSocket';

// Google Analytics
declare var gtag: (command: string, eventName: string, eventParameters: { [key: string]: string }) => void;

// Declare useful objects for easy access.
declare global {
    interface Window {
        client: any;
        server: any;
        debug: any;
        config: any;
    }
}

// @HACK
window.config = {
    kSignalServerAddress: '3.23.86.226:8888',
}

async function Main() {
    // Start loading and running the client
    const client = new Client();
    window.client = client;

    // @HACK
    // Begin connecting to the requested room
    // If we're the first ones in there, start up a server instance and assign it this socket
    // Then create a new socket and establish a new connection as a client
    const signalSocket = new SignalSocket();
    await signalSocket.connect(window.config.kSignalServerAddress);

    const isServer = signalSocket.serverId === signalSocket.clientId;
    
    if (isServer) {
        const server = new Server();
        server.onConnect(signalSocket);
        window.server = server;
    } else {
        signalSocket.close();
    }
        
    client.onConnect(signalSocket.serverId);
}

Main();
