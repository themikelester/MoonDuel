import { ClientId } from "./SignalSocket";
import { assertDefined, defined, defaultValue } from "../util";

export enum NetGraphPacketStatus {
    Missing, // Not yet received
    Received, // This packet was received
    Filled, // A subsequent packet containing this data was received
    Late, // This packet arrived, but not before it was required
}

export interface NetGraphPanel {
    dom: HTMLElement;
    setPacketStatus(frame: number, status: NetGraphPacketStatus): void;
    update(ping: number | undefined, serverTime: number, renderTime?: number, clientTime?: number): void;
}

export interface NetGraphPanelSet {
    client: NetGraphPanel;
    server?: NetGraphPanel;
}

export class NetGraph {
    dom: HTMLElement;

    constructor() {
        const container = document.createElement('div');
        container.style.cssText = 'opacity:0.9;z-index:10000;pointer-events:none';
        this.dom = container;
    }

    removePanel(panel: NetGraphPanel) {
        this.dom.removeChild(panel.dom);
    }

    addPanel(label: string): NetGraphPanel {
        const kTimeRangeFrames = 64;
        const kFrameLengthMs = 16;

        const kPixelRatio = Math.round(window.devicePixelRatio || 1);
        const kFrameWidth = 10 * kPixelRatio
        const kGraphX = 3 * kPixelRatio; const kGraphY = 15 * kPixelRatio;
        const kTextX = 3 * kPixelRatio; const kTextY = 2 * kPixelRatio;

        const kGraphWidth = kFrameWidth * kTimeRangeFrames; const kGraphHeight = 30 * kPixelRatio;
        const kWidth = kGraphX * 2 + kGraphWidth; const kHeight = 48 * kPixelRatio;

        const bg = '#222';
        const fg = '#EEE';
        const missing = 'blue';
        const received = 'green';
        const filled = 'yellow';
        const toolate = 'purple';

        const canvas = document.createElement('canvas');
        canvas.height = kHeight;
        canvas.width = kWidth;
        canvas.style.cssText = `height:${Math.round(kHeight / kPixelRatio)}px;width:${Math.round(kWidth / kPixelRatio)}px`;

        const ctx = assertDefined(canvas.getContext('2d'));
        ctx.font = 'bold ' + (9 * kPixelRatio) + 'px Helvetica,Arial,sans-serif';
        ctx.textBaseline = 'top';

        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, kWidth, kHeight);

        ctx.fillStyle = fg;
        ctx.fillText(label, kTextX, kTextY);

        this.dom.appendChild(canvas);
    
        const frameStatus = new Array(kTimeRangeFrames).fill(NetGraphPacketStatus.Missing);
        const frameIds = new Array(kTimeRangeFrames).fill(-1);
        let lastFrame = 0;

        return {
            dom: canvas,

            setPacketStatus(frame: number, status: NetGraphPacketStatus) {
                const oldestFrame = lastFrame - kTimeRangeFrames;
                if (frame > oldestFrame && frame < lastFrame)
                    frameStatus[frame % kTimeRangeFrames] = status;
            },

            update(ping: number | undefined, serverTime: number, renderTime: number, clientTime: number): void {
                ctx.fillStyle = bg;
                ctx.fillRect(kGraphX, kGraphY, kGraphWidth, kGraphHeight);

                const startFrame = Math.floor(serverTime / kFrameLengthMs) - kTimeRangeFrames / 2;
                const endFrame = startFrame + kTimeRangeFrames - 1;

                let frame = startFrame;
                while (frame <= endFrame) {
                    const t = frame * kFrameLengthMs;
                    const gx = Math.round(((t - serverTime) / (kTimeRangeFrames * kFrameLengthMs) + 0.5) * kGraphWidth);
                    const x = kGraphX + gx;
                    frame += 1;

                    // Reset the states of frames just now appearing on the graph
                    if (frame > lastFrame) { 
                        frameStatus[frame % kTimeRangeFrames] = NetGraphPacketStatus.Missing;
                    }

                    if (gx > 0 && gx < kGraphWidth) {
                        ctx.fillStyle = 'grey';
                        ctx.fillRect(x - 1, kGraphY, 2, kGraphHeight);

                        // Determine color based on status and other factors
                        const status: NetGraphPacketStatus = frameStatus[frame % kTimeRangeFrames];
                        switch(status) {
                            case NetGraphPacketStatus.Missing: continue;
                            case NetGraphPacketStatus.Received: ctx.fillStyle = received; break;
                            case NetGraphPacketStatus.Filled: ctx.fillStyle = filled; break;
                            case NetGraphPacketStatus.Late: ctx.fillStyle = toolate; break;
                            default: ctx.fillStyle = 'red';
                        }

                        const radius = 4;
                        const left = Math.min(radius, x - kGraphX)
                        ctx.fillRect(x - left, kGraphY + kGraphHeight * 0.25, left + radius, kGraphHeight * 0.5);   
                    }
                }

                // Server time
                ctx.fillStyle = 'red';
                const serverX = kGraphX + 0.5 * kGraphWidth;
                ctx.fillRect(serverX, kGraphY, 4, kGraphHeight);

                // Client time
                ctx.fillStyle = 'yellow';
                const clientX = kGraphX + ((clientTime - serverTime) / (kTimeRangeFrames * kFrameLengthMs) + 0.5) * kGraphWidth;
                ctx.fillRect(clientX, kGraphY, 4, kGraphHeight);

                // Render time
                ctx.fillStyle = 'purple';
                const renderX = kGraphX + ((renderTime - serverTime) / (kTimeRangeFrames * kFrameLengthMs) + 0.5) * kGraphWidth;
                ctx.fillRect(renderX, kGraphY, 4, kGraphHeight);

                lastFrame = endFrame;
                
                // Write the current ping to the top right
                if (defined(ping)) {
                    const pingStr = ping.toFixed(1).padStart(5);

                    ctx.fillStyle = bg;
                    ctx.fillRect(kTextX + kWidth * 0.5, kTextY, kWidth * 0.5, kGraphY - kTextY)

                    ctx.fillStyle = fg;
                    ctx.textAlign = 'right';
                    ctx.fillText(`Ping: ${pingStr}`, kWidth - kTextX, kTextY);
                }
            }
        };
    }
}



export enum NetClientStat {
    Ping,  // Two-way network transit time of a packet. RTT - processing time
    Rtt,   // Round-trip-time of a packet, including server/client processing
    Vrtn,  // Variation in ping
    Loss,  // Percentage of packets lost
    Dur,   // Duration that a server tick takes to complete
    Delay, // Interpolation delay (in ms) of the client
    Ahead, // Client ahead time. Difference between clientTime and serverTime
    Down,  // Download bandwidth in Kbps
    Up,    // Upload bandwidth in Kbps

    _Count,
};

const kStatDesc: Partial<Record<NetClientStat, { name: string, unit: string, color: string }>> = {
    [NetClientStat.Ping]: { name: 'Ping', unit: 'ms', color: 'aqua' },
    [NetClientStat.Rtt]: { name: 'RTT', unit: 'ms', color: 'cornflowerblue' },
    [NetClientStat.Dur]: { name: 'Srv Tick', unit: 'ms', color: 'mediumpurple' },
    [NetClientStat.Loss]: { name: 'Pkt Loss', unit: '%', color: 'darkorange' },
    [NetClientStat.Down]: { name: 'Down', unit: 'Kbps', color: 'greenyellow' },
    [NetClientStat.Up]: { name: 'Up', unit: 'Kbps', color: 'hotpink' },
};

export class NetClientStats {
    minMaxAve: number[][] = [];
    history: number[][] = [];
    window: number = 3000 / 16; // 3 seconds at 63hz
    dom: HTMLElement;

    domMinMaxAve: HTMLElement[][] = [];

    constructor() {
        for (let i = 0; i < NetClientStat._Count; i++) {
            this.minMaxAve[i] = [];
            this.history[i] = [];
            this.domMinMaxAve[i] = [];
        }

        const container = document.createElement('div');
        container.style.cssText = `
            display:inline-block;
            font-family: Monaco, monospace;
            font-size: 9pt;
            background:rgba(50,50,50,0.8);
            opacity:0.9;
            z-index:10000;
            pointer-events:none;
            color:white`;
        this.dom = container;
    }

    initialize() {
        const tbl = document.createElement('table');
        tbl.style.tableLayout = 'fixed';
        tbl.style.borderSpacing = '9pt';
        
        // Header row
        let tr = document.createElement('tr');
        tr.appendChild(document.createElement('th'));
        tr.appendChild(document.createElement('th'));
        tr.appendChild(document.createElement('th')).appendChild(document.createTextNode('   avg   '));
        tr.appendChild(document.createElement('th')).appendChild(document.createTextNode('   min   '));
        tr.appendChild(document.createElement('th')).appendChild(document.createTextNode('   max   '));
        tbl.appendChild(tr);

        for (const statId in kStatDesc) {
            const stat = Number.parseInt(statId) as NetClientStat;
            const desc = assertDefined(kStatDesc[stat]);

            let tr = document.createElement('tr');
            tr.style.color = desc.color;
            tr.appendChild(document.createElement('td')).appendChild(document.createTextNode(desc.name));
            tr.appendChild(document.createElement('td')).appendChild(document.createTextNode(desc.unit));
            this.domMinMaxAve[stat][2] = tr.appendChild(document.createElement('td'));
            this.domMinMaxAve[stat][0] = tr.appendChild(document.createElement('td'));
            this.domMinMaxAve[stat][1] = tr.appendChild(document.createElement('td'));
            tbl.appendChild(tr);
        }

        this.dom.appendChild(tbl)
    }

    onReceiveFrame(ping: number | undefined, tickDuration: number) {
        if (!defined(ping)) {
            const pingHistory = this.history[NetClientStat.Ping];
            ping = defaultValue(pingHistory[pingHistory.length-1], 0);
        }
        this.history[NetClientStat.Ping].push(ping);
        this.history[NetClientStat.Dur].push(tickDuration);
    }

    onNetChannelSample(packetLoss: number, averageRTT: number, outKbps: number, inKbps: number) {
        this.history[NetClientStat.Loss].push(packetLoss);
        this.history[NetClientStat.Rtt].push(averageRTT);
        this.history[NetClientStat.Up].push(outKbps);
        this.history[NetClientStat.Down].push(inKbps);
    }

    update() {
        let historyLength = this.history[0].length;
        if (historyLength === 0) return; 
        
        // Remote history entries that are now outside the window
        while (historyLength > this.window) {
            for (const statHistory of this.history) {
                statHistory.shift();
            }
            historyLength -= 1;
        }   

        for (const statId in kStatDesc) {
            const stat = Number.parseInt(statId) as NetClientStat;
            this.minMaxAve[stat][0] = Math.min(...this.history[stat]);
            this.minMaxAve[stat][1] = Math.max(...this.history[stat]);
            this.minMaxAve[stat][2] = this.history[stat].reduce((a, c) => a + c, 0) / historyLength;

            const min = defaultValue(this.minMaxAve[stat][0]?.toFixed(1), '');
            const max = defaultValue(this.minMaxAve[stat][1]?.toFixed(1), '');
            const ave = defaultValue(this.minMaxAve[stat][2]?.toFixed(1), '');

            this.domMinMaxAve[stat][0].innerText = min;
            this.domMinMaxAve[stat][1].innerText = max;
            this.domMinMaxAve[stat][2].innerText = ave;
        }
    }
}