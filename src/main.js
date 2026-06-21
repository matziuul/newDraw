import { AppState, PX_PER_MM } from './state.js';
import { Renderer } from './renderer.js';
import { History } from './history.js';
import { Ruler } from './ruler.js';
import { Toolbar } from './toolbar.js';
import { ToolController } from './tool-controller.js';
import { GridControls } from './grid-controls.js';
import { MenuSystem } from './menus.js';
import { importMacFile } from './import.js';
import { Inspector } from './inspector.js';
import { saveDocument, loadDocument } from './document.js';
import { DebugPanel } from './debug-panel.js';

const canvas   = document.getElementById('drawingCanvas');
const state    = new AppState();
const renderer = new Renderer(canvas, state);
const history  = new History(state);
const ruler    = new Ruler(
    document.getElementById('rulerH'),
    document.getElementById('rulerV'),
    state
);

const textInput      = document.getElementById('textInput');
const toolbar        = new Toolbar(state, renderer, history);
const inspector      = new Inspector(state, renderer, history);
const toolController = new ToolController(state, renderer, history, ruler, canvas, toolbar, textInput);
toolController.inspector = inspector;
new GridControls(state, renderer, ruler);
const debugPanel = new DebugPanel(state, renderer);

// Sync debug panel highlight after every render
const _origRender = renderer.render.bind(renderer);
renderer.render = () => { _origRender(); debugPanel.syncSelection(); };

document.getElementById('dbgToggle').addEventListener('click', () => debugPanel.toggle());

// ── Canvas resize ─────────────────────────────────────────────────────────────

const PAPER_SIZES = {
    a4p: { w: 794,  h: 1123 },
    a4l: { w: 1123, h: 794  },
    ltp: { w: 816,  h: 1056 },
    ltl: { w: 1056, h: 816  },
};

const rulerH    = document.getElementById('rulerH');
const rulerV    = document.getElementById('rulerV');
const docWrap   = document.querySelector('.doc-wrap');
const zoomStage = document.querySelector('.zoom-stage');
const docDiv    = document.querySelector('.document');

// ── Zoom ──────────────────────────────────────────────────────────────────────
// baseW/baseH are the logical document size at zoom=1 (in canvas pixels).
// applyZoom scales the canvas resolution and all CSS sizes to match.
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
let baseW = 794, baseH = 1123;  // A4 portrait at 96 dpi

function applyZoom(z) {
    state.zoom = z;
    const w = Math.round(baseW * z);
    const h = Math.round(baseH * z);
    canvas.width  = w;
    canvas.height = h;
    rulerH.width  = w;  rulerH.style.width  = `${w}px`;
    rulerV.height = h;  rulerV.style.height = `${h}px`;
    docWrap.style.gridTemplateColumns = `20px ${w}px`;
    docWrap.style.gridTemplateRows    = `20px ${h}px`;
    docWrap.style.width  = `${w + 20}px`;
    docWrap.style.transform = '';
    docDiv.style.width   = `${w}px`;
    docDiv.style.height  = `${h}px`;
    zoomStage.style.width  = `${w + 20}px`;
    zoomStage.style.height = `${h + 20}px`;
    ruler.rebuild();
    renderer.render();
}

document.getElementById('zoomIn').addEventListener('click', () => {
    const i = ZOOM_LEVELS.findIndex(l => Math.abs(l - state.zoom) < 0.001);
    if (i < ZOOM_LEVELS.length - 1) applyZoom(ZOOM_LEVELS[i + 1]);
});
document.getElementById('zoomOut').addEventListener('click', () => {
    const i = ZOOM_LEVELS.findIndex(l => Math.abs(l - state.zoom) < 0.001);
    if (i > 0) applyZoom(ZOOM_LEVELS[i - 1]);
});

function resizeCanvas(w, h) {
    baseW = w;
    baseH = h;
    applyZoom(state.zoom);
}

function setupCanvasSizeDialog() {
    const dlg       = document.getElementById('canvasSizeDialog');
    const selPreset = document.getElementById('dlgPreset');
    const inpW      = document.getElementById('dlgW');
    const inpH      = document.getElementById('dlgH');
    const spanWmm   = document.getElementById('dlgWmm');
    const spanHmm   = document.getElementById('dlgHmm');
    const selMark   = document.getElementById('dlgMarkers');
    const btnCancel = document.getElementById('dlgCancel');
    const btnApply  = document.getElementById('dlgApply');

    const toMm = px => (px / PX_PER_MM).toFixed(1) + ' mm';
    const updateMm = () => {
        spanWmm.textContent = toMm(+inpW.value || 0);
        spanHmm.textContent = toMm(+inpH.value || 0);
    };

    selPreset.addEventListener('change', () => {
        const ps = PAPER_SIZES[selPreset.value];
        if (ps) { inpW.value = ps.w; inpH.value = ps.h; }
        updateMm();
    });

    inpW.addEventListener('input', () => { selPreset.value = ''; updateMm(); });
    inpH.addEventListener('input', () => { selPreset.value = ''; updateMm(); });

    btnCancel.addEventListener('click', () => dlg.close());

    btnApply.addEventListener('click', () => {
        const w = Math.max(100, Math.min(9999, Math.round(+inpW.value) || 800));
        const h = Math.max(100, Math.min(9999, Math.round(+inpH.value) || 600));
        resizeCanvas(w, h);
        const ps = PAPER_SIZES[selMark.value];
        state.pageW = ps ? ps.w : null;
        state.pageH = ps ? ps.h : null;
        renderer.render();
        dlg.close();
    });

    return () => {
        const logW = Math.round(canvas.width / (state.zoom ?? 1));
        const logH = Math.round(canvas.height / (state.zoom ?? 1));
        inpW.value = logW;
        inpH.value = logH;
        const matchPreset = Object.keys(PAPER_SIZES).find(k =>
            PAPER_SIZES[k].w === logW && PAPER_SIZES[k].h === logH);
        selPreset.value = matchPreset ?? '';
        const curKey = Object.keys(PAPER_SIZES).find(k =>
            PAPER_SIZES[k].w === state.pageW && PAPER_SIZES[k].h === state.pageH);
        selMark.value = curKey ?? '';
        updateMm();
        dlg.showModal();
    };
}

const openCanvasSizeDialog = setupCanvasSizeDialog();

// ── File I/O ──────────────────────────────────────────────────────────────────

const importInput = document.getElementById('importFile');
const docInput    = document.getElementById('docFile');
const elTool      = document.getElementById('statusTool');

// PICT / legacy import
importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    importInput.value = '';

    let buffer;
    try { buffer = await file.arrayBuffer(); }
    catch { elTool.textContent = 'Import: could not read file.'; return; }

    try {
        const result = importMacFile(buffer);
        if (result.shapes.length === 0) {
            elTool.textContent = `Import: no shapes found in ${result.format} file.`;
            return;
        }
        if (result.canvasWidth && result.canvasHeight)
            resizeCanvas(result.canvasWidth, result.canvasHeight);
        const snap = history.savePreOp();
        for (const s of result.shapes) state.shapes.push(s);
        history.commit(snap);
        renderer.render();
        const sizeInfo = result.canvasWidth
            ? `  (canvas ${result.canvasWidth}×${result.canvasHeight}px)`
            : '';
        elTool.textContent = `Imported ${result.shapes.length} shapes (${result.format})${sizeInfo}`;
        debugPanel.populate(result.shapes);
    } catch (err) {
        elTool.textContent = `Import failed: ${err.message}`;
    }
});

// Native document open
docInput.addEventListener('change', async () => {
    const file = docInput.files[0];
    if (!file) return;
    docInput.value = '';

    let buffer;
    try { buffer = await file.arrayBuffer(); }
    catch { elTool.textContent = 'Open: could not read file.'; return; }

    try {
        const result = loadDocument(buffer);
        state.shapes      = result.shapes;
        state.selectedId  = null;
        state.selectedIds = [];
        history.reset();
        if (result.canvasWidth && result.canvasHeight)
            resizeCanvas(result.canvasWidth, result.canvasHeight);
        toolController.syncUI();
        elTool.textContent = `Opened ${result.shapes.length} shapes`;
    } catch (err) {
        elTool.textContent = `Open failed: ${err.message}`;
    }
});

const saveDoc = () => saveDocument(state.shapes, canvas.width, canvas.height);

// ── Menu system ───────────────────────────────────────────────────────────────

new MenuSystem({ state, history, renderer, canvas, importInput, docInput, saveDoc, toolController, onCanvasSize: openCanvasSizeDialog });

// ── Ruler origin drag (click-and-drag on the corner square) ───────────────────

const rulerCorner = document.querySelector('.ruler-corner');
if (rulerCorner) {
    rulerCorner.style.cursor = 'crosshair';
    rulerCorner.title = 'Drag to set ruler origin  |  Double-click to reset';

    let cornerDragging = false;

    const getCanvasPos = e => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.round(e.clientX - rect.left),
            y: Math.round(e.clientY - rect.top),
        };
    };

    rulerCorner.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        cornerDragging = true;
        state.rulerDragOrigin = getCanvasPos(e);
        ruler.render();
        renderer.render();
        e.preventDefault();
    });

    rulerCorner.addEventListener('dblclick', () => {
        state.rulerOriginX = 0;
        state.rulerOriginY = 0;
        ruler.rebuild();
        renderer.render();
    });

    document.addEventListener('mousemove', e => {
        if (!cornerDragging) return;
        state.rulerDragOrigin = getCanvasPos(e);
        ruler.render();
        renderer.render();
    });

    document.addEventListener('mouseup', e => {
        if (!cornerDragging) return;
        cornerDragging = false;
        const p = getCanvasPos(e);
        state.rulerDragOrigin = null;
        state.rulerOriginX = Math.max(0, p.x);
        state.rulerOriginY = Math.max(0, p.y);
        ruler.rebuild();
        renderer.render();
    });
}

applyZoom(state.zoom);
renderer.render();
