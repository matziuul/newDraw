import {
    hitTestHandle, hitTestBezierHandle, hitTestArcHandle, HANDLE_DEFS,
    RectangleShape, EllipseShape, LineShape, BezierShape, TextShape, RoundRectShape, ArcShape,
    nextUid, offsetShape, applyMoveFromOrigin,
} from './shapes.js';
import { fontCss } from './text-defs.js';
import { printDrawing } from './print.js';

/**
 * Coordinates all user interaction with the drawing canvas: mouse-based shape creation
 * and editing, keyboard shortcuts, tool switching, selection, and text entry. Acts as
 * the single point of truth for drag state and dispatches work to the renderer and
 * history manager.
 */
export class ToolController {
    /**
     * @param {object} state - Shared application state (shapes, selected IDs, active tool, etc.).
     * @param {object} renderer - Renders the canvas after each state change.
     * @param {object} history - Undo/redo manager; provides savePreOp/commit/undo/redo.
     * @param {object} ruler - Ruler overlay that tracks the current mouse position.
     * @param {HTMLCanvasElement} canvas - The drawing surface all mouse events attach to.
     * @param {object|null} toolbar - Toolbar UI reference for syncing active tool display.
     * @param {HTMLElement|null} textInput - Contenteditable overlay used for text entry.
     */
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

    /**
     * Registers all canvas and document event listeners for mouse interaction,
     * keyboard shortcuts, and text-overlay behaviour. Called once from the constructor.
     */
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

    /**
     * Converts a mouse event's client coordinates to canvas-space coordinates,
     * accounting for the current zoom level.
     * @param {MouseEvent} e
     * @returns {{ x: number, y: number }}
     */
    _pos(e) {
        const r = this.canvas.getBoundingClientRect();
        const z = this.state.zoom ?? 1;
        return {
            x: (e.clientX - r.left) / z,
            y: (e.clientY - r.top)  / z,
        };
    }

    /** Re-runs the full UI sync (status bar, toolbar, inspector, render). Public entry point for external callers. */
    syncUI() { this._update(); }

    /**
     * Applies the font, size, weight, style, and line-height of the currently edited
     * text shape (or the active font settings if creating a new shape) to the text-input
     * overlay element so it renders identically to the canvas text.
     */
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

    /**
     * Syncs the status bar (position and size readouts), toolbar, and inspector to
     * reflect the current selection, then triggers a canvas redraw. Also mirrors the
     * selected shape's fill/stroke/font settings back into the active-tool state so
     * the next shape drawn inherits the same style.
     */
    _update() {
        const sel = this.state.selectedShape;
        const multi = this.state.selectedIds.length > 1;
        if (sel) {
            if (sel.type !== 'group' && sel.type !== 'text') {
                this.state.activePatternIdx       = sel.fillIdx;
                this.state.activeStrokeWidth      = sel.strokeWidth;
                this.state.activeStrokeDash       = sel.strokeDash ?? 0;
                this.state.activeStrokePatternIdx = sel.strokePatternIdx ?? 3;
                if (sel.type === 'line' || sel.type === 'bezier')
                    this.state.activeArrowMode = sel.arrowMode ?? 0;
                if (sel.type === 'rectangle') {
                    this.state.activeCornerClass = 1;
                } else if (sel.type === 'roundrect') {
                    const qdPenW = sel.strokeWidth + 2;
                    let bestCls = 2, bestDiff = Infinity;
                    for (let c = 2; c <= 6; c++) {
                        const pts = Math.max(0, Math.floor((c * 9 - qdPenW) / 2));
                        const diff = Math.abs(Math.round(pts * 96 / 72) - sel.cornerRadius);
                        if (diff < bestDiff) { bestDiff = diff; bestCls = c; }
                    }
                    this.state.activeCornerClass = bestCls;
                }
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
        this.inspector?.sync();
        this.renderer.render();
    }

    /**
     * Snaps a canvas-space point to the nearest grid intersection when grid-snapping is on.
     * Returns the point unchanged when snapping is off.
     * @param {{ x: number, y: number }} param0
     * @returns {{ x: number, y: number }}
     */
    _snapPos({ x, y }) {
        if (!this.state.snapToGrid) return { x, y };
        const g = this.state.gridStep;
        return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
    }

    /**
     * Snaps a single numeric coordinate value to the nearest grid step when grid-snapping is on.
     * @param {number} v - Coordinate in canvas pixels.
     * @returns {number}
     */
    _snapVal(v) {
        if (!this.state.snapToGrid) return v;
        const g = this.state.gridStep;
        return Math.round(v / g) * g;
    }

    /**
     * Formats a pixel measurement as a display string in the current ruler unit
     * (pixels as a rounded integer, or millimetres to one decimal place).
     * @param {number} px - Measurement in canvas pixels.
     * @returns {string}
     */
    _fmt(px) {
        if (this.state.rulerUnit === 'mm') return (px * 25.4 / 96).toFixed(1);
        return String(Math.round(px));
    }

    /** Returns the unit suffix string (' mm' or '') for the current ruler unit setting. */
    _fmtUnit() { return this.state.rulerUnit === 'mm' ? ' mm' : ''; }

    /**
     * Formats an X coordinate relative to the ruler origin.
     * @param {number} px - Absolute canvas X position.
     * @returns {string}
     */
    _fmtX(px) { return this._fmt(px - (this.state.rulerOriginX || 0)); }
    /**
     * Formats a Y coordinate relative to the ruler origin.
     * @param {number} py - Absolute canvas Y position.
     * @returns {string}
     */
    _fmtY(py) { return this._fmt(py - (this.state.rulerOriginY || 0)); }

    /**
     * Handles document-level keydown events for global shortcuts: undo/redo, copy,
     * paste, duplicate, delete, print, bezier finish (Enter), and Escape to cancel
     * or deselect. Suppressed while any text input is focused (except Escape).
     * @param {KeyboardEvent} e
     */
    _onKey(e) {
        // Don't intercept keys while any text input is focused
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
            if (active === this.textInput && e.key === 'Escape') { e.preventDefault(); this._cancelText(); }
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

    /**
     * Dispatches a canvas mousedown event to the appropriate handler based on the
     * currently active tool: text placement, selection/resize/move, bezier point
     * addition, or shape drawing.
     * @param {MouseEvent} e
     */
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

    /**
     * Handles mousedown logic when the select tool is active. Determines what was
     * clicked and sets the appropriate drag mode: arc-handle drag, bezier-handle drag,
     * resize-handle drag, single-shape move, multi-shape move, or rubber-band selection
     * on empty canvas.
     * @param {{ x: number, y: number }} pos - Snapped canvas position.
     */
    _selectDown(pos) {
        const state = this.state;
        const sel   = state.selectedShape;

        // Arc endpoint handle drag (single selected arc, unlocked)
        if (sel?.type === 'arc' && !sel.locked) {
            const ah = hitTestArcHandle(pos.x, pos.y, sel, state.zoom ?? 1);
            if (ah !== null) {
                // Convert quarter arc to general representation before dragging
                if (sel.startAngleDeg === undefined) {
                    const qStart = [0, 90, 180, 270][sel.quadrant ?? 1];
                    sel.startAngleDeg = qStart;
                    sel.arcAngleDeg   = 90;
                }
                this.preOpSnapshot = this.history.savePreOp();
                this.originShape = sel.clone();
                this.activeHandle = ah;
                this.startX = pos.x; this.startY = pos.y;
                this.isDragging = true; this.dragMode = 'arcHandle'; this.hasMoved = false;
                state.hoveredArcHandle = null;
                state.dragArcHandle = ah;
                return;
            }
        }

        // Bezier handle drag (single selected bezier, unlocked)
        if (sel?.type === 'bezier' && !sel.locked) {
            const bh = hitTestBezierHandle(pos.x, pos.y, sel, state.zoom ?? 1);
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
            const hid = hitTestHandle(pos.x, pos.y, sel.getSelectionBounds?.() ?? sel.getBounds(), state.zoom ?? 1);
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

    /**
     * Begins drawing a new shape by initialising the current draft and entering draw
     * drag mode. Called when a non-select, non-bezier, non-text tool is pressed down.
     * @param {{ x: number, y: number }} pos - Snapped canvas start position.
     * @param {string} tool - Active tool name (e.g. 'rectangle', 'ellipse', 'line').
     */
    _drawDown(pos, tool) {
        this.preOpSnapshot = this.history.savePreOp();
        this.startX = pos.x; this.startY = pos.y;
        this.isDragging = true; this.dragMode = 'draw'; this.hasMoved = false;

        this.state.currentDraft = tool === 'line'
            ? { type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y }
            : { type: tool, x: pos.x, y: pos.y, width: 0, height: 0 };
    }

    /**
     * Handles canvas mousemove events. Updates the ruler and status bar with the
     * current position, then delegates to the appropriate drag handler based on
     * the current drag mode (draw, move, moveMany, rubber-band, resize, bezier handle,
     * or arc handle). Also handles live bezier control-handle dragging via the
     * bezierDragging flag.
     * @param {MouseEvent} e
     */
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
            this.elPos.textContent = `x: ${this._fmtX(pos.x)}  y: ${this._fmtY(pos.y)}${this._fmtUnit()}`;
            this.ruler.render();
            this.renderer.render();
            return;
        }

        if (!this.isDragging) {
            const d = this.state.currentDraft;
            if (d?.type === 'bezier') { d.mouseX = pos.x; d.mouseY = pos.y; }
            this._updateCursor(rawPos);
            this.elPos.textContent = `x: ${this._fmtX(rawPos.x)}  y: ${this._fmtY(rawPos.y)}${this._fmtUnit()}`;
            this.ruler.render();
            this.renderer.render();
            return;
        }

        this.hasMoved = true;
        const dx = pos.x - this.startX, dy = pos.y - this.startY;

        if (this.dragMode === 'draw') {
            const d = this.state.currentDraft;
            const constrain = e.shiftKey;
            if (d.type === 'line') {
                if (constrain && (dx !== 0 || dy !== 0)) {
                    const angle = Math.atan2(dy, dx);
                    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
                    const dist = Math.hypot(dx, dy);
                    d.x2 = this.startX + Math.cos(snapped) * dist;
                    d.y2 = this.startY + Math.sin(snapped) * dist;
                } else {
                    d.x2 = pos.x; d.y2 = pos.y;
                }
            } else if (d.type === 'arc') {
                // Position the full ellipse so one arc endpoint lands exactly at the
                // click and the other at the drag: cx=startX, cy=startY+dy, rx=|dx|, ry=|dy|.
                const ax = Math.abs(dx), ay = Math.abs(dy);
                const r = constrain ? Math.max(ax, ay) : null;
                const fax = r ?? ax, fay = r ?? ay;
                d.x = this.startX - fax;
                d.y = this.startY + dy - fay;  // cy - ry
                d.width = 2 * fax; d.height = 2 * fay;
                d.quadrant = dx >= 0 ? (dy >= 0 ? 0 : 1) : (dy >= 0 ? 3 : 2);
            } else {
                if (constrain) {
                    const size = Math.max(Math.abs(dx), Math.abs(dy));
                    d.width  = dx >= 0 ? size : -size;
                    d.height = dy >= 0 ? size : -size;
                } else {
                    d.width = dx; d.height = dy;
                }
            }

        } else if (this.dragMode === 'move') {
            const shape = this.state.selectedShape, orig = this.originShape;
            if (!shape || !orig) return;
            // dx/dy are already snapped deltas (diff of two _snapPos'd positions), so
            // adding them directly to the origin preserves off-grid offsets correctly.
            if (shape.type === 'line') {
                shape.x1 = orig.x1 + dx; shape.y1 = orig.y1 + dy;
                shape.x2 = orig.x2 + dx; shape.y2 = orig.y2 + dy;
            } else if (shape.type === 'bezier') {
                for (let i = 0; i < shape.points.length; i++) {
                    const op = orig.points[i];
                    shape.points[i].x   = op.x   + dx; shape.points[i].y   = op.y   + dy;
                    shape.points[i].c1x = op.c1x + dx; shape.points[i].c1y = op.c1y + dy;
                    shape.points[i].c2x = op.c2x + dx; shape.points[i].c2y = op.c2y + dy;
                }
            } else if (shape.type === 'group') {
                for (let i = 0; i < shape.children.length; i++)
                    applyMoveFromOrigin(shape.children[i], orig.children[i], dx, dy);
            } else {
                shape.x = orig.x + dx; shape.y = orig.y + dy;
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
        } else if (this.dragMode === 'arcHandle') {
            this._applyArcHandleDrag(rawPos);
            this.inspector?.sync();
        }

        this._updateStatusWhileDragging(pos);
        this.ruler.render();
        this.renderer.render();
    }

    /**
     * Applies a resize transformation to the selected shape during a handle drag. Handles
     * cardinal and corner handles for lines, arcs, and all box-type shapes. Arc resizing
     * operates on the visible quadrant bounding box and expands back to the full ellipse.
     * @param {{ x: number, y: number }} pos - Current snapped canvas position.
     */
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

        // Arc resize: operate on visible quadrant bounds then expand back to full ellipse.
        if (shape.type === 'arc') {
            const ob = orig.getSelectionBounds();
            let vx = ob.x, vy = ob.y, vw = ob.width, vh = ob.height;
            if (h.includes('w')) { const nx = this._snapVal(ob.x + dx); vw = ob.width + ob.x - nx; vx = nx; }
            if (h.includes('e')) { vw = this._snapVal(ob.x + ob.width + dx) - vx; }
            if (h.includes('n')) { const ny = this._snapVal(ob.y + dy); vh = ob.height + ob.y - ny; vy = ny; }
            if (h.includes('s')) { vh = this._snapVal(ob.y + ob.height + dy) - vy; }
            const qd = shape.quadrant;
            shape.x = (qd === 0 || qd === 1) ? vx - vw : vx;
            shape.y = (qd === 1 || qd === 2) ? vy - vh : vy;
            shape.width = 2 * vw; shape.height = 2 * vh;
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

    /**
     * Updates the selected arc's start and end angles while the user drags one of its
     * endpoint handles. The opposite endpoint is kept fixed; the quadrant field is
     * updated so resize handles remain correct. Angles are in the Mac convention
     * (0° = 12 o'clock, clockwise).
     * @param {{ x: number, y: number }} pos - Current raw (unsnapped) canvas position.
     */
    _applyArcHandleDrag(pos) {
        const shape = this.state.selectedShape;
        const orig  = this.originShape;
        if (!shape || !orig || shape.type !== 'arc') return;

        const { x, y, width: w, height: h } = shape.getBounds();
        const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
        if (rx === 0 || ry === 0) return;

        // Parametric angle from mouse position (normalise by radii → works for ellipses)
        const nx = (pos.x - cx) / rx;
        const ny = (pos.y - cy) / ry;
        // Mac angle: 0°=12 o'clock, clockwise
        const macAngle = ((Math.atan2(ny, nx) + Math.PI / 2) * 180 / Math.PI + 360) % 360;

        const origStart = orig.startAngleDeg ?? [0, 90, 180, 270][orig.quadrant ?? 1];
        const origArc   = orig.arcAngleDeg   ?? 90;

        if (this.activeHandle === 0) {
            // Drag start handle — keep end angle fixed
            const endAngle = (origStart + origArc) % 360;
            shape.startAngleDeg = macAngle;
            shape.arcAngleDeg   = Math.max(1, ((endAngle - macAngle) + 360) % 360);
        } else {
            // Drag end handle — keep start angle fixed
            shape.startAngleDeg = origStart;
            shape.arcAngleDeg   = Math.max(1, (macAngle - origStart + 360) % 360);
        }
        // Keep quadrant in sync so resize handles stay correct
        const mid = ((shape.startAngleDeg + shape.arcAngleDeg / 2) % 360 + 360) % 360;
        shape.quadrant = Math.min(3, Math.floor(mid / 90));
    }

    /**
     * Moves a bezier anchor or control-point handle during a drag. Anchors move the
     * point and both its control handles together; dragging one control handle mirrors
     * the opposite handle to maintain tangent continuity.
     * @param {{ x: number, y: number }} rawPos - Current raw (unsnapped) canvas position.
     */
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

    /**
     * Refreshes the position and size readouts in the status bar while a drag is in
     * progress. Shows draft dimensions for shape drawing, or the selected shape's
     * bounds for move/resize operations.
     * @param {{ x: number, y: number }} pos - Current snapped canvas position.
     */
    _updateStatusWhileDragging(pos) {
        const d = this.state.currentDraft;
        const u = this._fmtUnit();
        this.elPos.textContent = `x: ${this._fmtX(pos.x)}  y: ${this._fmtY(pos.y)}${u}`;
        if (d) {
            if (d.type === 'line')
                this.elSize.textContent = `∆: ${this._fmt(Math.abs(d.x2-d.x1))} × ${this._fmt(Math.abs(d.y2-d.y1))}${u}`;
            else if (d.type === 'arc')
                this.elSize.textContent = `${this._fmt(Math.abs(d.width)/2)} × ${this._fmt(Math.abs(d.height)/2)}${u}`;
            else
                this.elSize.textContent = `${this._fmt(Math.abs(d.width))} × ${this._fmt(Math.abs(d.height))}${u}`;
        } else {
            const sel = this.state.selectedShape;
            if (sel) {
                const b = sel.getSelectionBounds?.() ?? sel.getBounds();
                this.elSize.textContent = `${this._fmt(b.width)} × ${this._fmt(b.height)}${u}`;
            }
        }
        this.inspector?.sync();
    }

    /**
     * Sets the canvas cursor to reflect what is under the pointer when not dragging:
     * text cursor over the text tool, crosshair for drawing tools, and for the select
     * tool — resize/move cursors over handles, move over shape bodies, pointer over
     * unselected shapes, and default over empty canvas.
     * @param {{ x: number, y: number }} pos - Current raw canvas position.
     */
    _updateCursor(pos) {
        if (this.state.activeTool === 'text') { this.canvas.style.cursor = 'text'; return; }
        if (this.state.activeTool !== 'select') { this.canvas.style.cursor = 'crosshair'; return; }
        const state = this.state;
        const sel = state.selectedShape;
        state.hoveredBezierHandle = null;
        state.hoveredArcHandle    = null;

        if (sel) {
            if (sel.type === 'arc' && !sel.locked) {
                const ah = hitTestArcHandle(pos.x, pos.y, sel, state.zoom ?? 1);
                if (ah !== null) {
                    state.hoveredArcHandle = ah;
                    this.canvas.style.cursor = 'crosshair';
                    return;
                }
            }
            if (sel.type === 'bezier' && !sel.locked) {
                const bh = hitTestBezierHandle(pos.x, pos.y, sel, state.zoom ?? 1);
                if (bh) {
                    state.hoveredBezierHandle = bh;
                    this.canvas.style.cursor = bh.role === 'anchor' ? 'move' : 'crosshair';
                    return;
                }
            } else if (sel.type !== 'bezier' && sel.type !== 'group' && sel.type !== 'text' && !sel.locked) {
                const hid = hitTestHandle(pos.x, pos.y, sel.getSelectionBounds?.() ?? sel.getBounds(), state.zoom ?? 1);
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

    /**
     * Handles mouseup (and mouseleave) to end the current drag operation. Commits the
     * undo snapshot for draw, move, resize, and handle-drag operations; resolves the
     * rubber-band selection into selectedId/selectedIds; and updates the duplicate-offset
     * tracking when a recently duplicated shape is moved. Resets all drag state.
     */
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
                else if (d.type === 'roundrect') {
                    const cls = this.state.activeCornerClass;
                    const qdPenW = this.state.activeStrokeWidth + 2;
                    const ovalDiamPts = cls >= 2 ? cls * 9 : 0;
                    const cornerPts = Math.max(0, Math.floor((ovalDiamPts - qdPenW) / 2));
                    if (cornerPts > 0) {
                        shape = new RoundRectShape(d.x, d.y, d.width, d.height);
                        shape.cornerRadius = Math.round(cornerPts * 96 / 72);
                    } else {
                        shape = new RectangleShape(d.x, d.y, d.width, d.height);
                    }
                }
                else if (d.type === 'arc') {
                    shape = new ArcShape(d.x, d.y, d.width, d.height);
                    shape.quadrant = d.quadrant ?? 1;
                }

                if (shape) {
                    shape.fillIdx          = this.state.activePatternIdx;
                    shape.strokeWidth      = this.state.activeStrokeWidth;
                    shape.strokeDash       = this.state.activeStrokeDash;
                    shape.strokePatternIdx = this.state.activeStrokePatternIdx;
                    if (shape.type === 'line') shape.arrowMode = this.state.activeArrowMode;
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
                    const b = s.getSelectionBounds?.() ?? s.getBounds();
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

        } else if ((this.dragMode === 'move' || this.dragMode === 'resize' || this.dragMode === 'bezierHandle' || this.dragMode === 'arcHandle' || this.dragMode === 'moveMany') && this.hasMoved) {
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
        this.state.dragArcHandle    = null;
        this._update();
    }

    /**
     * Adds a new anchor point to the in-progress bezier path on each click. Starts a
     * fresh draft on the first click and appends subsequent points, then enters bezier-
     * dragging mode so the immediately following mousemove can set the control handles.
     * @param {{ x: number, y: number }} pos - Snapped canvas position for the new point.
     */
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

    /**
     * Finalises the bezier path being drawn, creating a BezierShape from the accumulated
     * draft points if at least two points exist. Applies the active style settings,
     * commits to history, and resets to the select tool unless tool-sticky mode is on.
     */
    _finishBezier() {
        const d = this.state.currentDraft;
        if (!d || d.type !== 'bezier') return;
        if (d.points.length >= 2) {
            const shape = new BezierShape(d.points);
            shape.fillIdx          = this.state.activePatternIdx;
            shape.strokeWidth      = this.state.activeStrokeWidth;
            shape.strokeDash       = this.state.activeStrokeDash;
            shape.strokePatternIdx = this.state.activeStrokePatternIdx;
            shape.arrowMode        = this.state.activeArrowMode;
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

    /**
     * Handles canvas double-click events. With the select tool: enters text-edit mode
     * when a text shape is double-clicked, or toggles a bezier anchor between corner
     * and smooth using a Catmull-Rom tangent estimate. While drawing a bezier path:
     * finalises the path (removing the duplicate point the second mousedown added).
     * @param {MouseEvent} e
     */
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
            // Bezier anchor double-click: toggle corner ↔ smooth
            if (sel?.type === 'bezier' && !sel.locked) {
                const bh = hitTestBezierHandle(raw.x, raw.y, sel, this.state.zoom ?? 1);
                if (bh?.role === 'anchor') {
                    e.preventDefault();
                    const snap = this.history.savePreOp();
                    const pts = sel.points, i = bh.pointIdx, n = pts.length, p = pts[i];
                    const isCorner = p.c1x === p.x && p.c1y === p.y && p.c2x === p.x && p.c2y === p.y;
                    if (isCorner) {
                        // Compute Catmull-Rom tangent from neighbours
                        let tx, ty;
                        if (i === 0)       { tx = pts[1].x - p.x;                   ty = pts[1].y - p.y; }
                        else if (i === n-1){ tx = p.x - pts[n-2].x;                 ty = p.y - pts[n-2].y; }
                        else               { tx = (pts[i+1].x - pts[i-1].x) / 2;    ty = (pts[i+1].y - pts[i-1].y) / 2; }
                        p.c1x = p.x - tx / 3; p.c1y = p.y - ty / 3;
                        p.c2x = p.x + tx / 3; p.c2y = p.y + ty / 3;
                    } else {
                        p.c1x = p.x; p.c1y = p.y;
                        p.c2x = p.x; p.c2y = p.y;
                    }
                    this.history.commit(snap);
                    this._update();
                    return;
                }
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

    /**
     * Handles a mousedown while the text tool is active. Commits any open text edit,
     * then either opens the overlay on an existing text shape (if one was clicked) or
     * starts a new text placement at the clicked position.
     * @param {{ x: number, y: number }} pos - Raw (unsnapped) canvas position.
     */
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

    /**
     * Positions and shows the contenteditable text-input overlay at the given canvas
     * coordinates, pre-filled with the shape's existing text (or empty for new text).
     * Applies font/size/style from the shape or the active font settings, then focuses
     * the element and places the caret at the end. Focus is deferred one tick to avoid
     * browser focus-management quirks during mousedown.
     * @param {number} x - Canvas X position for the overlay's top-left corner.
     * @param {number} y - Canvas Y position for the overlay's top-left corner.
     * @param {TextShape|null} shape - Existing shape to edit, or null for a new text shape.
     */
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

    /**
     * Reads the text-input overlay content and applies it: updates the text on an
     * existing shape (or deletes the shape if the text is cleared), or creates a new
     * TextShape for fresh placements. Skips committing to history if the text is
     * unchanged. Hides the overlay and resets editing state regardless.
     */
    _commitText() {
        const el = this.textInput;
        if (!el || el.style.display === 'none') return;
        const text = (el.innerText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        el.style.display = 'none';

        const unchanged = this.editingTextShape && text === this.editingTextShape.text;
        if (!unchanged) {
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
            this.history.commit(snap);
        }

        this.editingTextShape = null;
        this.editingTextPos   = null;
        this.state.editingTextId = null;
        this._update();
    }

    /**
     * Discards the current text-input overlay without saving any changes. Hides the
     * overlay and resets all editing state. Triggered by pressing Escape.
     */
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
