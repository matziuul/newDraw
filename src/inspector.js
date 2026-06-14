import { offsetShape } from './shapes.js';

export class Inspector {
    constructor(state, renderer, history) {
        this.state    = state;
        this.renderer = renderer;
        this.history  = history;

        this.elX    = document.getElementById('inspX');
        this.elY    = document.getElementById('inspY');
        this.elW    = document.getElementById('inspW');
        this.elH    = document.getElementById('inspH');
        this.elUnit = document.getElementById('inspUnit');

        this._attachEvents();
        document.getElementById('selUnit')
            .addEventListener('change', () => this.sync());
    }

    _attachEvents() {
        const apply = (el, field) => {
            el.addEventListener('change', () => this._applyField(field, el));
            el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
        };
        apply(this.elX, 'x');
        apply(this.elY, 'y');
        apply(this.elW, 'w');
        apply(this.elH, 'h');
    }

    _toPx(v) {
        return this.state.rulerUnit === 'mm' ? v * 96 / 25.4 : v;
    }

    _toDisplay(px) {
        if (this.state.rulerUnit === 'mm') return +(px * 25.4 / 96).toFixed(2);
        return Math.round(px);
    }

    _canResize(shape) {
        return shape.type === 'rectangle' || shape.type === 'roundrect' || shape.type === 'ellipse' || shape.type === 'arc';
    }

    _canMove(shape) {
        return shape.type !== 'group';
    }

    _applyField(field, el) {
        const sel = this.state.selectedShape;
        if (!sel || sel.locked) { this.sync(); return; }

        const val = this._toPx(parseFloat(el.value));
        if (isNaN(val) || val < 0 && (field === 'w' || field === 'h')) {
            this.sync(); return;
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

    sync() {
        const sel   = this.state.selectedShape;
        const multi = this.state.selectedIds.length > 1;
        const isMm  = this.state.rulerUnit === 'mm';
        const step  = isMm ? '0.01' : '1';

        this.elUnit.textContent = isMm ? 'mm' : 'px';
        [this.elX, this.elY, this.elW, this.elH].forEach(el => el.step = step);

        if (!sel && !multi) {
            [this.elX, this.elY, this.elW, this.elH].forEach(el => {
                el.value = ''; el.disabled = true;
            });
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
    }
}
