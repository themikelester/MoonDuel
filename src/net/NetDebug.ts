import { ClientId } from "./SignalSocket";
import { assertDefined } from "../util";

export enum NetGraphPacketStatus {
    Missing, // Not yet received
    Received, // This packet was received
    Filled, // A subsequent packet containing this data was received
}

export interface NetGraphPanel {
    setPacketStatus(frame: number, status: NetGraphPacketStatus): void;
    update(serverTime: number, renderTime?: number, clientTime?: number): void;
}

export interface NetGraphPanelSet {
    client: NetGraphPanel;
    server?: NetGraphPanel;
}

export class NetGraph {
    dom: HTMLElement;
    panelSets: Record<ClientId, NetGraphPanelSet> = {};

    constructor() {
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:0;left:0;opacity:0.9;z-index:10000';
        this.dom = container;
    }

    addClient(id: ClientId) {
        const panel = this.addPanel(`Client: ${id.toString()}`);
        this.panelSets[id] =  { ...this.panelSets[id], client: panel };
        return panel;
    }

    addServer(id: ClientId): NetGraphPanel {
        const panel = this.addPanel(`Server: ${id.toString()}`);
        this.panelSets[id] = { ...this.panelSets[id], server: panel };
        return panel;
    }

    update() {

    }

    private addPanel(label: string): NetGraphPanel {
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
        // ctx.fillRect(kPad, kPad, kWidth - 2 * kPad, kHeight - 2 * kPad);

        ctx.fillStyle = fg;
        ctx.fillText(label, kTextX, kTextY);

        this.dom.appendChild(canvas);

        let lastServerFrame = 0;
        let lastRenderFrame = 0;

        return {
            setPacketStatus(frame: number, status: NetGraphPacketStatus) {
                if (frame < lastServerFrame - kTimeRangeFrames/2 || frame >= lastServerFrame + kTimeRangeFrames/2) {
                    return;
                }

                const x = kGraphX + (frame - lastServerFrame + kTimeRangeFrames/2) * kFrameWidth;

                // Determine color based on status and other factors
                if (status === NetGraphPacketStatus.Received) {
                    if (frame <= Math.ceil(lastRenderFrame)) {
                        // This frame came too late
                        ctx.fillStyle = toolate;
                    } else {
                        // The frame came in time
                        ctx.fillStyle = received;
                    }
                } else {
                    ctx.fillStyle = missing;
                }

                ctx.fillRect(x, kGraphY, kFrameWidth, kGraphHeight);

                ctx.strokeStyle = 'white';
                ctx.strokeRect(x, kGraphY, kFrameWidth, kGraphHeight);
            },

            update(serverTime: number, renderTime: number, clientTime: number): void {
                const serverFrame = Math.floor(serverTime / kFrameLengthMs);
                const renderFrame = renderTime / kFrameLengthMs;

                const df = serverFrame - lastServerFrame;
                const dx = df * kFrameWidth;
                
                // Move the old graph dx pixels to the left
                ctx.drawImage(canvas, kGraphX + dx, kGraphY, kGraphWidth - dx, kGraphHeight, kGraphX, kGraphY, kGraphWidth - dx, kGraphHeight);

                // Clear the time marker area
                ctx.fillStyle = bg;
                ctx.fillRect(200, kTextY, kWidth - 200, kTimeMarkerHeight);

                // Draw the server time
                ctx.fillStyle = 'red';
                const serverX = kGraphX + (kTimeRangeFrames / 2) * kFrameWidth;
                ctx.fillRect(serverX, kTextY, kTimeMarkerWidth, kTimeMarkerHeight);

                // Draw the render time
                ctx.fillStyle = 'purple';
                const renderX = kGraphX + (renderFrame - serverFrame + kTimeRangeFrames / 2) * kFrameWidth;
                ctx.fillRect(renderX, kTextY, kTimeMarkerWidth, kTimeMarkerHeight);

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