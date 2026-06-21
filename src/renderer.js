import { QD_PATTERNS, buildPattern } from './patterns.js';
import { getHandlePoints, HS, normalize } from './shapes.js';

export class Renderer {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.state = state;
        this.patterns = QD_PATTERNS.map(p => p.rows ? buildPattern(this.ctx, p.rows) : null);
    }

    render() {
        const { ctx, canvas, state, patterns } = this;
        const z = state.zoom ?? 1;
        this._z = z;
        ctx.setTransform(z, 0, 0, z, 0, 0);
        ctx.clearRect(0, 0, canvas.width / z, canvas.height / z);

        if (state.showGrid) this._drawGrid();
        if (state.pageW && state.pageH) this._drawPageMarkers();

        // Origin crosshair and drag preview
        const originX = state.rulerDragOrigin ? state.rulerDragOrigin.x : state.rulerOriginX;
        const originY = state.rulerDragOrigin ? state.rulerDragOrigin.y : state.rulerOriginY;
        if (originX !== 0 || originY !== 0) this._drawOriginCrosshair(originX, originY, !!state.rulerDragOrigin);

        for (const shape of state.shapes) {
            if (shape.id === state.editingTextId) continue; // overlay handles rendering while editing
            shape.draw(ctx, patterns, state.quickDraw);
            if (shape.id === state.selectedId) this._drawSelection(shape);
        }

        // Multi-selection outlines (thin dashed, no handles)
        if (state.selectedIds.length > 1) {
            for (const id of state.selectedIds) {
                const s = state.shapes.find(sh => sh.id === id);
                if (s) this._drawMultiOutline(s);
            }
        }

        // Rubber-band selection rect
        if (state.rubberBand) this._drawRubberBand(state.rubberBand);

        if (state.currentDraft) this._drawDraft(state.currentDraft);
    }

    _drawGrid() {
        const { ctx, canvas, state } = this;
        const z = this._z ?? 1;
        const lw = canvas.width / z, lh = canvas.height / z;
        const step = state.gridStep;
        ctx.save();
        ctx.strokeStyle = 'rgba(0,85,255,0.12)';
        ctx.lineWidth = 1 / z;
        ctx.beginPath();
        for (let x = 0; x <= lw; x += step) {
            const px = Math.round(x) + 0.5 / z;
            ctx.moveTo(px, 0); ctx.lineTo(px, lh);
        }
        for (let y = 0; y <= lh; y += step) {
            const py = Math.round(y) + 0.5 / z;
            ctx.moveTo(0, py); ctx.lineTo(lw, py);
        }
        ctx.stroke();
        ctx.restore();
    }

    _drawDraft(d) {
        const ctx = this.ctx;
        ctx.save();

        if (d.type === 'bezier') {
            this._drawBezierDraft(d);
            ctx.restore();
            return;
        }

        const z = this._z ?? 1;
        ctx.setLineDash([6 / z, 4 / z]); ctx.strokeStyle = '#333'; ctx.lineWidth = 1 / z;

        if (d.type === 'line') {
            ctx.beginPath();
            ctx.moveTo(d.x1 + 0.5 / z, d.y1 + 0.5 / z); ctx.lineTo(d.x2 + 0.5 / z, d.y2 + 0.5 / z);
            ctx.stroke();
        } else {
            const { x, y, width, height } = normalize(d.x, d.y, d.width, d.height);
            if (d.type === 'ellipse') {
                ctx.beginPath();
                ctx.ellipse(x + width/2, y + height/2, width/2, height/2, 0, 0, Math.PI*2);
                ctx.stroke();
            } else if (d.type === 'roundrect') {
                const r = Math.min(10, width / 2, height / 2);
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + width - r, y);       ctx.arcTo(x + width, y,          x + width, y + r,          r);
                ctx.lineTo(x + width, y + height - r); ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
                ctx.lineTo(x + r, y + height);      ctx.arcTo(x,         y + height, x,          y + height - r, r);
                ctx.lineTo(x, y + r);               ctx.arcTo(x,         y,          x + r,      y,              r);
                ctx.closePath(); ctx.stroke();
            } else if (d.type === 'arc') {
                const cx = x + width / 2, cy = y + height / 2;
                const rx = width / 2, ry = height / 2, q = d.quadrant ?? 1;
                ctx.beginPath();
                switch (q) {
                    case 0: ctx.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2,    0,           false); break;
                    case 1: ctx.ellipse(cx, cy, rx, ry, 0,  0,              Math.PI / 2, false); break;
                    case 2: ctx.ellipse(cx, cy, rx, ry, 0,  Math.PI / 2,    Math.PI,     false); break;
                    case 3: ctx.ellipse(cx, cy, rx, ry, 0,  3*Math.PI / 2,  Math.PI,     true ); break;
                }
                ctx.stroke();
            } else {
                ctx.strokeRect(x + 0.5 / z, y + 0.5 / z, width, height);
            }
        }
        ctx.restore();
    }

    _drawBezierDraft(d) {
        const ctx = this.ctx, pts = d.points;
        if (pts.length === 0) return;
        const z = this._z ?? 1;

        // Draw committed segments
        if (pts.length >= 2) {
            ctx.setLineDash([6 / z, 4 / z]); ctx.strokeStyle = '#333'; ctx.lineWidth = 1 / z;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.bezierCurveTo(pts[i-1].c2x, pts[i-1].c2y, pts[i].c1x, pts[i].c1y, pts[i].x, pts[i].y);
            }
            ctx.stroke();
        }

        // Preview line from last anchor to current mouse
        ctx.setLineDash([3 / z, 4 / z]); ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1 / z;
        ctx.beginPath();
        ctx.moveTo(pts[pts.length-1].x, pts[pts.length-1].y);
        ctx.lineTo(d.mouseX, d.mouseY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Anchor points and control handles
        const cr = 3 / z, hs = 4 / z;
        for (const p of pts) {
            if (p.c2x !== p.x || p.c2y !== p.y) {
                ctx.strokeStyle = '#0055ff'; ctx.lineWidth = 1 / z;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.c2x, p.c2y); ctx.stroke();
                ctx.beginPath(); ctx.arc(p.c2x, p.c2y, cr, 0, Math.PI * 2);
                ctx.fillStyle = '#0055ff'; ctx.fill();
            }
            if (p.c1x !== p.x || p.c1y !== p.y) {
                ctx.strokeStyle = '#0055ff'; ctx.lineWidth = 1 / z;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.c1x, p.c1y); ctx.stroke();
                ctx.beginPath(); ctx.arc(p.c1x, p.c1y, cr, 0, Math.PI * 2);
                ctx.fillStyle = '#0055ff'; ctx.fill();
            }
            ctx.fillStyle = 'white';
            ctx.fillRect(p.x - hs, p.y - hs, hs * 2, hs * 2);
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1 / z;
            ctx.strokeRect(p.x - hs + 0.5 / z, p.y - hs + 0.5 / z, hs * 2 - 1 / z, hs * 2 - 1 / z);
        }
    }

    _drawMultiOutline(shape) {
        const b = shape.getBounds();
        const ctx = this.ctx;
        const z = this._z ?? 1;
        const pad = 3 / z, n = 0.5 / z;
        ctx.save();
        ctx.strokeStyle = '#0055ff'; ctx.lineWidth = 1 / z; ctx.setLineDash([4 / z, 3 / z]);
        ctx.strokeRect(b.x - pad + n, b.y - pad + n, b.width + pad*2, b.height + pad*2);
        ctx.restore();
    }

    _drawRubberBand(rb) {
        const ctx = this.ctx;
        const z = this._z ?? 1;
        const n = 0.5 / z;
        ctx.save();
        ctx.fillStyle = 'rgba(0,85,255,0.05)';
        ctx.fillRect(rb.x, rb.y, rb.w, rb.h);
        ctx.strokeStyle = '#0055ff'; ctx.lineWidth = 1 / z; ctx.setLineDash([4 / z, 3 / z]);
        ctx.strokeRect(rb.x + n, rb.y + n, rb.w, rb.h);
        ctx.restore();
    }

    _drawSelection(shape) {
        if (shape.type === 'bezier') { this._drawBezierSelection(shape); return; }

        const ctx = this.ctx, b = shape.getSelectionBounds?.() ?? shape.getBounds();
        const z = this._z ?? 1;
        const pad = 4 / z, n = 0.5 / z, hs = HS / z;
        ctx.save();
        ctx.strokeStyle = '#0055ff'; ctx.lineWidth = 1 / z; ctx.setLineDash([5 / z, 3 / z]);
        ctx.strokeRect(b.x - pad + n, b.y - pad + n, b.width + pad*2, b.height + pad*2);
        ctx.setLineDash([]);

        // Groups and text: just the dashed outline, no resize handles
        if (shape.type === 'group' || shape.type === 'text') { ctx.restore(); return; }

        const locked = shape.locked;
        for (const h of getHandlePoints(b)) {
            ctx.fillStyle = locked ? '#b0b0b0' : 'white';
            ctx.fillRect(h.x - hs, h.y - hs, hs*2, hs*2);
            ctx.strokeStyle = locked ? '#666' : 'black'; ctx.lineWidth = 1 / z;
            ctx.strokeRect(h.x - hs + n, h.y - hs + n, hs*2 - 1/z, hs*2 - 1/z);
        }

        // Arc endpoint handles for reshape dragging
        if (shape.type === 'arc' && !locked) {
            const hov  = this.state.hoveredArcHandle;
            const drag = this.state.dragArcHandle;
            for (const [i, pt] of shape.getArcHandlePositions().entries()) {
                const active = hov === i || drag === i;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, (active ? 6 : 4) / z, 0, Math.PI * 2);
                if (active) {
                    ctx.fillStyle = 'white'; ctx.fill();
                    ctx.strokeStyle = '#0044dd'; ctx.lineWidth = 1.5 / z; ctx.stroke();
                } else {
                    ctx.fillStyle = '#0055ff'; ctx.strokeStyle = '#003bbf';
                    ctx.lineWidth = 1 / z; ctx.fill(); ctx.stroke();
                }
            }
        }

        ctx.restore();
    }

    _drawBezierSelection(shape) {
        const ctx = this.ctx;
        const z = this._z ?? 1;
        const hs = HS / z, n = 0.5 / z;
        // Locked bezier: just show a dashed outline, no editable handles
        if (shape.locked) {
            const b = shape.getBounds(), pad = 4 / z;
            ctx.save();
            ctx.strokeStyle = '#0055ff'; ctx.lineWidth = 1 / z; ctx.setLineDash([5 / z, 3 / z]);
            ctx.strokeRect(b.x - pad + n, b.y - pad + n, b.width + pad*2, b.height + pad*2);
            ctx.restore();
            return;
        }
        const hov = this.state.hoveredBezierHandle;
        const drag = this.state.dragBezierHandle;
        ctx.save();
        ctx.setLineDash([]);

        for (let i = 0; i < shape.points.length; i++) {
            const p = shape.points[i];

            const _isActive = (role) =>
                (hov?.pointIdx === i && hov?.role === role) ||
                (drag?.pointIdx === i && drag?.role === role);

            // Control arm + circle for c1 (in-handle)
            if (p.c1x !== p.x || p.c1y !== p.y) {
                const active = _isActive('c1');
                ctx.strokeStyle = active ? '#0044dd' : '#0055ff';
                ctx.lineWidth = (active ? 1.5 : 1) / z;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.c1x, p.c1y); ctx.stroke();

                ctx.beginPath(); ctx.arc(p.c1x, p.c1y, (active ? 5 : 3.5) / z, 0, Math.PI * 2);
                if (active) {
                    ctx.fillStyle = 'white'; ctx.fill();
                    ctx.strokeStyle = '#0044dd'; ctx.lineWidth = 1.5 / z; ctx.stroke();
                } else {
                    ctx.fillStyle = '#0055ff'; ctx.fill();
                }
            }

            // Control arm + circle for c2 (out-handle)
            if (p.c2x !== p.x || p.c2y !== p.y) {
                const active = _isActive('c2');
                ctx.strokeStyle = active ? '#0044dd' : '#0055ff';
                ctx.lineWidth = (active ? 1.5 : 1) / z;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.c2x, p.c2y); ctx.stroke();

                ctx.beginPath(); ctx.arc(p.c2x, p.c2y, (active ? 5 : 3.5) / z, 0, Math.PI * 2);
                if (active) {
                    ctx.fillStyle = 'white'; ctx.fill();
                    ctx.strokeStyle = '#0044dd'; ctx.lineWidth = 1.5 / z; ctx.stroke();
                } else {
                    ctx.fillStyle = '#0055ff'; ctx.fill();
                }
            }

            // Anchor square
            const anchorActive = _isActive('anchor');
            ctx.lineWidth = 1 / z; ctx.setLineDash([]);
            if (anchorActive) {
                ctx.fillStyle = '#0055ff';
                ctx.fillRect(p.x - hs, p.y - hs, hs*2, hs*2);
                ctx.strokeStyle = '#003bbf';
            } else {
                ctx.fillStyle = 'white';
                ctx.fillRect(p.x - hs, p.y - hs, hs*2, hs*2);
                ctx.strokeStyle = 'black';
            }
            ctx.strokeRect(p.x - hs + n, p.y - hs + n, hs*2 - 1/z, hs*2 - 1/z);
        }
        ctx.restore();
    }

    _drawPageMarkers() {
        const { ctx, canvas, state } = this;
        const z = this._z ?? 1;
        const lw = canvas.width / z, lh = canvas.height / z;
        const pw = state.pageW, ph = state.pageH;
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 100, 215, 0.5)';
        ctx.lineWidth = 1 / z;
        ctx.setLineDash([8 / z, 5 / z]);
        ctx.beginPath();
        for (let y = ph; y < lh; y += ph) {
            const py = Math.round(y) + 0.5 / z;
            ctx.moveTo(0, py); ctx.lineTo(lw, py);
        }
        for (let x = pw; x < lw; x += pw) {
            const px = Math.round(x) + 0.5 / z;
            ctx.moveTo(px, 0); ctx.lineTo(px, lh);
        }
        ctx.stroke();
        ctx.restore();
    }

    _drawOriginCrosshair(ox, oy, isPreview) {
        const { ctx, canvas } = this;
        const z = this._z ?? 1;
        const lw = canvas.width / z, lh = canvas.height / z;
        const n = 0.5 / z;
        ctx.save();
        ctx.strokeStyle = isPreview ? 'rgba(0,85,255,0.35)' : 'rgba(0,85,255,0.25)';
        ctx.lineWidth = 1 / z;
        ctx.setLineDash([4 / z, 4 / z]);
        ctx.beginPath();
        if (ox !== 0) { ctx.moveTo(ox + n, 0); ctx.lineTo(ox + n, lh); }
        if (oy !== 0) { ctx.moveTo(0, oy + n); ctx.lineTo(lw, oy + n); }
        ctx.stroke();
        ctx.restore();
    }
}