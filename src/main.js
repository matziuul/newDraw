import { AppState } from './state.js';
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
        const snap = history.savePreOp();
        for (const s of result.shapes) state.shapes.push(s);
        history.commit(snap);
        renderer.render();
        elTool.textContent = `Imported ${result.shapes.length} shapes (${result.format})`;
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
        state.shapes     = result.shapes;
        state.selectedId  = null;
        state.selectedIds = [];
        history.reset();
        toolController.syncUI();
        elTool.textContent = `Opened ${result.shapes.length} shapes`;
    } catch (err) {
        elTool.textContent = `Open failed: ${err.message}`;
    }
});

const saveDoc = () => saveDocument(state.shapes, canvas.width, canvas.height);

// ── Menu system ───────────────────────────────────────────────────────────────

new MenuSystem({ state, history, renderer, canvas, importInput, docInput, saveDoc, toolController });

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

renderer.render();
