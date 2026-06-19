export class DebugPanel {
    constructor(state, renderer) {
        this.state    = state;
        this.renderer = renderer;
        this.el       = document.getElementById('debugPanel');
        this.listEl   = document.getElementById('dbgList');
        this._rows    = new Map(); // shapeId → row element

        document.getElementById('dbgClose').addEventListener('click', () => this.hide());
    }

    get visible() { return this.el.style.display !== 'none' && this.el.style.display !== ''; }

    show() { this.el.style.display = 'flex'; this.syncSelection(); }
    hide() { this.el.style.display = 'none'; }
    toggle() { if (this.visible) this.hide(); else this.show(); }

    populate(shapes) {
        this.listEl.innerHTML = '';
        this._rows.clear();
        const counter = { n: 0 };
        this._buildRows(shapes, 0, counter);
        this.syncSelection();
    }

    _buildRows(shapes, depth, counter) {
        for (const shape of shapes) {
            const idx = counter.n++;
            const row = this._makeRow(idx, shape, depth);
            this._rows.set(shape.id, row);
            this.listEl.appendChild(row);
            if (shape.children) this._buildRows(shape.children, depth + 1, counter);
        }
    }

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
