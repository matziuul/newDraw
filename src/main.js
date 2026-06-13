import { AppState } from './state.js';
import { Renderer } from './renderer.js';
import { History } from './history.js';
import { Ruler } from './ruler.js';
import { Toolbar } from './toolbar.js';
import { ToolController } from './tool-controller.js';
import { GridControls } from './grid-controls.js';
import { MenuSystem } from './menus.js';
import { importMacFile } from './import.js';

const canvas   = document.getElementById('drawingCanvas');
const state    = new AppState();
const renderer = new Renderer(canvas, state);
const history  = new History(state);
const ruler    = new Ruler(
    document.getElementById('rulerH'),
    document.getElementById('rulerV'),
    state
);

const toolbar        = new Toolbar(state, renderer, history);
const toolController = new ToolController(state, renderer, history, ruler, canvas, toolbar);
new GridControls(state, renderer, ruler);

// ── File import ───────────────────────────────────────────────────────────────

const importInput = document.getElementById('importFile');
const elTool      = document.getElementById('statusTool');

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

// ── Menu system ───────────────────────────────────────────────────────────────

new MenuSystem({ state, history, renderer, canvas, importInput, toolController });

renderer.render();
