import { QD_PATTERNS, buildPattern } from './patterns.js';

const STROKE_WIDTHS = [1, 2, 3, 4, 6, 8];

export class Toolbar {
    constructor(state, renderer, history) {
        this.state = state;
        this.renderer = renderer;
        this.history = history;
        this.buttons = document.querySelectorAll('.tool-button');
        this.elTool  = document.getElementById('statusTool');
        this._buildSwatches();
        this._buildStrokeSwatches();
        this._attachEvents();
    }

    _buildSwatches() {
        const grid = document.getElementById('patternGrid');
        QD_PATTERNS.forEach((p, idx) => {
            const cv = document.createElement('canvas');
            cv.width = 22; cv.height = 22;
            cv.className = 'pattern-swatch';
            cv.title = p.name;
            if (idx === 0) cv.classList.add('active');
            const ctx = cv.getContext('2d');

            if (p.rows === null) {
                ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 22, 22);
                ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(22,22);
                ctx.moveTo(22,0); ctx.lineTo(0,22); ctx.stroke();
            } else {
                ctx.fillStyle = buildPattern(ctx, p.rows);
                ctx.fillRect(0, 0, 22, 22);
            }
            ctx.strokeStyle = 'black'; ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, 21, 21);

            cv.addEventListener('click', () => {
                this.state.activePatternIdx = idx;
                const sel = this.state.selectedShape;
                if (sel) {
                    const snap = this.history.savePreOp();
                    sel.fillIdx = idx;
                    this.history.commit(snap);
                    this.renderer.render();
                }
                this.sync();
            });
            grid.appendChild(cv);
        });
    }

    _buildStrokeSwatches() {
        const grid = document.getElementById('strokeGrid');
        STROKE_WIDTHS.forEach(w => {
            const cv = document.createElement('canvas');
            cv.width = 48; cv.height = 16;
            cv.className = 'stroke-swatch';
            cv.title = `${w}px`;
            if (w === this.state.activeStrokeWidth) cv.classList.add('active');
            const ctx = cv.getContext('2d');
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 48, 16);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = w;
            ctx.lineCap = 'butt';
            ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(44, 8); ctx.stroke();
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, 47, 15);

            cv.addEventListener('click', () => {
                this.state.activeStrokeWidth = w;
                const sel = this.state.selectedShape;
                if (sel) {
                    const snap = this.history.savePreOp();
                    sel.strokeWidth = w;
                    this.history.commit(snap);
                    this.renderer.render();
                }
                this.sync();
            });
            grid.appendChild(cv);
        });
    }

    sync() {
        document.querySelectorAll('.pattern-swatch').forEach((s, i) =>
            s.classList.toggle('active', i === this.state.activePatternIdx));
        document.querySelectorAll('.stroke-swatch').forEach((s, i) =>
            s.classList.toggle('active', STROKE_WIDTHS[i] === this.state.activeStrokeWidth));
    }

    _attachEvents() {
        this.buttons.forEach(btn => {
            btn.addEventListener('click',    () => this._select(btn.dataset.tool, false));
            btn.addEventListener('dblclick', () => this._select(btn.dataset.tool, true));
        });

        document.addEventListener('keydown', e => {
            if (e.target !== document.body && e.target.tagName !== 'CANVAS') return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const map = { s: 'select', r: 'rectangle', e: 'ellipse', l: 'line', b: 'bezier', t: 'text' };
            if (map[e.key.toLowerCase()]) this._select(map[e.key.toLowerCase()], false);
        });
    }

    _select(name, sticky = false) {
        this.state.activeTool = name;
        this.state.toolSticky = sticky;
        const labels = { select: 'Select', rectangle: 'Rektangel', ellipse: 'Ellips', line: 'Linje', bezier: 'Bezier', text: 'Text' };
        this.buttons.forEach(btn => {
            const isActive = btn.dataset.tool === name;
            btn.classList.toggle('active', isActive);
            btn.classList.toggle('sticky', isActive && sticky);
        });
        this.elTool.textContent = `Verktyg: ${labels[name] ?? name}`;
        this.renderer.render();
    }

    resetToSelect() {
        this._select('select', false);
    }
}