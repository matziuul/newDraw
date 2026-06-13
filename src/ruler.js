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
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const ctx = off.getContext('2d');

        ctx.fillStyle = '#d0d0d0';
        ctx.fillRect(0, 0, w, h);

        if (this.state.rulerUnit === 'mm') {
            const lenMm = Math.ceil(lenPx / PX_PER_MM);
            for (let mm = 0; mm <= lenMm; mm++) {
                const px = mm * PX_PER_MM;
                if (px > lenPx) break;
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

                if (big && mm > 0) {
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
            const len = lenPx;
            for (let i = 0; i <= len; i += 10) {
                const big = i % 100 === 0, mid = i % 50 === 0;
                const tick = big ? 13 : mid ? 8 : 4;
                ctx.strokeStyle = big ? '#444' : '#999';
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (isH) {
                    ctx.moveTo(i + 0.5, h - tick); ctx.lineTo(i + 0.5, h);
                } else {
                    ctx.moveTo(w - tick, i + 0.5); ctx.lineTo(w, i + 0.5);
                }
                ctx.stroke();

                if (big && i > 0) {
                    ctx.font = '8px Geneva, monospace';
                    ctx.fillStyle = '#333';
                    if (isH) {
                        ctx.fillText(String(i), i + 2, h - 14);
                    } else {
                        ctx.save();
                        ctx.translate(w - 14, i - 2);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText(String(i), 0, 0);
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
        this.hCtx.drawImage(this._hStatic, 0, 0);
        if (this.mx >= 0) {
            this.hCtx.strokeStyle = 'rgba(0,85,255,0.75)';
            this.hCtx.lineWidth = 1;
            this.hCtx.beginPath();
            this.hCtx.moveTo(this.mx + 0.5, 0);
            this.hCtx.lineTo(this.mx + 0.5, 20);
            this.hCtx.stroke();
        }

        this.vCtx.drawImage(this._vStatic, 0, 0);
        if (this.my >= 0) {
            this.vCtx.strokeStyle = 'rgba(0,85,255,0.75)';
            this.vCtx.lineWidth = 1;
            this.vCtx.beginPath();
            this.vCtx.moveTo(0, this.my + 0.5);
            this.vCtx.lineTo(20, this.my + 0.5);
            this.vCtx.stroke();
        }
    }
}
