export const PX_PER_MM = 96 / 25.4;
export const PX_PER_IN = 96;

export class AppState {
    constructor() {
        this.activeTool = 'select';
        this.shapes = [];
        this.currentDraft = null;
        this.selectedId = null;
        this.activePatternIdx = 0;
        this.quickDraw = true;
        this.clipboard = null;
        this.dupOffset = { x: 10, y: 10 };
        this.lastDupId = null;
        this.lastDupSrcPos = null;
        this.hoveredBezierHandle = null;
        this.dragBezierHandle = null;
        this.hoveredArcHandle = null;  // 0=start, 1=end, null=none
        this.dragArcHandle    = null;
        this.selectedIds = [];   // multi-selection (non-empty only when >1 shapes selected)
        this.rubberBand  = null; // { x, y, w, h } while rubber-band drag is active

        this.toolSticky      = false; // true when tool was double-clicked (stays active)

        this.activeFont      = 'Geneva';
        this.activeFontSize  = 12;
        this.activeFontStyle = 0;
        this.editingTextId   = null; // id of TextShape currently open in overlay

        this.activeStrokeWidth      = 2;
        this.activeStrokeDash       = 0;
        this.activeStrokePatternIdx = 3;
        this.activeArrowMode        = 0;

        this.showGrid = false;
        this.snapToGrid = false;
        this.gridSizePx = 10;
        this.gridSizeMm = 5;
        this.gridSizeIn = 0.25;
        this.rulerUnit = 'px';

        this.rulerOriginX = 0;   // canvas pixel that maps to ruler value 0
        this.rulerOriginY = 0;
        this.rulerDragOrigin = null; // {x,y} while corner is being dragged

        this.pageW = null;   // px — page width for break markers; null = off
        this.pageH = null;   // px — page height for break markers
    }

    get selectedShape() {
        return this.shapes.find(s => s.id === this.selectedId) ?? null;
    }

    get gridStep() {
        if (this.rulerUnit === 'mm') return this.gridSizeMm * PX_PER_MM;
        if (this.rulerUnit === 'in') return this.gridSizeIn * PX_PER_IN;
        return this.gridSizePx;
    }
}
