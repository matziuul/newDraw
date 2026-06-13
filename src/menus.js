import { nextUid, offsetShape, GroupShape } from './shapes.js';
import { printDrawing } from './print.js';

const MENUS = [
    { id: 'file', label: 'File', items: [
        { label: 'Open…',  kbd: '⌘O', action: 'open'  },
        { label: 'Print…', kbd: '⌘P', action: 'print' },
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
];

export class MenuSystem {
    constructor({ state, history, renderer, canvas, importInput, toolController }) {
        this.state    = state;
        this.history  = history;
        this.renderer = renderer;
        this.canvas   = canvas;
        this.importInput = importInput;
        this.tc = toolController;

        this._open = null;
        this._build();
        this._attachGlobal();
    }

    // ── Build DOM ─────────────────────────────────────────────────────────────

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
                } else {
                    const row = document.createElement('div');
                    row.className = 'menu-row';
                    row.dataset.action = item.action;
                    if (item.needs) row.dataset.needs = item.needs;

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
        for (const lbl of ['Draw', 'Text']) {
            const span = document.createElement('span');
            span.className = 'menu-head menu-head-dimmed';
            span.textContent = lbl;
            bar.appendChild(span);
        }
    }

    // ── Dropdown open / close ─────────────────────────────────────────────────

    _openDrop(id, head, drop) {
        this._closeAll();
        this._open = id;
        head.classList.add('open');
        drop.classList.add('open');
        this._updateRowStates(drop);
    }

    _closeAll() {
        this._open = null;
        document.querySelectorAll('.menu-head.open').forEach(h => h.classList.remove('open'));
        document.querySelectorAll('.menu-drop.open').forEach(d => d.classList.remove('open'));
    }

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
    }

    // ── Global event listeners ────────────────────────────────────────────────

    _attachGlobal() {
        document.addEventListener('mousedown', e => {
            if (!e.target.closest('.menu-wrap')) this._closeAll();
        });

        // Shortcuts not handled by ToolController: File and Arrange
        document.addEventListener('keydown', e => {
            const cmd = e.metaKey || e.ctrlKey;
            if (!cmd) return;

            if (e.key === 'o') {
                e.preventDefault(); this._execute('open'); return;
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
        });
    }

    // ── Action dispatch ───────────────────────────────────────────────────────

    _execute(action) {
        const { state, history, renderer } = this;
        const sel = state.selectedShape;

        switch (action) {

            // File
            case 'open':  this.importInput.click(); return;
            case 'print': printDrawing(state.shapes, this.canvas.width, this.canvas.height); return;

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

            case 'delete':
                if (state.selectedId && !sel?.locked) {
                    const snap = history.savePreOp();
                    state.shapes = state.shapes.filter(s => s.id !== state.selectedId);
                    state.selectedId = null;
                    history.commit(snap);
                    this.tc.syncUI();
                }
                return;

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
                renderer.render();
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
        }
    }

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

// ── Shape transform helpers ───────────────────────────────────────────────────

function applyTransform(shape, op) {
    const b  = shape.getBounds();
    const cx = b.x + b.width  / 2;
    const cy = b.y + b.height / 2;
    const fn = _makeFn(op, cx, cy);
    _applyFn(shape, fn);
}

function _makeFn(op, cx, cy) {
    if (op === 'flipH')      return (x, y) => ({ x: 2 * cx - x, y });
    if (op === 'flipV')      return (x, y) => ({ x, y: 2 * cy - y });
    if (op === 'rotate90CW') return (x, y) => ({ x: cx + (y - cy), y: cy - (x - cx) });
    /* rotate90CCW */        return (x, y) => ({ x: cx - (y - cy), y: cy + (x - cx) });
}

function _applyFn(shape, fn) {
    if (shape.type === 'line') {
        const p1 = fn(shape.x1, shape.y1), p2 = fn(shape.x2, shape.y2);
        shape.x1 = p1.x; shape.y1 = p1.y; shape.x2 = p2.x; shape.y2 = p2.y;

    } else if (shape.type === 'bezier') {
        for (const p of shape.points) {
            const a = fn(p.x, p.y), c1 = fn(p.c1x, p.c1y), c2 = fn(p.c2x, p.c2y);
            p.x = a.x; p.y = a.y; p.c1x = c1.x; p.c1y = c1.y; p.c2x = c2.x; p.c2y = c2.y;
        }

    } else if (shape.type === 'group') {
        // All children transform around the group's center (fn already has cx/cy baked in)
        for (const child of shape.children) _applyFn(child, fn);

    } else {
        // rect / ellipse: transform corners → new axis-aligned bounding box
        const corners = [
            fn(shape.x,               shape.y),
            fn(shape.x + shape.width, shape.y),
            fn(shape.x,               shape.y + shape.height),
            fn(shape.x + shape.width, shape.y + shape.height),
        ];
        const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
        shape.x      = Math.min(...xs);
        shape.y      = Math.min(...ys);
        shape.width  = Math.max(...xs) - shape.x;
        shape.height = Math.max(...ys) - shape.y;
    }
}
