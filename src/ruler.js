import { PX_PER_MM, PX_PER_IN } from './state.js';

/** Renders the horizontal and vertical rulers flanking the canvas, including tick marks, labels, and the cursor position hairline. */
export class Ruler {
    /**
     * @param {HTMLCanvasElement} hCanvas - The horizontal ruler canvas element.
     * @param {HTMLCanvasElement} vCanvas - The vertical ruler canvas element.
     * @param {object} state - Shared application state providing zoom, unit, and ruler origin values.
     */
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

    /**
     * Regenerates the static ruler bitmaps and re-renders both rulers.
     * Call this when the canvas size, zoom level, ruler unit, or origin changes.
     */
    rebuild() {
        this._hStatic = this._buildStatic('h');
        this._vStatic = this._buildStatic('v');
        this.render();
    }

    /**
     * Draws tick marks and numeric labels for one ruler axis into an off-screen canvas.
     * The result is cached and composited during each {@link render} call for performance.
     * Supports three unit modes: 'mm', 'in', and pixels (default).
     * @param {'h'|'v'} axis - Which ruler to build: 'h' for horizontal, 'v' for vertical.
     * @returns {HTMLCanvasElement} Off-screen canvas with the static ruler content drawn on it.
     */
    _buildStatic(axis) {
        const isH = axis === 'h';
        const w = isH ? this.hCanvas.width : 20;
        const h = isH ? 20 : this.vCanvas.height;
        const lenPx = isH ? w : h;
        const ox = isH ? (this.state.rulerOriginX || 0) : (this.state.rulerOriginY || 0);
        const zoom = this.state.zoom || 1;
        const logLen = lenPx / zoom;   // logical document length in pixels
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const ctx = off.getContext('2d');

        ctx.fillStyle = '#d0d0d0';
        ctx.fillRect(0, 0, w, h);

        if (this.state.rulerUnit === 'mm') {
            // physical canvas pixel for mm value m: px = (m * PX_PER_MM + ox) * zoom
            const vmin = Math.floor(-ox / PX_PER_MM);
            const vmax = Math.ceil((logLen - ox) / PX_PER_MM);
            for (let mm = vmin; mm <= vmax; mm++) {
                const px = (mm * PX_PER_MM + ox) * zoom;
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
        } else if (this.state.rulerUnit === 'in') {
            // 1" = 96px; subdivide to 1/8" (12px) steps
            const stepPx = PX_PER_IN / 8; // 12px logical
            const firstI = Math.ceil(-ox / stepPx);
            const lastI  = Math.floor((logLen - ox) / stepPx);
            for (let i = firstI; i <= lastI; i++) {
                const px = (i * stepPx + ox) * zoom;
                if (px < 0 || px > lenPx) continue;
                const isIn   = i % 8 === 0;
                const isHalf = i % 4 === 0;
                const isQtr  = i % 2 === 0;
                const tick   = isIn ? 13 : isHalf ? 9 : isQtr ? 6 : 4;
                ctx.strokeStyle = isIn ? '#444' : '#999';
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (isH) {
                    ctx.moveTo(px + 0.5, h - tick); ctx.lineTo(px + 0.5, h);
                } else {
                    ctx.moveTo(w - tick, px + 0.5); ctx.lineTo(w, px + 0.5);
                }
                ctx.stroke();
                if (isIn && px >= 2 && px <= lenPx - 2) {
                    ctx.font = '8px Geneva, monospace';
                    ctx.fillStyle = '#333';
                    if (isH) {
                        ctx.fillText(String(i / 8), px + 2, h - 14);
                    } else {
                        ctx.save();
                        ctx.translate(w - 14, px - 2);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText(String(i / 8), 0, 0);
                        ctx.restore();
                    }
                }
            }
        } else {
            // canvas pixel for value v: physical px = (v + ox) * zoom
            const firstTick = Math.ceil(-ox / 10) * 10;
            const lastTick  = Math.floor((logLen - ox) / 10) * 10;
            for (let v = firstTick; v <= lastTick; v += 10) {
                const px = (v + ox) * zoom;
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

    /**
     * Updates the cursor position used to draw the hairline crosshair on the rulers.
     * Pass negative values to hide the hairline.
     * @param {number} x - Logical (unzoomed) x coordinate of the cursor on the canvas.
     * @param {number} y - Logical (unzoomed) y coordinate of the cursor on the canvas.
     */
    setMouse(x, y) { this.mx = x; this.my = y; }

    /**
     * Composites the static ruler bitmap, the origin marker triangle, and the cursor hairline
     * onto both ruler canvases. Should be called whenever the cursor moves or the view changes.
     */
    render() {
        const ox = this.state.rulerOriginX || 0;
        const oy = this.state.rulerOriginY || 0;
        const preview = this.state.rulerDragOrigin;
        const zoom = this.state.zoom || 1;

        this.hCtx.drawImage(this._hStatic, 0, 0);
        const hx = (preview ? preview.x : ox) * zoom;
        if (hx > 0) this._drawOriginMarker(this.hCtx, 'h', hx, !!preview);
        if (this.mx >= 0) {
            const pmx = this.mx * zoom;
            this.hCtx.strokeStyle = 'rgba(0,85,255,0.75)';
            this.hCtx.lineWidth = 1;
            this.hCtx.beginPath();
            this.hCtx.moveTo(pmx + 0.5, 0);
            this.hCtx.lineTo(pmx + 0.5, 20);
            this.hCtx.stroke();
        }

        this.vCtx.drawImage(this._vStatic, 0, 0);
        const vy = (preview ? preview.y : oy) * zoom;
        if (vy > 0) this._drawOriginMarker(this.vCtx, 'v', vy, !!preview);
        if (this.my >= 0) {
            const pmy = this.my * zoom;
            this.vCtx.strokeStyle = 'rgba(0,85,255,0.75)';
            this.vCtx.lineWidth = 1;
            this.vCtx.beginPath();
            this.vCtx.moveTo(0, pmy + 0.5);
            this.vCtx.lineTo(20, pmy + 0.5);
            this.vCtx.stroke();
        }
    }

    /**
     * Draws a small filled triangle on a ruler to indicate the ruler origin position.
     * The triangle points inward (down on horizontal, right on vertical).
     * @param {CanvasRenderingContext2D} ctx - Rendering context of the ruler canvas.
     * @param {'h'|'v'} axis - Which ruler is being drawn on.
     * @param {number} pos - Physical pixel position (already scaled by zoom) along the ruler.
     * @param {boolean} isPreview - When true, renders the marker semi-transparent to indicate a drag-in-progress.
     */
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
