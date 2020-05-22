import { Client } from './client';
import { Server } from './server';
import { SignalSocket } from './net/SignalSocket';
import { IS_DEVELOPMENT } from './version';

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

/**
 * All accepted URL parameters are documented here. 
 * E.g. The URL 'moonduel.io?debug' will show the debug menu
 */
const kUrlParameters: Record<string, (client: Client, value: any) => void> = {
    'debug': (client: Client) => client.debugMenu.show(),
}

// @HACK
window.config = {
    kSignalServerAddress: IS_DEVELOPMENT ? 'localhost:8888' : '3.23.86.226:8888',
}

async function Main() {
    // Start loading and running the client
    const client = new Client();
    window.client = client;
    
    client.init();

    // Parse and apply URL parameters
    // See kUrlParameters for potential values
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.forEach((value: string, key: string) => {
        const func = kUrlParameters[key];
        if (func) func(client, value);
    });

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
