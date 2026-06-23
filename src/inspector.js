import { offsetShape } from './shapes.js';

/**
 * Inspector panel that displays and edits the position, size, and arc angle
 * of the currently selected shape. Reads from and writes to application state,
 * and commits undoable history entries for every user-initiated change.
 */
export class Inspector {
    /**
     * Wires up the inspector to the shared application objects and binds all
     * HTML input elements by their well-known IDs.
     *
     * @param {AppState} state - Global application state (selected shape, ruler unit, etc.).
     * @param {Renderer} renderer - Canvas renderer; called after every state change.
     * @param {History} history - Undo/redo history; used to save pre-operation snapshots.
     */
    constructor(state, renderer, history) {
        this.state    = state;
        this.renderer = renderer;
        this.history  = history;

        this.elX       = document.getElementById('inspX');
        this.elY       = document.getElementById('inspY');
        this.elW       = document.getElementById('inspW');
        this.elH       = document.getElementById('inspH');
        this.elUnit    = document.getElementById('inspUnit');
        this.elArc     = document.getElementById('inspArc');
        this.elArcRow  = document.getElementById('inspArcRow');

        this._attachEvents();
        document.getElementById('selUnit')
            .addEventListener('change', () => this.sync());
    }

    /**
     * Registers change and Enter-key listeners on each editable inspector field
     * so that user input is applied to the selected shape immediately on commit.
     */
    _attachEvents() {
        const apply = (el, field) => {
            el.addEventListener('change', () => this._applyField(field, el));
            el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
        };
        apply(this.elX, 'x');
        apply(this.elY, 'y');
        apply(this.elW, 'w');
        apply(this.elH, 'h');
        apply(this.elArc, 'arc');
    }

    /**
     * Converts a value from the current display unit (mm, in, or px) to canvas pixels.
     *
     * @param {number} v - Value in the ruler's current unit.
     * @returns {number} Equivalent value in canvas pixels.
     */
    _toPx(v) {
        if (this.state.rulerUnit === 'mm') return v * 96 / 25.4;
        if (this.state.rulerUnit === 'in') return v * 96;
        return v;
    }

    /**
     * Converts a canvas-pixel value to the current display unit for showing in inputs.
     *
     * @param {number} px - Value in canvas pixels.
     * @returns {number} Rounded value in the ruler's current unit.
     */
    _toDisplay(px) {
        if (this.state.rulerUnit === 'mm') return +(px * 25.4 / 96).toFixed(2);
        if (this.state.rulerUnit === 'in') return +(px / 96).toFixed(3);
        return Math.round(px);
    }

    /**
     * Returns whether the given shape supports width/height edits in the inspector.
     * Only box-like primitives (rectangle, roundrect, ellipse, arc) are resizable this way.
     *
     * @param {Shape} shape - The shape to test.
     * @returns {boolean}
     */
    _canResize(shape) {
        return shape.type === 'rectangle' || shape.type === 'roundrect' || shape.type === 'ellipse' || shape.type === 'arc';
    }

    /**
     * Returns whether the given shape can be repositioned via the inspector.
     * Groups are excluded because their children carry the individual positions.
     *
     * @param {Shape} shape - The shape to test.
     * @returns {boolean}
     */
    _canMove(shape) {
        return shape.type !== 'group';
    }

    /**
     * Applies a single inspector field edit (x, y, w, h, or arc) to the selected shape.
     * Validates the input, saves a pre-operation snapshot for undo, mutates the shape,
     * commits the snapshot, and triggers a re-render and sync.
     *
     * @param {'x'|'y'|'w'|'h'|'arc'} field - Which property is being edited.
     * @param {HTMLInputElement} el - The input element whose current value to apply.
     */
    _applyField(field, el) {
        const sel = this.state.selectedShape;
        if (!sel || sel.locked) { this.sync(); return; }

        const val = this._toPx(parseFloat(el.value));
        if (isNaN(val) || val < 0 && (field === 'w' || field === 'h')) {
            this.sync(); return;
        }

        if (field === 'arc') {
            if (sel.type !== 'arc') { this.sync(); return; }
            const deg = Math.round(parseFloat(this.elArc.value));
            if (isNaN(deg) || deg < 1 || deg > 360) { this.sync(); return; }
            const snap = this.history.savePreOp();
            if (sel.startAngleDeg === undefined)
                sel.startAngleDeg = [0, 90, 180, 270][sel.quadrant ?? 1];
            sel.arcAngleDeg = deg;
            this.history.commit(snap);
            this.renderer.render();
            this.sync();
            return;
        }

        const snap = this.history.savePreOp();
        const b = sel.getSelectionBounds?.() ?? sel.getBounds();

        if (field === 'x' && this._canMove(sel)) {
            offsetShape(sel, val - b.x, 0);
        } else if (field === 'y' && this._canMove(sel)) {
            offsetShape(sel, 0, val - b.y);
        } else if (field === 'w' && this._canResize(sel)) {
            if (sel.type === 'arc') {
                sel.x = (sel.quadrant === 0 || sel.quadrant === 1) ? b.x - val : b.x;
                sel.width = 2 * val;
            } else {
                sel.x = b.x; sel.width = val;
            }
        } else if (field === 'h' && this._canResize(sel)) {
            if (sel.type === 'arc') {
                sel.y = (sel.quadrant === 1 || sel.quadrant === 2) ? b.y - val : b.y;
                sel.height = 2 * val;
            } else {
                sel.y = b.y; sel.height = val;
            }
        }

        this.history.commit(snap);
        this.renderer.render();
        this.sync();
    }

    /**
     * Refreshes all inspector inputs to reflect the current selection.
     * Handles single selection, multi-selection (shows combined bounding box,
     * all fields read-only), and empty selection (clears and disables all fields).
     * Also shows or hides the arc-angle row as appropriate.
     */
    sync() {
        const sel   = this.state.selectedShape;
        const multi = this.state.selectedIds.length > 1;
        const unit = this.state.rulerUnit;
        const step = unit === 'mm' ? '0.01' : unit === 'in' ? '0.001' : '1';

        this.elUnit.textContent = unit;
        [this.elX, this.elY, this.elW, this.elH].forEach(el => el.step = step);

        if (!sel && !multi) {
            [this.elX, this.elY, this.elW, this.elH].forEach(el => {
                el.value = ''; el.disabled = true;
            });
            this.elArcRow.style.display = 'none';
            return;
        }

        let b;
        if (multi) {
            const shapes = this.state.selectedIds
                .map(id => this.state.shapes.find(s => s.id === id)).filter(Boolean);
            const bs = shapes.map(s => s.getBounds());
            const minX = Math.min(...bs.map(r => r.x));
            const minY = Math.min(...bs.map(r => r.y));
            const maxX = Math.max(...bs.map(r => r.x + r.width));
            const maxY = Math.max(...bs.map(r => r.y + r.height));
            b = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        } else {
            b = sel.getSelectionBounds?.() ?? sel.getBounds();
        }

        this.elX.value = this._toDisplay(b.x);
        this.elY.value = this._toDisplay(b.y);
        this.elW.value = this._toDisplay(b.width);
        this.elH.value = this._toDisplay(b.height);

        const canEdit   = sel && !multi && !sel.locked;
        const canMove   = canEdit && this._canMove(sel);
        const canResize = canEdit && this._canResize(sel);

        this.elX.disabled = !canMove;
        this.elY.disabled = !canMove;
        this.elW.disabled = !canResize;
        this.elH.disabled = !canResize;

        const isArc = !multi && sel?.type === 'arc';
        this.elArcRow.style.display = isArc ? '' : 'none';
        if (isArc) {
            this.elArc.value = Math.round(sel.arcAngleDeg ?? 90);
            this.elArc.disabled = !canEdit;
        }
    }
}
