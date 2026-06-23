export class DebugPanel {
    /**
     * Creates the debug panel and wires up its close button.
     * @param {object} state - Shared application state (provides selectedId).
     * @param {object} renderer - The canvas renderer (used to redraw after selection change).
     */
    constructor(state, renderer) {
        this.state    = state;
        this.renderer = renderer;
        this.el       = document.getElementById('debugPanel');
        this.listEl   = document.getElementById('dbgList');
        this._rows    = new Map(); // shapeId → row element

        document.getElementById('dbgClose').addEventListener('click', () => this.hide());
    }

    /**
     * Returns true if the panel is currently visible on screen.
     * @returns {boolean}
     */
    get visible() { return this.el.style.display !== 'none' && this.el.style.display !== ''; }

    /** Makes the panel visible and syncs the selection highlight. */
    show() { this.el.style.display = 'flex'; this.syncSelection(); }

    /** Hides the panel. */
    hide() { this.el.style.display = 'none'; }

    /** Toggles the panel between visible and hidden. */
    toggle() { if (this.visible) this.hide(); else this.show(); }

    /**
     * Clears the list and rebuilds it from the given shape tree.
     * Call this whenever the shape list changes (load, delete, undo, etc.).
     * @param {object[]} shapes - Top-level shapes (may include groups with children).
     */
    populate(shapes) {
        this.listEl.innerHTML = '';
        this._rows.clear();
        const counter = { n: 0 };
        this._buildRows(shapes, 0, counter);
        this.syncSelection();
    }

    /**
     * Recursively walks the shape tree and appends one row per shape.
     * Groups are indented one level deeper than their parent.
     * @param {object[]} shapes - Shapes to render at this level.
     * @param {number} depth - Current nesting depth (0 = top-level).
     * @param {{ n: number }} counter - Shared sequential index that increments across all levels.
     */
    _buildRows(shapes, depth, counter) {
        for (const shape of shapes) {
            const idx = counter.n++;
            const row = this._makeRow(idx, shape, depth);
            this._rows.set(shape.id, row);
            this.listEl.appendChild(row);
            if (shape.children) this._buildRows(shape.children, depth + 1, counter);
        }
    }

    /**
     * Builds the DOM element for a single shape row.
     * The row shows: sequential index, source format (PICT opcode or DRW file offset),
     * indented type name, and a geometry summary. Clicking the row selects the shape.
     * @param {number} idx - Sequential row number across the whole list.
     * @param {object} shape - The shape to display.
     * @param {number} depth - Nesting depth used for indentation.
     * @returns {HTMLElement}
     */
    _makeRow(idx, shape, depth) {
        const row = document.createElement('div');
        row.className = 'dbg-row';

        const src = shape.debugSource;
        let srcPart;
        if (!src) {
            srcPart = '             ';
        } else if (src.format === 'PICT') {
            srcPart = `PICT 0x${src.opcode.toString(16).padStart(2, '0').toUpperCase()}`;
        } else {
            srcPart = `DRW  @${src.offset.toString(16).toUpperCase().padStart(4, '0')}`;
        }

        const indent   = '  '.repeat(depth);
        const typePart = (shape.type || '?').padEnd(10);
        const geomPart = this._geom(shape);

        row.textContent = `[${String(idx).padStart(3)}] ${srcPart.padEnd(11)}  ${indent}${typePart} ${geomPart}`;

        row.addEventListener('click', () => {
            this.state.selectedId  = shape.id;
            this.state.selectedIds = [];
            this.renderer.render();
        });

        return row;
    }

    /**
     * Returns a short human-readable geometry string for a shape,
     * e.g. "120,80  200×150" for a rectangle or "(0,0)→(100,50)" for a line.
     * Returns an empty string for unknown types.
     * @param {object} shape
     * @returns {string}
     */
    _geom(shape) {
        switch (shape.type) {
            case 'rectangle': case 'roundrect': case 'ellipse': case 'arc':
                return `${Math.round(shape.x)},${Math.round(shape.y)}  ${Math.round(shape.width)}×${Math.round(shape.height)}`;
            case 'line':
                return `(${Math.round(shape.x1)},${Math.round(shape.y1)})→(${Math.round(shape.x2)},${Math.round(shape.y2)})`;
            case 'bezier':
                return `${shape.points.length} pts`;
            case 'text':
                return `"${(shape.text || '').replace(/\n/g, '↵').slice(0, 24)}"`;
            case 'group':
                return `${(shape.children || []).length} children`;
            default:
                return '';
        }
    }

    /**
     * Highlights the row for the currently selected shape and scrolls it into view.
     * Safe to call at any time; does nothing when the panel is hidden.
     */
    syncSelection() {
        if (!this.visible) return;
        const selId = this.state.selectedId;
        for (const [id, row] of this._rows) {
            row.classList.toggle('dbg-active', id === selId);
        }
        if (selId !== null) {
            const active = this._rows.get(selId);
            if (active) active.scrollIntoView({ block: 'nearest' });
        }
    }
}
