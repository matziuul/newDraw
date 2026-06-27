import { nextUid, offsetShape, GroupShape, applyTransform } from './shapes.js';
import { FONTS, FONT_SIZES, STYLE_DEFS } from './text-defs.js';
import { printDrawing } from './print.js';
import { exportSvg } from './svg-export.js';

const MENUS = [
    { id: 'file', label: 'File', items: [
        { label: 'New',          kbd: '⌘N', action: 'new'         },
        { label: 'Open…',        kbd: '⌘O', action: 'open'        },
        '-',
        { label: 'Import PICT…',            action: 'importPict'  },
        '-',
        { label: 'Save…',        kbd: '⌘S', action: 'save'        },
        '-',
        { label: 'Export SVG…',              action: 'exportSvg'   },
        '-',
        { label: 'Canvas Size…',             action: 'canvasSize'  },
        '-',
        { label: 'Print…',       kbd: '⌘P', action: 'print'       },
    ]},
    { id: 'edit', label: 'Edit', items: [
        { label: 'Undo',      kbd: '⌘Z',        action: 'undo'      },
        { label: 'Redo',      kbd: '⇧⌘Z',  action: 'redo'      },
        '-',
        { label: 'Copy',      kbd: '⌘C',        action: 'copy',      needs: 'sel'  },
        { label: 'Paste',     kbd: '⌘V',        action: 'paste',     needs: 'clip' },
        { label: 'Duplicate', kbd: '⌘D',        action: 'duplicate', needs: 'sel'  },
        { label: 'Delete',    kbd: '⌫',         action: 'delete',    needs: 'sel'  },
    ]},
    { id: 'arrange', label: 'Arrange', items: [
        { label: 'Group',   kbd: '⌘G',        action: 'group',   needs: 'multi' },
        { label: 'Ungroup', kbd: '⇧⌘G',  action: 'ungroup', needs: 'group' },
        '-',
        { label: 'Bring to Front', kbd: '⌘]',        action: 'bringToFront', needs: 'sel' },
        { label: 'Bring Forward',  kbd: '⌘⌥]',  action: 'bringForward', needs: 'sel' },
        { label: 'Send Backward',  kbd: '⌘⌥[',  action: 'sendBackward', needs: 'sel' },
        { label: 'Send to Back',   kbd: '⌘[',        action: 'sendToBack',   needs: 'sel' },
        '-',
        { label: 'Flip Horizontal',   action: 'flipH',       needs: 'sel' },
        { label: 'Flip Vertical',     action: 'flipV',       needs: 'sel' },
        { label: 'Rotate 90\xb0 CW',  action: 'rotate90CW',  needs: 'sel' },
        { label: 'Rotate 90\xb0 CCW', action: 'rotate90CCW', needs: 'sel' },
        '-',
        { label: 'Lock',   kbd: '⌘L',        action: 'lock',   needs: 'sel' },
        { label: 'Unlock', kbd: '⇧⌘L',  action: 'unlock', needs: 'sel' },
    ]},
    { id: 'text', label: 'Text', items: [
        { label: 'Font', sub: FONTS.map(f => ({ label: f.name, action: `font:${f.name}` })) },
        { label: 'Size', sub: FONT_SIZES.map(s => ({ label: String(s), action: `size:${s}` })) },
        '-',
        ...STYLE_DEFS.map(s => ({ label: s.name, kbd: s.kbd ?? null, action: `textStyle:${s.id}` })),
    ]},
    { id: 'window', label: 'Window', items: [
        { label: 'Colors…', kbd: '⇧⌘K', action: 'showColors' },
    ]},
];

/** Manages the application menu bar: builds the DOM, handles open/close state, and dispatches menu actions. */
export class MenuSystem {
    /**
     * @param {object} opts
     * @param {object} opts.state - Shared application state (shapes, selection, clipboard, etc.).
     * @param {object} opts.history - Undo/redo history manager.
     * @param {object} opts.renderer - Canvas renderer used to trigger redraws.
     * @param {HTMLCanvasElement} opts.canvas - The main drawing canvas (provides width/height for export).
     * @param {HTMLInputElement} opts.importInput - Hidden file input for PICT import.
     * @param {HTMLInputElement} opts.docInput - Hidden file input for opening saved documents.
     * @param {Function} opts.saveDoc - Callback that saves the current document.
     * @param {object} opts.toolController - Tool controller whose `syncUI` and `syncOverlayStyle` keep the UI consistent after state changes.
     * @param {Function} [opts.onCanvasSize] - Optional callback invoked when the user chooses "Canvas Size…".
     */
    constructor({ state, history, renderer, canvas, importInput, docInput, saveDoc, toolController, onCanvasSize }) {
        this.state    = state;
        this.history  = history;
        this.renderer = renderer;
        this.canvas   = canvas;
        this.importInput = importInput;
        this.docInput    = docInput;
        this.saveDoc     = saveDoc;
        this.tc = toolController;
        this.onCanvasSize = onCanvasSize;

        this._open = null;
        this._build();
        this._attachGlobal();
    }

    // ── Build DOM ─────────────────────────────────────────────────────────────

    /** Constructs and inserts all menu DOM nodes into `.menu-bar`, including dropdowns and sub-menus. */
    _build() {
        const bar = document.querySelector('.menu-bar');
        const title = bar.querySelector('.menu-title');
        bar.innerHTML = '';
        if (title) bar.appendChild(title);

        for (const def of MENUS) {
            const wrap = document.createElement('div');
            wrap.className = 'menu-wrap';

            const head = document.createElement('span');
            head.className = 'menu-head';
            head.textContent = def.label;

            const drop = document.createElement('div');
            drop.className = 'menu-drop';

            for (const item of def.items) {
                if (item === '-') {
                    const sep = document.createElement('hr');
                    sep.className = 'menu-sep';
                    drop.appendChild(sep);
                } else if (item.sub) {
                    // Sub-menu row
                    const row = document.createElement('div');
                    row.className = 'menu-row menu-has-sub';
                    if (item.needs) row.dataset.needs = item.needs;

                    const chk = document.createElement('span');
                    chk.className = 'menu-check'; chk.textContent = '✓';
                    row.appendChild(chk);

                    const lbl = document.createElement('span');
                    lbl.textContent = item.label;
                    row.appendChild(lbl);

                    const arr = document.createElement('span');
                    arr.className = 'menu-arr'; arr.textContent = '▶';
                    row.appendChild(arr);

                    const sub = document.createElement('div');
                    sub.className = 'menu-sub';
                    for (const si of item.sub) {
                        const sRow = document.createElement('div');
                        sRow.className = 'menu-row';
                        sRow.dataset.action = si.action;

                        const sChk = document.createElement('span');
                        sChk.className = 'menu-check'; sChk.textContent = '✓';
                        sRow.appendChild(sChk);

                        const sLbl = document.createElement('span');
                        sLbl.textContent = si.label;
                        sRow.appendChild(sLbl);

                        sRow.addEventListener('mousedown', e => {
                            e.preventDefault();
                            this._closeAll();
                            this._execute(si.action);
                        });
                        sub.appendChild(sRow);
                    }
                    row.appendChild(sub);
                    drop.appendChild(row);
                } else {
                    const row = document.createElement('div');
                    row.className = 'menu-row';
                    row.dataset.action = item.action;
                    if (item.needs) row.dataset.needs = item.needs;

                    const chk = document.createElement('span');
                    chk.className = 'menu-check'; chk.textContent = '✓';
                    row.appendChild(chk);

                    const lbl = document.createElement('span');
                    lbl.textContent = item.label;
                    row.appendChild(lbl);

                    if (item.kbd) {
                        const kbd = document.createElement('span');
                        kbd.className = 'menu-kbd';
                        kbd.textContent = item.kbd;
                        row.appendChild(kbd);
                    }

                    row.addEventListener('mousedown', e => {
                        e.preventDefault();
                        if (row.classList.contains('disabled')) return;
                        this._closeAll();
                        this._execute(item.action);
                    });
                    drop.appendChild(row);
                }
            }

            head.addEventListener('mousedown', e => {
                e.preventDefault();
                this._open === def.id ? this._closeAll() : this._openDrop(def.id, head, drop);
            });
            head.addEventListener('mouseenter', () => {
                if (this._open && this._open !== def.id) this._openDrop(def.id, head, drop);
            });

            wrap.appendChild(head);
            wrap.appendChild(drop);
            bar.appendChild(wrap);
        }

        // Static non-interactive titles
        const drawSpan = document.createElement('span');
        drawSpan.className = 'menu-head menu-head-dimmed';
        drawSpan.textContent = 'Draw';
        bar.appendChild(drawSpan);
    }

    // ── Dropdown open / close ─────────────────────────────────────────────────

    /**
     * Opens the dropdown for the given menu, closing any currently open menu first.
     * Also refreshes item enabled/checked states before the dropdown becomes visible.
     * @param {string} id - The menu id (e.g. `'file'`, `'edit'`).
     * @param {HTMLElement} head - The clickable menu-header element to mark as open.
     * @param {HTMLElement} drop - The dropdown panel element to show.
     */
    _openDrop(id, head, drop) {
        this._closeAll();
        this._open = id;
        head.classList.add('open');
        drop.classList.add('open');
        this._updateRowStates(drop);
    }

    /** Closes every open dropdown and clears the tracked open-menu id. */
    _closeAll() {
        this._open = null;
        document.querySelectorAll('.menu-head.open').forEach(h => h.classList.remove('open'));
        document.querySelectorAll('.menu-drop.open').forEach(d => d.classList.remove('open'));
    }

    /**
     * Refreshes the enabled/disabled state of all rows in a dropdown based on the current
     * selection and clipboard, and updates checkmarks for the active font, size, and style.
     * @param {HTMLElement} drop - The dropdown panel whose rows should be updated.
     */
    _updateRowStates(drop) {
        const hasSel   = !!this.state.selectedId;
        const hasClip  = !!this.state.clipboard;
        const hasMulti = this.state.selectedIds.length > 1;
        const hasGroup = this.state.selectedShape?.type === 'group';
        drop.querySelectorAll('.menu-row').forEach(row => {
            const n = row.dataset.needs;
            row.classList.toggle('disabled',
                (n === 'sel'   && !hasSel)   ||
                (n === 'clip'  && !hasClip)  ||
                (n === 'multi' && !hasMulti) ||
                (n === 'group' && !hasGroup)
            );
        });

        // Update text-menu checkmarks (font, size, style)
        const af = this.state.activeFont;
        const as = this.state.activeFontSize;
        const ast = this.state.activeFontStyle;

        const setCheck = (row, checked) => {
            row.classList.toggle('checked', checked);
            const chk = row.querySelector(':scope > .menu-check');
            if (chk) chk.style.visibility = checked ? 'visible' : 'hidden';
        };

        drop.querySelectorAll('.menu-row[data-action^="font:"]').forEach(r =>
            setCheck(r, r.dataset.action.slice(5) === af));
        drop.querySelectorAll('.menu-row[data-action^="size:"]').forEach(r =>
            setCheck(r, parseInt(r.dataset.action.slice(5)) === as));
        drop.querySelectorAll('.menu-row[data-action^="textStyle:"]').forEach(r => {
            const bit = parseInt(r.dataset.action.slice(10));
            setCheck(r, bit === 0 ? (ast === 0) : !!(ast & bit));
        });
    }

    // ── Global event listeners ────────────────────────────────────────────────

    /**
     * Registers document-level event listeners for closing menus on outside clicks
     * and for handling keyboard shortcuts that belong to the menu system (File, Arrange, Text).
     */
    _attachGlobal() {
        document.addEventListener('mousedown', e => {
            if (!e.target.closest('.menu-wrap')) this._closeAll();
        });

        // Shortcuts not handled by ToolController: File, Arrange, Text
        document.addEventListener('keydown', e => {
            // Don't intercept when text overlay is focused
            if (document.activeElement?.id === 'textInput') return;

            const cmd = e.metaKey || e.ctrlKey;
            if (!cmd) return;

            if (e.key === 'n') {
                e.preventDefault(); this._execute('new'); return;
            }
            if (e.key === 'o') {
                e.preventDefault(); this._execute('open'); return;
            }
            if (e.key === 's' && !e.shiftKey) {
                e.preventDefault(); this._execute('save'); return;
            }
            if (e.key === 'g' && !e.shiftKey) {
                e.preventDefault(); this._execute('group'); return;
            }
            if (e.key === 'g' && e.shiftKey) {
                e.preventDefault(); this._execute('ungroup'); return;
            }
            if (e.key === ']' && !e.altKey) {
                e.preventDefault(); this._execute('bringToFront'); return;
            }
            if (e.key === '[' && !e.altKey) {
                e.preventDefault(); this._execute('sendToBack'); return;
            }
            if (e.key === ']' && e.altKey) {
                e.preventDefault(); this._execute('bringForward'); return;
            }
            if (e.key === '[' && e.altKey) {
                e.preventDefault(); this._execute('sendBackward'); return;
            }
            if (e.key === 'l' && !e.shiftKey) {
                e.preventDefault(); this._execute('lock'); return;
            }
            if (e.key === 'l' && e.shiftKey) {
                e.preventDefault(); this._execute('unlock'); return;
            }
            if (e.key === 't' && !e.shiftKey) {
                e.preventDefault(); this._execute('textStyle:0'); return;
            }
            if (e.key === 'b' && !e.shiftKey) {
                e.preventDefault(); this._execute('textStyle:1'); return;
            }
            if (e.key === 'i' && !e.shiftKey) {
                e.preventDefault(); this._execute('textStyle:2'); return;
            }
            if (e.key === 'u' && !e.shiftKey) {
                e.preventDefault(); this._execute('textStyle:4');
            }
            if (e.key === 'k' && e.shiftKey) {
                e.preventDefault(); this._execute('showColors');
            }
        });
    }

    // ── Action dispatch ───────────────────────────────────────────────────────

    /**
     * Dispatches a named menu action, mutating state and committing to history as needed.
     * Covers File (new/open/save/export/print), Edit (undo/redo/copy/paste/duplicate/delete),
     * Arrange (group/ungroup/layer order/transforms/lock), and Text (font/size/style) actions.
     * @param {string} action - The action identifier, e.g. `'save'`, `'group'`, `'font:Helvetica'`, `'textStyle:1'`.
     */
    _execute(action) {
        const { state, history, renderer } = this;
        const sel = state.selectedShape;

        switch (action) {

            // File
            case 'new': {
                if (state.shapes.length && !confirm('Starta nytt dokument? Osparade ändringar går förlorade.')) return;
                state.shapes = [];
                state.selectedId = null;
                state.selectedIds = [];
                this.history.reset();
                this.tc.syncUI();
                return;
            }
            case 'open':       this.docInput.click(); return;
            case 'importPict': this.importInput.click(); return;
            case 'save':       this.saveDoc(); return;
            case 'canvasSize': this.onCanvasSize?.(); return;
            case 'exportSvg':  exportSvg(state.shapes, this.canvas.width, this.canvas.height); return;
            case 'print':      printDrawing(state.shapes, this.canvas.width, this.canvas.height); return;

            // Edit (mirrors logic in ToolController._onKey; syncUI() updates status + toolbar)
            case 'undo': if (history.undo()) this.tc.syncUI(); return;
            case 'redo': if (history.redo()) this.tc.syncUI(); return;

            case 'copy':
                if (sel) { state.clipboard = sel.clone(); state.clipboard.id = sel.id; }
                return;

            case 'paste': {
                const cb = state.clipboard;
                if (!cb) return;
                const snap = history.savePreOp();
                const pasted = cb.clone();
                pasted.id = nextUid();
                offsetShape(pasted, 10, 10);
                state.shapes.push(pasted);
                state.selectedId = pasted.id;
                state.clipboard = pasted.clone();
                history.commit(snap);
                this.tc.syncUI();
                return;
            }

            case 'duplicate':
                if (sel) {
                    const snap = history.savePreOp();
                    const dup = sel.clone();
                    dup.id = nextUid();
                    offsetShape(dup, state.dupOffset.x, state.dupOffset.y);
                    state.shapes.push(dup);
                    state.selectedId = dup.id;
                    history.commit(snap);
                    this.tc.syncUI();
                }
                return;

            case 'delete': {
                const ids = state.selectedIds.length > 1
                    ? state.selectedIds
                    : (state.selectedId ? [state.selectedId] : []);
                const toDelete = ids.filter(id => {
                    const s = state.shapes.find(sh => sh.id === id);
                    return s && !s.locked;
                });
                if (!toDelete.length) return;
                const snap = history.savePreOp();
                state.shapes = state.shapes.filter(s => !toDelete.includes(s.id));
                state.selectedId  = null;
                state.selectedIds = [];
                history.commit(snap);
                this.tc.syncUI();
                return;
            }

            // Text — font
            default: {
                if (action.startsWith('font:')) {
                    const name = action.slice(5);
                    state.activeFont = name;
                    if (sel?.type === 'text') {
                        const snap = history.savePreOp();
                        sel.fontFamily = name; history.commit(snap); renderer.render();
                    }
                    this.tc.syncOverlayStyle();
                    return;
                }
                if (action.startsWith('size:')) {
                    const sz = parseInt(action.slice(5));
                    state.activeFontSize = sz;
                    if (sel?.type === 'text') {
                        const snap = history.savePreOp();
                        sel.fontSize = sz; history.commit(snap); renderer.render();
                    }
                    this.tc.syncOverlayStyle();
                    return;
                }
                if (action.startsWith('textStyle:')) {
                    const bit = parseInt(action.slice(10));
                    const current = sel?.type === 'text' ? sel.fontStyle : state.activeFontStyle;
                    const next = bit === 0 ? 0 : (current ^ bit);
                    state.activeFontStyle = next;
                    if (sel?.type === 'text') {
                        const snap = history.savePreOp();
                        sel.fontStyle = next; history.commit(snap); renderer.render();
                    }
                    this.tc.syncOverlayStyle();
                    return;
                }
                return;
            }

            // Arrange — group / ungroup
            case 'group': {
                const ids = state.selectedIds.length > 1 ? state.selectedIds : [];
                if (ids.length < 2) return;
                const snap = history.savePreOp();
                const ordered = state.shapes.filter(s => ids.includes(s.id));
                const firstIdx = state.shapes.findIndex(s => ids.includes(s.id));
                state.shapes = state.shapes.filter(s => !ids.includes(s.id));
                const group = new GroupShape(ordered);
                state.shapes.splice(firstIdx, 0, group);
                state.selectedId  = group.id;
                state.selectedIds = [];
                history.commit(snap);
                this.tc.syncUI();
                return;
            }

            case 'ungroup': {
                if (!sel || sel.type !== 'group') return;
                const snap = history.savePreOp();
                const idx = state.shapes.indexOf(sel);
                state.shapes.splice(idx, 1, ...sel.children);
                state.selectedId  = null;
                state.selectedIds = sel.children.map(c => c.id);
                history.commit(snap);
                this.tc.syncUI();
                return;
            }

            // Arrange — layer order
            case 'bringToFront': this._reorder(1); return;
            case 'sendToBack':   this._reorder(-1); return;
            case 'bringForward': this._reorder(2); return;
            case 'sendBackward': this._reorder(-2); return;

            // Arrange — transforms
            case 'flipH':
            case 'flipV':
            case 'rotate90CW':
            case 'rotate90CCW':
                if (sel) {
                    const snap = history.savePreOp();
                    applyTransform(sel, action);
                    history.commit(snap);
                    renderer.render();
                }
                return;

            // Arrange — lock
            case 'lock':
                if (sel && !sel.locked) {
                    const snap = history.savePreOp();
                    sel.locked = true;
                    history.commit(snap);
                    renderer.render();
                }
                return;

            case 'unlock':
                if (sel && sel.locked) {
                    const snap = history.savePreOp();
                    sel.locked = false;
                    history.commit(snap);
                    renderer.render();
                }
                return;

            case 'showColors': this.onShowColors?.(); return;
        }
    }

    /**
     * Changes the z-order of the currently selected shape in the shapes array and commits the change.
     * @param {1 | -1 | 2 | -2} mode - `1` = bring to front, `-1` = send to back, `2` = bring forward one step, `-2` = send backward one step.
     */
    _reorder(mode) {
        const { state, history, renderer } = this;
        const sel = state.selectedShape;
        if (!sel) return;
        const arr = state.shapes;
        const idx = arr.indexOf(sel);
        if (idx < 0) return;

        let moved = false;
        if (mode === 1 && idx < arr.length - 1) {           // Bring to Front
            const snap = history.savePreOp();
            arr.push(arr.splice(idx, 1)[0]);
            history.commit(snap); moved = true;
        } else if (mode === -1 && idx > 0) {                // Send to Back
            const snap = history.savePreOp();
            arr.unshift(arr.splice(idx, 1)[0]);
            history.commit(snap); moved = true;
        } else if (mode === 2 && idx < arr.length - 1) {    // Bring Forward
            const snap = history.savePreOp();
            [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
            history.commit(snap); moved = true;
        } else if (mode === -2 && idx > 0) {                // Send Backward
            const snap = history.savePreOp();
            [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
            history.commit(snap); moved = true;
        }
        if (moved) renderer.render();
    }
}

