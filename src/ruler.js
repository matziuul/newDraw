import { PX_PER_MM } from './state.js';

export class Ruler {
    constructor(hCanvas, vCanvas, state) {
        this.hCanvas = hCanvas;
        this.vCanvas = vCanvas;
        this.state = state;
        this.hCtx = hCanvas.getContext('2d');
        this.vCtx = vCanvas.getContext('2d');
        this.mx = -1; this.my = -1;

        this._hStatic = this._buildStatic('h');
        this._vStatic = this._buildStatic('v');
        this.render();
    }

    rebuild() {
        this._hStatic = this._buildStatic('h');
        this._vStatic = this._buildStatic('v');
        this.render();
    }

    _buildStatic(axis) {
        const isH = axis === 'h';
        const w = isH ? this.hCanvas.width : 20;
        const h = isH ? 20 : this.vCanvas.height;
        const lenPx = isH ? w : h;
        const ox = isH ? (this.state.rulerOriginX || 0) : (this.state.rulerOriginY || 0);
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const ctx = off.getContext('2d');

        ctx.fillStyle = '#d0d0d0';
        ctx.fillRect(0, 0, w, h);

        if (this.state.rulerUnit === 'mm') {
            // canvas pixel for mm value m: px = m * PX_PER_MM + ox
            const vmin = Math.floor(-ox / PX_PER_MM);
            const vmax = Math.ceil((lenPx - ox) / PX_PER_MM);
            for (let mm = vmin; mm <= vmax; mm++) {
                const px = mm * PX_PER_MM + ox;
                if (px < 0 || px > lenPx) continue;
                const big = mm % 10 === 0, mid = mm % 5 === 0;
                const tick = big ? 13 : mid ? 8 : 4;
                ctx.strokeStyle = big ? '#444' : '#999';
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (isH) {
                    ctx.moveTo(px + 0.5, h - tick); ctx.lineTo(px + 0.5, h);
                } else {
                    ctx.moveTo(w - tick, px + 0.5); ctx.lineTo(w, px + 0.5);
                }
                ctx.stroke();

                if (big && px >= 2 && px <= lenPx - 2) {
                    ctx.font = '8px Geneva, monospace';
                    ctx.fillStyle = '#333';
                    if (isH) {
                        ctx.fillText(`${mm}`, px + 2, h - 14);
                    } else {
                        ctx.save();
                        ctx.translate(w - 14, px - 2);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText(`${mm}`, 0, 0);
                        ctx.restore();
                    }
                }
            }
        } else {
            // canvas pixel for value v: px = v + ox
            const firstTick = Math.ceil(-ox / 10) * 10;
            const lastTick  = Math.floor((lenPx - ox) / 10) * 10;
            for (let v = firstTick; v <= lastTick; v += 10) {
                const px = v + ox;
                if (px < 0 || px > lenPx) continue;
                const big = v % 100 === 0, mid = v % 50 === 0;
                const tick = big ? 13 : mid ? 8 : 4;
                ctx.strokeStyle = big ? '#444' : '#999';
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (isH) {
                    ctx.moveTo(px + 0.5, h - tick); ctx.lineTo(px + 0.5, h);
                } else {
                    ctx.moveTo(w - tick, px + 0.5); ctx.lineTo(w, px + 0.5);
                }
                ctx.stroke();

                if (big && px >= 2 && px <= lenPx - 2) {
                    ctx.font = '8px Geneva, monospace';
                    ctx.fillStyle = '#333';
                    if (isH) {
                        ctx.fillText(String(v), px + 2, h - 14);
                    } else {
                        ctx.save();
                        ctx.translate(w - 14, px - 2);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText(String(v), 0, 0);
                        ctx.restore();
                    }
                }
            }
        }

        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (isH) { ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); }
        else      { ctx.moveTo(w - 0.5, 0); ctx.lineTo(w - 0.5, h); }
        ctx.stroke();

        return off;
    }

    setMouse(x, y) { this.mx = x; this.my = y; }

    render() {
        const ox = this.state.rulerOriginX || 0;
        const oy = this.state.rulerOriginY || 0;
        const preview = this.state.rulerDragOrigin;

        this.hCtx.drawImage(this._hStatic, 0, 0);
        // Origin marker: small downward triangle on horizontal ruler
        const hx = preview ? preview.x : ox;
        if (hx > 0) this._drawOriginMarker(this.hCtx, 'h', hx, !!preview);
        if (this.mx >= 0) {
            this.hCtx.strokeStyle = 'rgba(0,85,255,0.75)';
            this.hCtx.lineWidth = 1;
            this.hCtx.beginPath();
            this.hCtx.moveTo(this.mx + 0.5, 0);
            this.hCtx.lineTo(this.mx + 0.5, 20);
            this.hCtx.stroke();
        }

        this.vCtx.drawImage(this._vStatic, 0, 0);
        // Origin marker: small rightward triangle on vertical ruler
        const vy = preview ? preview.y : oy;
        if (vy > 0) this._drawOriginMarker(this.vCtx, 'v', vy, !!preview);
        if (this.my >= 0) {
            this.vCtx.strokeStyle = 'rgba(0,85,255,0.75)';
            this.vCtx.lineWidth = 1;
            this.vCtx.beginPath();
            this.vCtx.moveTo(0, this.my + 0.5);
            this.vCtx.lineTo(20, this.my + 0.5);
            this.vCtx.stroke();
        }
    }

    _drawOriginMarker(ctx, axis, pos, isPreview) {
        ctx.save();
        ctx.fillStyle = isPreview ? 'rgba(0,85,255,0.45)' : 'rgba(0,85,255,0.75)';
        ctx.beginPath();
        if (axis === 'h') {
            // downward-pointing triangle at bottom edge of horizontal ruler
            ctx.moveTo(pos,     20);
            ctx.lineTo(pos - 4, 12);
            ctx.lineTo(pos + 4, 12);
        } else {
            // rightward-pointing triangle at right edge of vertical ruler
            ctx.moveTo(20,     pos);
            ctx.lineTo(12, pos - 4);
            ctx.lineTo(12, pos + 4);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}
