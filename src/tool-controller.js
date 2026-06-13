import {
    hitTestHandle, hitTestBezierHandle, HANDLE_DEFS,
    RectangleShape, EllipseShape, LineShape, BezierShape, TextShape, RoundRectShape,
    nextUid, offsetShape, applyMoveFromOrigin,
} from './shapes.js';
import { fontCss } from './text-defs.js';
import { printDrawing } from './print.js';

export class ToolController {
    constructor(state, renderer, history, ruler, canvas, toolbar, textInput) {
        this.state = state;
        this.renderer = renderer;
        this.history = history;
        this.ruler = ruler;
        this.canvas = canvas;
        this.toolbar = toolbar;
        this.textInput = textInput ?? null;

        this.isDragging = false;
        this.dragMode = 'none';
        this.startX = 0; this.startY = 0;
        this.activeHandle = null;
        this.preOpSnapshot = null;
        this.originShape = null;
        this.originShapes = null; // Map<id, clone> for multi-select move
        this.hasMoved = false;
        this.bezierDragging = false;

        this.editingTextShape = null; // TextShape being edited, or null for new
        this.editingTextPos   = null; // { x, y } for new text placement

        this.elPos  = document.getElementById('statusPos');
        this.elSize = document.getElementById('statusSize');

        this._attachEvents();
    }

    _attachEvents() {
        this.canvas.addEventListener('mousedown',  e => this._onDown(e));
        this.canvas.addEventListener('mousemove',  e => this._onMove(e));
        this.canvas.addEventListener('mouseup',    e => this._onUp(e));
        this.canvas.addEventListener('dblclick',   e => this._onDblClick(e));
        this.canvas.addEventListener('mouseleave', e => {
            this.ruler.setMouse(-1, -1); this.ruler.render();
            if (this.bezierDragging) { this.bezierDragging = false; return; }
            this._onUp(e);
        });
        document.addEventListener('keydown', e => this._onKey(e));

        if (this.textInput) {
            this.textInput.addEventListener('blur', () => this._commitText());
            this.textInput.addEventListener('keydown', e => {
                if (e.key === 'Escape') { e.preventDefault(); this._cancelText(); return; }
                // Prevent browser from applying contenteditable formatting
                if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u', 't'].includes(e.key.toLowerCase()))
                    e.preventDefault();
            });
        }
    }

    _pos(e) {
        const r = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (this.canvas.width  / r.width),
            y: (e.clientY - r.top)  * (this.canvas.height / r.height),
        };
    }

    syncUI() { this._update(); }

    syncOverlayStyle() {
        const el = this.textInput;
        if (!el || el.style.display === 'none') return;
        const shape = this.editingTextShape;
        const fontFamily = shape ? fontCss(shape.fontFamily) : fontCss(this.state.activeFont);
        const fontSize   = shape ? shape.fontSize   : this.state.activeFontSize;
        const fontStyle  = shape ? shape.fontStyle  : this.state.activeFontStyle;
        el.style.fontFamily     = fontFamily;
        el.style.fontSize       = fontSize + 'px';
        el.style.fontWeight     = (fontStyle & 1) ? 'bold'   : 'normal';
        el.style.fontStyle      = (fontStyle & 2) ? 'italic' : 'normal';
        el.style.textDecoration = (fontStyle & 4) ? 'underline' : 'none';
        el.style.lineHeight     = Math.ceil(fontSize * 1.25) + 'px';
    }

    _update() {
        const sel = this.state.selectedShape;
        const multi = this.state.selectedIds.length > 1;
        if (sel) {
            if (sel.type !== 'group' && sel.type !== 'text') {
                this.state.activePatternIdx       = sel.fillIdx;
                this.state.activeStrokeWidth      = sel.strokeWidth;
                this.state.activeStrokeDash       = sel.strokeDash ?? 0;
                this.state.activeStrokePatternIdx = sel.strokePatternIdx ?? 3;
            }
            if (sel.type === 'text') {
                this.state.activeFont      = sel.fontFamily;
                this.state.activeFontSize  = sel.fontSize;
                this.state.activeFontStyle = sel.fontStyle;
            }
            const b = sel.getBounds();
            this.elSize.textContent = `${this._fmt(b.width)} × ${this._fmt(b.height)}${this._fmtUnit()}`;
        } else if (multi) {
            this.elSize.textContent = `${this.state.selectedIds.length} shapes`;
        } else {
            this.elSize.textContent = '';
        }
        this.toolbar?.sync();
        this.renderer.render();
    }

    _snapPos({ x, y }) {
        if (!this.state.snapToGrid) return { x, y };
        const g = this.state.gridStep;
        return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
    }

    _snapVal(v) {
        if (!this.state.snapToGrid) return v;
        const g = this.state.gridStep;
        return Math.round(v / g) * g;
    }

    _fmt(px) {
        if (this.state.rulerUnit === 'mm') return (px * 25.4 / 96).toFixed(1);
        return String(Math.round(px));
    }

    _fmtUnit() { return this.state.rulerUnit === 'mm' ? ' mm' : ''; }

    _onKey(e) {
        // Don't intercept keys while text overlay is focused
        if (this.textInput && document.activeElement === this.textInput) {
            if (e.key === 'Escape') { e.preventDefault(); this._cancelText(); }
            return;
        }

        const cmd = e.metaKey || e.ctrlKey;

        if (cmd && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (this.history.undo()) this._update();
            return;
        }
        if (cmd && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            if (this.history.redo()) this._update();
            return;
        }
        if (cmd && e.key === 'c') {
            e.preventDefault();
            if (this.state.selectedShape) {
                this.state.clipboard = this.state.selectedShape.clone();
                this.state.clipboard.id = this.state.selectedShape.id;
            }
            return;
        }
        if (cmd && e.key === 'v') {
            e.preventDefault();
            const cb = this.state.clipboard;
            if (cb) {
                const snap = this.history.savePreOp();
                const pasted = cb.clone();
                pasted.id = nextUid();
                offsetShape(pasted, 10, 10);
                this.state.shapes.push(pasted);
                this.state.selectedId = pasted.id;
                this.state.clipboard = pasted.clone();
                this.history.commit(snap);
                this._update();
            }
            return;
        }
        if (cmd && e.key === 'd') {
            e.preventDefault();
            const sel = this.state.selectedShape;
            if (sel) {
                const snap = this.history.savePreOp();
                const dup = sel.clone();
                dup.id = nextUid();
                offsetShape(dup, this.state.dupOffset.x, this.state.dupOffset.y);
                this.state.shapes.push(dup);
                this.state.selectedId = dup.id;
                this.state.lastDupId = dup.id;
                this.state.lastDupSrcPos = sel.type === 'line'
                    ? { x: sel.x1, y: sel.y1 }
                    : sel.type === 'bezier'
                    ? { x: sel.points[0].x, y: sel.points[0].y }
                    : sel.type === 'group'
                    ? (() => { const b = sel.getBounds(); return { x: b.x, y: b.y }; })()
                    : { x: sel.x, y: sel.y };
                this.history.commit(snap);
                this._update();
            }
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.state.selectedIds.length > 1) {
            e.preventDefault();
            const toDelete = new Set(this.state.selectedIds);
            const snap = this.history.savePreOp();
            this.state.shapes = this.state.shapes.filter(s => !toDelete.has(s.id));
            this.state.selectedIds = [];
            this.history.commit(snap);
            this._update();
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.state.selectedId) {
            if (this.state.selectedShape?.locked) return;
            e.preventDefault();
            const snap = this.history.savePreOp();
            this.state.shapes = this.state.shapes.filter(s => s.id !== this.state.selectedId);
            this.state.selectedId = null;
            this.history.commit(snap);
            this._update();
            return;
        }
        if (cmd && e.key === 'p') {
            e.preventDefault();
            printDrawing(this.state.shapes, this.canvas.width, this.canvas.height);
            return;
        }
        if (e.key === 'Enter' && this.state.currentDraft?.type === 'bezier') {
            e.preventDefault();
            this._finishBezier();
            return;
        }
        if (e.key === 'Escape') {
            if (this.state.currentDraft?.type === 'bezier') {
                this.state.currentDraft = null;
                this.bezierDragging = false;
                this.preOpSnapshot = null;
                this.renderer.render();
                return;
            }
            this.state.selectedId = null;
            this.state.selectedIds = [];
            this._update();
        }
    }

    _onDown(e) {
        const raw = this._pos(e);
        if (this.state.activeTool === 'text') {
            // Prevent the browser from moving focus to the document after this click.
            // Without this, clicking the canvas blurs the textInput before focus settles.
            e.preventDefault();
            this._textDown(raw);
            return;
        }
        if (this.state.activeTool === 'select') this._selectDown(raw);
        else if (this.state.activeTool === 'bezier') this._bezierDown(this._snapPos(raw));
        else this._drawDown(this._snapPos(raw), this.state.activeTool);
    }

    _selectDown(pos) {
        const state = this.state;
        const sel   = state.selectedShape;

        // Bezier handle drag (single selected bezier, unlocked)
        if (sel?.type === 'bezier' && !sel.locked) {
            const bh = hitTestBezierHandle(pos.x, pos.y, sel);
            if (bh) {
                this.preOpSnapshot = this.history.savePreOp();
                this.originShape = sel.clone();
                this.activeHandle = bh;
                this.startX = pos.x; this.startY = pos.y;
                this.isDragging = true; this.dragMode = 'bezierHandle'; this.hasMoved = false;
                state.hoveredBezierHandle = null;
                state.dragBezierHandle = bh;
                return;
            }
        }

        // Resize handle (single selected non-bezier, non-group, non-text, unlocked)
        if (sel && sel.type !== 'bezier' && sel.type !== 'group' && sel.type !== 'text' && !sel.locked) {
            const hid = hitTestHandle(pos.x, pos.y, sel.getBounds());
            if (hid) {
                this.preOpSnapshot = this.history.savePreOp();
                this.originShape = sel.clone();
                this.activeHandle = hid;
                const snapped = this._snapPos(pos);
                this.startX = snapped.x; this.startY = snapped.y;
                this.isDragging = true; this.dragMode = 'resize'; this.hasMoved = false;
                return;
            }
        }

        // Find what was clicked
        let hit = null;
        for (let i = state.shapes.length - 1; i >= 0; i--) {
            if (state.shapes[i].hitTest(pos.x, pos.y)) { hit = state.shapes[i]; break; }
        }

        if (hit) {
            // Click inside an existing multi-selection → start moving all together
            if (state.selectedIds.length > 1 && state.selectedIds.includes(hit.id)) {
                const snapped = this._snapPos(pos);
                this.startX = snapped.x; this.startY = snapped.y;
                this.preOpSnapshot = this.history.savePreOp();
                this.originShapes = new Map(
                    state.selectedIds.flatMap(id => {
                        const s = state.shapes.find(sh => sh.id === id);
                        return s ? [[id, s.clone()]] : [];
                    })
                );
                this.isDragging = true; this.dragMode = 'moveMany'; this.hasMoved = false;
                return;
            }
            // Normal single select
            state.selectedId  = hit.id;
            state.selectedIds = [];
            if (!hit.locked) {
                this.preOpSnapshot = this.history.savePreOp();
                this.originShape = hit.clone();
                const snapped = this._snapPos(pos);
                this.startX = snapped.x; this.startY = snapped.y;
                this.isDragging = true; this.dragMode = 'move'; this.hasMoved = false;
            }
        } else {
            // Empty area → clear selection, start rubber-band
            state.selectedId  = null;
            state.selectedIds = [];
            this.startX = pos.x; this.startY = pos.y; // raw — rubber-band follows mouse exactly
            this.isDragging = true; this.dragMode = 'rubber-band'; this.hasMoved = false;
            state.rubberBand = null;
        }
        this._update();
    }

    _drawDown(pos, tool) {
        this.preOpSnapshot = this.history.savePreOp();
        this.startX = pos.x; this.startY = pos.y;
        this.isDragging = true; this.dragMode = 'draw'; this.hasMoved = false;

        this.state.currentDraft = tool === 'line'
            ? { type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y }
            : { type: tool, x: pos.x, y: pos.y, width: 0, height: 0 };
    }

    _onMove(e) {
        const rawPos = this._pos(e);
        this.ruler.setMouse(rawPos.x, rawPos.y);
        const pos = this._snapPos(rawPos);

        if (this.bezierDragging) {
            const d = this.state.currentDraft;
            if (d?.type === 'bezier' && d.points.length > 0) {
                const pt = d.points[d.points.length - 1];
                const dx = pos.x - pt.x, dy = pos.y - pt.y;
                pt.c2x = pt.x + dx; pt.c2y = pt.y + dy;
                pt.c1x = pt.x - dx; pt.c1y = pt.y - dy;
                d.mouseX = pos.x; d.mouseY = pos.y;
            }
            this.elPos.textContent = `x: ${this._fmt(pos.x)}  y: ${this._fmt(pos.y)}${this._fmtUnit()}`;
            this.ruler.render();
            this.renderer.render();
            return;
        }

        if (!this.isDragging) {
            const d = this.state.currentDraft;
            if (d?.type === 'bezier') { d.mouseX = pos.x; d.mouseY = pos.y; }
            this._updateCursor(rawPos);
            this.elPos.textContent = `x: ${this._fmt(rawPos.x)}  y: ${this._fmt(rawPos.y)}${this._fmtUnit()}`;
            this.ruler.render();
            this.renderer.render();
            return;
        }

        this.hasMoved = true;
        const dx = pos.x - this.startX, dy = pos.y - this.startY;

        if (this.dragMode === 'draw') {
            const d = this.state.currentDraft;
            if (d.type === 'line') { d.x2 = pos.x; d.y2 = pos.y; }
            else { d.width = dx; d.height = dy; }

        } else if (this.dragMode === 'move') {
            const shape = this.state.selectedShape, orig = this.originShape;
            if (!shape || !orig) return;
            if (shape.type === 'line') {
                shape.x1 = this._snapVal(orig.x1 + dx); shape.y1 = this._snapVal(orig.y1 + dy);
                shape.x2 = this._snapVal(orig.x2 + dx); shape.y2 = this._snapVal(orig.y2 + dy);
            } else if (shape.type === 'bezier') {
                for (let i = 0; i < shape.points.length; i++) {
                    const op = orig.points[i];
                    shape.points[i].x   = op.x   + dx; shape.points[i].y   = op.y   + dy;
                    shape.points[i].c1x = op.c1x + dx; shape.points[i].c1y = op.c1y + dy;
                    shape.points[i].c2x = op.c2x + dx; shape.points[i].c2y = op.c2y + dy;
                }
            } else if (shape.type === 'group') {
                // Snap the group's top-left corner and derive delta from there
                const ob = orig.getBounds();
                const sdx = this._snapVal(ob.x + dx) - ob.x;
                const sdy = this._snapVal(ob.y + dy) - ob.y;
                for (let i = 0; i < shape.children.length; i++)
                    applyMoveFromOrigin(shape.children[i], orig.children[i], sdx, sdy);
            } else {
                shape.x = this._snapVal(orig.x + dx); shape.y = this._snapVal(orig.y + dy);
            }

        } else if (this.dragMode === 'moveMany') {
            for (const [id, orig] of this.originShapes) {
                const shape = this.state.shapes.find(s => s.id === id);
                if (shape) applyMoveFromOrigin(shape, orig, dx, dy);
            }

        } else if (this.dragMode === 'rubber-band') {
            this.state.rubberBand = {
                x: Math.min(this.startX, rawPos.x), y: Math.min(this.startY, rawPos.y),
                w: Math.abs(rawPos.x - this.startX), h: Math.abs(rawPos.y - this.startY),
            };

        } else if (this.dragMode === 'resize') {
            this._applyResize(pos);
        } else if (this.dragMode === 'bezierHandle') {
            this._applyBezierHandleDrag(rawPos);
        }

        this._updateStatusWhileDragging(pos);
        this.ruler.render();
        this.renderer.render();
    }

    _applyResize(pos) {
        const shape = this.state.selectedShape, orig = this.originShape;
        if (!shape || !orig || shape.type === 'bezier') return;
        const dx = pos.x - this.startX, dy = pos.y - this.startY;
        const h = this.activeHandle;

        if (shape.type === 'line') {
            const west = h === 'nw' || h === 'w' || h === 'sw';
            if (west) {
                shape.x1 = this._snapVal(orig.x1 + dx); shape.y1 = this._snapVal(orig.y1 + dy);
            } else {
                shape.x2 = this._snapVal(orig.x2 + dx); shape.y2 = this._snapVal(orig.y2 + dy);
            }
            return;
        }

        shape.x = orig.x; shape.y = orig.y;
        shape.width = orig.width; shape.height = orig.height;

        if (h.includes('w')) {
            const nx = this._snapVal(orig.x + dx);
            shape.width = orig.width + orig.x - nx; shape.x = nx;
        }
        if (h.includes('e')) { shape.width  = this._snapVal(orig.x + orig.width  + dx) - shape.x; }
        if (h.includes('n')) {
            const ny = this._snapVal(orig.y + dy);
            shape.height = orig.height + orig.y - ny; shape.y = ny;
        }
        if (h.includes('s')) { shape.height = this._snapVal(orig.y + orig.height + dy) - shape.y; }
    }

    _applyBezierHandleDrag(rawPos) {
        const shape = this.state.selectedShape, orig = this.originShape;
        if (!shape || !orig) return;
        const { pointIdx, role } = this.activeHandle;
        const op = orig.points[pointIdx];
        const p  = shape.points[pointIdx];
        const dx = rawPos.x - this.startX, dy = rawPos.y - this.startY;

        if (role === 'anchor') {
            p.x   = op.x   + dx; p.y   = op.y   + dy;
            p.c1x = op.c1x + dx; p.c1y = op.c1y + dy;
            p.c2x = op.c2x + dx; p.c2y = op.c2y + dy;
        } else if (role === 'c2') {
            p.c2x = op.c2x + dx; p.c2y = op.c2y + dy;
            p.c1x = p.x - (p.c2x - p.x);
            p.c1y = p.y - (p.c2y - p.y);
        } else {
            p.c1x = op.c1x + dx; p.c1y = op.c1y + dy;
            p.c2x = p.x - (p.c1x - p.x);
            p.c2y = p.y - (p.c1y - p.y);
        }
    }

    _updateStatusWhileDragging(pos) {
        const d = this.state.currentDraft;
        const u = this._fmtUnit();
        this.elPos.textContent = `x: ${this._fmt(pos.x)}  y: ${this._fmt(pos.y)}${u}`;
        if (d) {
            if (d.type === 'line')
                this.elSize.textContent = `∆: ${this._fmt(Math.abs(d.x2-d.x1))} × ${this._fmt(Math.abs(d.y2-d.y1))}${u}`;
            else
                this.elSize.textContent = `${this._fmt(Math.abs(d.width))} × ${this._fmt(Math.abs(d.height))}${u}`;
        } else {
            const sel = this.state.selectedShape;
            if (sel) {
                const b = sel.getBounds();
                this.elSize.textContent = `${this._fmt(b.width)} × ${this._fmt(b.height)}${u}`;
            }
        }
    }

    _updateCursor(pos) {
        if (this.state.activeTool === 'text') { this.canvas.style.cursor = 'text'; return; }
        if (this.state.activeTool !== 'select') { this.canvas.style.cursor = 'crosshair'; return; }
        const state = this.state;
        const sel = state.selectedShape;
        state.hoveredBezierHandle = null;

        if (sel) {
            if (sel.type === 'bezier' && !sel.locked) {
                const bh = hitTestBezierHandle(pos.x, pos.y, sel);
                if (bh) {
                    state.hoveredBezierHandle = bh;
                    this.canvas.style.cursor = bh.role === 'anchor' ? 'move' : 'crosshair';
                    return;
                }
            } else if (sel.type !== 'bezier' && sel.type !== 'group' && sel.type !== 'text' && !sel.locked) {
                const hid = hitTestHandle(pos.x, pos.y, sel.getBounds());
                if (hid) { this.canvas.style.cursor = HANDLE_DEFS.find(d => d.id === hid)?.cursor ?? 'default'; return; }
            }
            if (sel.hitTest(pos.x, pos.y)) { this.canvas.style.cursor = 'move'; return; }
        }

        // Hovering over any shape in multi-selection → move cursor
        if (state.selectedIds.length > 1) {
            for (const id of state.selectedIds) {
                const s = state.shapes.find(sh => sh.id === id);
                if (s?.hitTest(pos.x, pos.y)) { this.canvas.style.cursor = 'move'; return; }
            }
        }

        for (let i = state.shapes.length - 1; i >= 0; i--) {
            if (state.shapes[i].hitTest(pos.x, pos.y)) { this.canvas.style.cursor = 'pointer'; return; }
        }
        this.canvas.style.cursor = 'default';
    }

    _onUp() {
        if (this.bezierDragging) { this.bezierDragging = false; this.renderer.render(); return; }
        if (!this.isDragging) return;

        if (this.dragMode === 'draw' && this.state.currentDraft) {
            const d = this.state.currentDraft;
            const big = d.type === 'line'
                ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 3
                : Math.abs(d.width) > 3 || Math.abs(d.height) > 3;

            if (big) {
                let shape;
                if (d.type === 'rectangle')  shape = new RectangleShape(d.x, d.y, d.width, d.height);
                else if (d.type === 'ellipse')   shape = new EllipseShape(d.x, d.y, d.width, d.height);
                else if (d.type === 'line')      shape = new LineShape(d.x1, d.y1, d.x2, d.y2);
                else if (d.type === 'roundrect') shape = new RoundRectShape(d.x, d.y, d.width, d.height);

                if (shape) {
                    shape.fillIdx          = this.state.activePatternIdx;
                    shape.strokeWidth      = this.state.activeStrokeWidth;
                    shape.strokeDash       = this.state.activeStrokeDash;
                    shape.strokePatternIdx = this.state.activeStrokePatternIdx;
                    this.state.shapes.push(shape);
                    this.state.selectedId = shape.id;
                    this.history.commit(this.preOpSnapshot);
                    if (!this.state.toolSticky) this.toolbar?.resetToSelect();
                }
            }
            this.state.currentDraft = null;

        } else if (this.dragMode === 'rubber-band') {
            const rb = this.state.rubberBand;
            this.state.rubberBand = null;
            if (rb && (rb.w > 4 || rb.h > 4)) {
                const found = this.state.shapes.filter(s => {
                    const b = s.getBounds();
                    return b.x < rb.x + rb.w && b.x + b.width  > rb.x &&
                           b.y < rb.y + rb.h && b.y + b.height > rb.y;
                });
                if (found.length === 1) {
                    this.state.selectedId = found[0].id;
                } else if (found.length > 1) {
                    this.state.selectedId  = null;
                    this.state.selectedIds = found.map(s => s.id);
                }
            }

        } else if ((this.dragMode === 'move' || this.dragMode === 'resize' || this.dragMode === 'bezierHandle' || this.dragMode === 'moveMany') && this.hasMoved) {
            this.history.commit(this.preOpSnapshot);
        }

        if (this.dragMode === 'move' && this.hasMoved &&
                this.state.selectedId === this.state.lastDupId && this.state.lastDupSrcPos) {
            const shape = this.state.selectedShape;
            if (shape) {
                const pos = shape.type === 'line'
                    ? { x: shape.x1, y: shape.y1 }
                    : shape.type === 'bezier'
                    ? { x: shape.points[0].x, y: shape.points[0].y }
                    : shape.type === 'group'
                    ? (() => { const b = shape.getBounds(); return { x: b.x, y: b.y }; })()
                    : { x: shape.x, y: shape.y };
                this.state.dupOffset = {
                    x: pos.x - this.state.lastDupSrcPos.x,
                    y: pos.y - this.state.lastDupSrcPos.y,
                };
            }
            this.state.lastDupId = null;
            this.state.lastDupSrcPos = null;
        }

        this.isDragging = false; this.dragMode = 'none';
        this.activeHandle = null; this.originShape = null; this.originShapes = null;
        this.preOpSnapshot = null; this.hasMoved = false;
        this.state.dragBezierHandle = null;
        this._update();
    }

    _bezierDown(pos) {
        const pt = { x: pos.x, y: pos.y, c1x: pos.x, c1y: pos.y, c2x: pos.x, c2y: pos.y };
        const d = this.state.currentDraft;
        if (!d || d.type !== 'bezier') {
            this.preOpSnapshot = this.history.savePreOp();
            this.state.currentDraft = { type: 'bezier', points: [pt], mouseX: pos.x, mouseY: pos.y };
        } else {
            d.points.push(pt);
        }
        this.bezierDragging = true;
        this.renderer.render();
    }

    _finishBezier() {
        const d = this.state.currentDraft;
        if (!d || d.type !== 'bezier') return;
        if (d.points.length >= 2) {
            const shape = new BezierShape(d.points);
            shape.fillIdx          = this.state.activePatternIdx;
            shape.strokeWidth      = this.state.activeStrokeWidth;
            shape.strokeDash       = this.state.activeStrokeDash;
            shape.strokePatternIdx = this.state.activeStrokePatternIdx;
            this.state.shapes.push(shape);
            this.state.selectedId = shape.id;
            this.history.commit(this.preOpSnapshot);
            if (!this.state.toolSticky) this.toolbar?.resetToSelect();
        }
        this.state.currentDraft = null;
        this.bezierDragging = false;
        this.preOpSnapshot = null;
        this._update();
    }

    _onDblClick(e) {
        // Text shape double-click with select tool → enter edit mode
        if (this.state.activeTool === 'select') {
            const raw = this._pos(e);
            const sel = this.state.selectedShape;
            if (sel?.type === 'text' && sel.hitTest(raw.x, raw.y)) {
                e.preventDefault();
                this._showTextOverlay(sel.x, sel.y, sel);
                this.renderer.render();
                return;
            }
        }
        // Bezier: finish drawing on double-click
        const d = this.state.currentDraft;
        if (!d || d.type !== 'bezier') return;
        e.preventDefault();
        // The second mousedown of the dblclick already added a duplicate point — remove it
        if (d.points.length > 1) d.points.pop();
        this._finishBezier();
    }

    _textDown(pos) {
        this._commitText(); // commit any existing edit first
        // Check for an existing text shape at this position
        let hit = null;
        for (let i = this.state.shapes.length - 1; i >= 0; i--) {
            const s = this.state.shapes[i];
            if (s.type === 'text' && s.hitTest(pos.x, pos.y)) { hit = s; break; }
        }
        if (hit) {
            this.state.selectedId  = hit.id;
            this.state.selectedIds = [];
            this._showTextOverlay(hit.x, hit.y, hit);
        } else {
            this.state.selectedId  = null;
            this.state.selectedIds = [];
            this._showTextOverlay(pos.x, pos.y, null);
        }
        this.renderer.render();
    }

    _showTextOverlay(x, y, shape) {
        const el = this.textInput;
        if (!el) return;
        const fontFamily = shape ? fontCss(shape.fontFamily) : fontCss(this.state.activeFont);
        const fontSize   = shape ? shape.fontSize   : this.state.activeFontSize;
        const fontStyle  = shape ? shape.fontStyle  : this.state.activeFontStyle;
        el.style.left        = x + 'px';
        el.style.top         = y + 'px';
        el.style.fontFamily  = fontFamily;
        el.style.fontSize    = fontSize + 'px';
        el.style.fontWeight  = (fontStyle & 1) ? 'bold'   : 'normal';
        el.style.fontStyle   = (fontStyle & 2) ? 'italic' : 'normal';
        el.style.textDecoration = (fontStyle & 4) ? 'underline' : 'none';
        el.style.lineHeight  = Math.ceil(fontSize * 1.25) + 'px';
        el.innerText         = shape ? shape.text : '';
        el.style.display     = 'block';
        this.editingTextShape = shape;
        this.editingTextPos   = { x, y };
        this.state.editingTextId = shape?.id ?? null;
        // Defer focus: calling focus() inside a mousedown handler is unreliable in
        // some browsers — the browser reassigns focus to the document after the handler
        // returns. Deferring to the next tick lets the mousedown finish first.
        setTimeout(() => {
            el.focus();
            try {
                const range = document.createRange();
                range.selectNodeContents(el); range.collapse(false);
                const sel = window.getSelection();
                sel.removeAllRanges(); sel.addRange(range);
            } catch (_) { /* ignore if element no longer shown */ }
        }, 0);
    }

    _commitText() {
        const el = this.textInput;
        if (!el || el.style.display === 'none') return;
        const text = (el.innerText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        el.style.display = 'none';
        const snap = this.history.savePreOp();
        if (this.editingTextShape) {
            if (text.trim() === '') {
                this.state.shapes = this.state.shapes.filter(s => s.id !== this.editingTextShape.id);
                this.state.selectedId = null;
            } else {
                this.editingTextShape.text = text;
            }
        } else if (text.trim() !== '') {
            const shape = new TextShape(
                this.editingTextPos.x, this.editingTextPos.y, text,
                this.state.activeFont, this.state.activeFontSize, this.state.activeFontStyle
            );
            this.state.shapes.push(shape);
            this.state.selectedId = shape.id;
        }
        this.editingTextShape = null;
        this.editingTextPos   = null;
        this.state.editingTextId = null;
        this.history.commit(snap);
        this._update();
    }

    _cancelText() {
        const el = this.textInput;
        if (!el) return;
        el.style.display = 'none';
        this.editingTextShape = null;
        this.editingTextPos   = null;
        this.state.editingTextId = null;
        this.renderer.render();
    }
}
