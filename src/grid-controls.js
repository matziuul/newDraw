const PX_SIZES = [[5,'5'],[10,'10'],[20,'20'],[50,'50'],[100,'100']];
const MM_SIZES = [[1,'1'],[2,'2'],[5,'5'],[10,'10']];
const IN_SIZES = [[0.125,'1/8"'],[0.25,'1/4"'],[0.5,'1/2"'],[1,'1"']];

/**
 * Manages the grid and ruler-unit toolbar controls, keeping the DOM widgets
 * and application state in sync and triggering re-renders when values change.
 */
export class GridControls {
    /**
     * @param {import('./state.js').AppState} state - Shared application state.
     * @param {object} renderer - Renderer with a `render()` method.
     * @param {object} ruler - Ruler instance with a `rebuild()` method.
     */
    constructor(state, renderer, ruler) {
        this.state = state;
        this.renderer = renderer;
        this.ruler = ruler;

        // Browser restores form control states across reloads; read DOM → state
        // so both sides agree before the first render.
        state.showGrid   = document.getElementById('cbGrid').checked;
        state.snapToGrid = document.getElementById('cbSnap').checked;
        const unitVal = document.getElementById('selUnit').value;
        if (unitVal) state.rulerUnit = unitVal;

        this._syncGridSizeSelect();
        this._attachEvents();
    }

    /** Wires up change listeners for all four grid-related toolbar controls. */
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
            if      (this.state.rulerUnit === 'mm') this.state.gridSizeMm = val;
            else if (this.state.rulerUnit === 'in') this.state.gridSizeIn = val;
            else                                    this.state.gridSizePx = val;
            if (this.state.showGrid) this.renderer.render();
        });
    }

    /**
     * Repopulates the grid-size dropdown with values appropriate for the
     * current ruler unit (px / mm / in) and restores the previously selected size.
     */
    _syncGridSizeSelect() {
        const unit = this.state.rulerUnit;
        const sizes = unit === 'mm' ? MM_SIZES : unit === 'in' ? IN_SIZES : PX_SIZES;
        const cur   = unit === 'mm' ? this.state.gridSizeMm
                    : unit === 'in' ? this.state.gridSizeIn
                    :                 this.state.gridSizePx;
        const sel = document.getElementById('selGridSize');
        sel.innerHTML = '';
        for (const [val, label] of sizes) {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = label;
            sel.appendChild(opt);
        }
        sel.value = cur;
    }
}
