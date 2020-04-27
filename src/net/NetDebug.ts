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

        let lastServerFrame = 0;
        let lastRenderFrame: number | undefined = undefined;

        return {
            dom: canvas,

            setPacketStatus(frame: number, status: NetGraphPacketStatus) {
                if (frame < lastServerFrame - kTimeRangeFrames/2 || frame >= lastServerFrame + kTimeRangeFrames/2) {
                    return;
                }

                const x = kGraphX + (frame - lastServerFrame + kTimeRangeFrames/2) * kFrameWidth;

                // Determine color based on status and other factors
                switch(status) {
                    case NetGraphPacketStatus.Missing: ctx.fillStyle = missing; break;
                    case NetGraphPacketStatus.Received: ctx.fillStyle = received; break;
                    case NetGraphPacketStatus.Filled: ctx.fillStyle = 'red'; break;
                    case NetGraphPacketStatus.Late: ctx.fillStyle = toolate; break;
                    default: ctx.fillStyle = 'red';
                }

                ctx.fillRect(x, kGraphY, kFrameWidth, kGraphHeight);

                ctx.strokeStyle = 'white';
                ctx.strokeRect(x, kGraphY, kFrameWidth, kGraphHeight);
            },

            update(ping: number | undefined, serverTime: number, renderTime: number, clientTime: number): void {
                const serverFrame = Math.floor(serverTime / kFrameLengthMs);
                const renderFrame = defined(renderTime) ? renderTime / kFrameLengthMs : undefined;
                const clientFrame = defined(clientTime) ? clientTime / kFrameLengthMs : undefined;

                const df = serverFrame - lastServerFrame;
                const dx = df * kFrameWidth;
                
                // Move the old graph dx pixels to the left
                ctx.drawImage(canvas, kGraphX + dx, kGraphY, kGraphWidth - dx, kGraphHeight, kGraphX, kGraphY, kGraphWidth - dx, kGraphHeight);

                // Clear the time marker area
                ctx.fillStyle = bg;
                ctx.fillRect(markerX, kTextY, kWidth - markerX, kTimeMarkerHeight);

                // Write the current ping to the top right
                if (defined(ping)) {
                    const pingStr = ping.toFixed(1).padStart(5);

                    ctx.fillStyle = fg;
                    ctx.textAlign = 'right';
                    ctx.fillText(`Ping: ${pingStr}`, kWidth - kTextX, kTextY);
                }

                // Draw the server time
                ctx.fillStyle = 'red';
                const serverX = kGraphX + (kTimeRangeFrames / 2) * kFrameWidth;
                ctx.fillRect(serverX, kTextY, kTimeMarkerWidth, kTimeMarkerHeight);

                if (defined(renderFrame)) {
                    // Draw the render time
                    ctx.fillStyle = 'purple';
                    const renderX = kGraphX + (renderFrame - serverFrame + kTimeRangeFrames / 2) * kFrameWidth;
                    ctx.fillRect(renderX, kTextY, kTimeMarkerWidth, kTimeMarkerHeight);
                }

                if (defined(clientFrame)) {
                    // Draw the render time
                    ctx.fillStyle = 'yellow';
                    const renderX = kGraphX + (clientFrame - serverFrame + kTimeRangeFrames / 2) * kFrameWidth;
                    ctx.fillRect(renderX, kTextY, kTimeMarkerWidth, kTimeMarkerHeight);
                }

                lastServerFrame = serverFrame;
                lastRenderFrame = renderFrame;

                // ... and draw the latest information which is dx pixels wide
                ctx.fillStyle = missing;
                for (let i = 0; i < df; i++) {
                    this.setPacketStatus(serverFrame + kTimeRangeFrames / 2 - 1 - i, NetGraphPacketStatus.Missing);
                }
            }
        };
    }
}