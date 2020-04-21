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

async function Main() {
    // Start loading and running the client
    const client = new Client();
    window.client = client;

    // Begin connecting to the requested room
    // If we're the first ones in there, start up a server instance and assign it this socket
    // Then create a new socket and establish a new connection as a client
    while (true) {
        const signalSocket = new SignalSocket();
        await signalSocket.connect(kServerAddress, 'default');

        const isServer = signalSocket.serverId === signalSocket.clientId;
        
        if (isServer) {
            const server = new Server();
            server.onConnect(signalSocket);
            window.server = server;
        } else {
            window.client.onConnect(signalSocket);
            break;
        }
    }
}

Main();
