import { ClientId } from "./SignalSocket";
import { assertDefined, defined } from "../util";

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
        container.style.cssText = 'position:fixed;top:0;left:0;opacity:0.9;z-index:10000;pointer-events:none';
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
        const kTimeMarkerHeight = 10 * kPixelRatio;
        const kTimeMarkerWidth = 1 * kPixelRatio;

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
        const markerX = kTextX + ctx.measureText(label).width;

        this.dom.appendChild(canvas);
    
        const frameStatus = new Array(kTimeRangeFrames).fill(NetGraphPacketStatus.Missing);
        let lastFrame = 0;

        return {
            dom: canvas,

            setPacketStatus(frame: number, status: NetGraphPacketStatus) {
                frameStatus[frame % kTimeRangeFrames] = status;
            },

            update(ping: number | undefined, serverTime: number, renderTime: number, clientTime: number): void {
                ctx.fillStyle = bg;
                ctx.fillRect(kGraphX, kGraphY, kGraphWidth, kGraphHeight);

                const startFrame = Math.floor(serverTime / kFrameLengthMs) - kTimeRangeFrames / 2;
                const endFrame = startFrame + kTimeRangeFrames;

                let frame = startFrame;
                while (frame <= endFrame) {
                    const t = frame * kFrameLengthMs;
                    const x = kGraphX + Math.round(((t - serverTime) / (kTimeRangeFrames * kFrameLengthMs) + 0.5) * kGraphWidth);

                    // Reset the states of frames just now appearing on the graph
                    if (frame > lastFrame) { this.setPacketStatus(frame, NetGraphPacketStatus.Missing); }

                    ctx.fillStyle = 'grey';
                    ctx.fillRect(x, kGraphY, 2, kGraphHeight);

                    // Determine color based on status and other factors
                    const status: NetGraphPacketStatus = frameStatus[frame % kTimeRangeFrames];
                    switch(status) {
                        case NetGraphPacketStatus.Missing: ctx.fillStyle = missing; break;
                        case NetGraphPacketStatus.Received: ctx.fillStyle = received; break;
                        case NetGraphPacketStatus.Filled: ctx.fillStyle = filled; break;
                        case NetGraphPacketStatus.Late: ctx.fillStyle = toolate; break;
                        default: ctx.fillStyle = 'red';
                    }

                    ctx.fillRect(x - 4, kGraphY + kGraphHeight * 0.25, 10, kGraphHeight * 0.5);

                    frame += 1;
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
                
                // // Write the current ping to the top right
                // if (defined(ping)) {
                //     const pingStr = ping.toFixed(1).padStart(5);

                //     ctx.fillStyle = fg;
                //     ctx.textAlign = 'right';
                //     ctx.fillText(`Ping: ${pingStr}`, kWidth - kTextX, kTextY);
                // }
            }
        };
    }
}