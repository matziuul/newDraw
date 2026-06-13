const PX_SIZES = [[5,'5'],[10,'10'],[20,'20'],[50,'50'],[100,'100']];
const MM_SIZES = [[1,'1'],[2,'2'],[5,'5'],[10,'10']];

export class GridControls {
    constructor(state, renderer, ruler) {
        this.state = state;
        this.renderer = renderer;
        this.ruler = ruler;

        this._syncGridSizeSelect();
        this._attachEvents();
    }

    _attachEvents() {
        document.getElementById('cbGrid').addEventListener('change', e => {
            this.state.showGrid = e.target.checked;
            this.renderer.render();
        });
        document.getElementById('cbSnap').addEventListener('change', e => {
            this.state.snapToGrid = e.target.checked;
        });
        document.getElementById('selUnit').addEventListener('change', e => {
            this.state.rulerUnit = e.target.value;
            this._syncGridSizeSelect();
            this.ruler.rebuild();
            this.renderer.render();
        });
        document.getElementById('selGridSize').addEventListener('change', e => {
            const val = Number(e.target.value);
            if (this.state.rulerUnit === 'mm') this.state.gridSizeMm = val;
            else this.state.gridSizePx = val;
            if (this.state.showGrid) this.renderer.render();
        });
    }

    _syncGridSizeSelect() {
        const isMm = this.state.rulerUnit === 'mm';
        const sel = document.getElementById('selGridSize');
        sel.innerHTML = '';
        for (const [val, label] of (isMm ? MM_SIZES : PX_SIZES)) {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = label;
            sel.appendChild(opt);
        }
        sel.value = isMm ? this.state.gridSizeMm : this.state.gridSizePx;
    }
}
