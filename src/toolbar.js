import { QD_PATTERNS, buildPattern } from './patterns.js';
import { STROKE_DASHES, ARROW_MODES } from './shapes.js';

const STROKE_WIDTHS = [1, 2, 3, 4, 6, 8];

export class Toolbar {
    constructor(state, renderer, history) {
        this.state = state;
        this.renderer = renderer;
        this.history = history;
        this.buttons = document.querySelectorAll('.tool-button');
        this.elTool  = document.getElementById('statusTool');
        this._buildSwatches();
        this._buildStrokePatternSwatches();
        this._buildStrokeSwatches();
        this._buildDashSwatches();
        this._buildArrowSwatches();
        this._attachEvents();
    }

    _buildSwatches() {
        const grid = document.getElementById('patternGrid');
        QD_PATTERNS.forEach((p, idx) => {
            const cv = document.createElement('canvas');
            cv.width = 18; cv.height = 18;
            cv.className = 'pattern-swatch';
            cv.title = p.name;
            if (idx === 0) cv.classList.add('active');
            const ctx = cv.getContext('2d');

            if (p.rows === null) {
                ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 18, 18);
                ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(18,18);
                ctx.moveTo(18,0); ctx.lineTo(0,18); ctx.stroke();
            } else {
                ctx.fillStyle = buildPattern(ctx, p.rows);
                ctx.fillRect(0, 0, 18, 18);
            }
            ctx.strokeStyle = 'black'; ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, 17, 17);

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

    _buildStrokePatternSwatches() {
        const grid = document.getElementById('strokePatternGrid');
        QD_PATTERNS.forEach((p, idx) => {
            const cv = document.createElement('canvas');
            cv.width = 18; cv.height = 18;
            cv.className = 'stroke-pattern-swatch';
            cv.title = p.name;
            if (idx === 3) cv.classList.add('active'); // svart = default
            const ctx = cv.getContext('2d');

            if (p.rows === null) {
                ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 18, 18);
                ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(18,18);
                ctx.moveTo(18,0); ctx.lineTo(0,18); ctx.stroke();
            } else {
                ctx.fillStyle = buildPattern(ctx, p.rows);
                ctx.fillRect(0, 0, 18, 18);
            }
            ctx.strokeStyle = 'black'; ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, 17, 17);

            cv.addEventListener('click', () => {
                this.state.activeStrokePatternIdx = idx;
                const sel = this.state.selectedShape;
                if (sel && sel.type !== 'text' && sel.type !== 'group') {
                    const snap = this.history.savePreOp();
                    sel.strokePatternIdx = idx;
                    this.history.commit(snap);
                    this.renderer.render();
                }
                this.sync();
            });
            grid.appendChild(cv);
        });
    }

    _buildDashSwatches() {
        const grid = document.getElementById('dashGrid');
        STROKE_DASHES.forEach((d, idx) => {
            const cv = document.createElement('canvas');
            cv.width = 48; cv.height = 16;
            cv.className = 'dash-swatch';
            cv.title = d.name;
            if (idx === 0) cv.classList.add('active');
            const ctx = cv.getContext('2d');
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 48, 16);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.setLineDash(d.dash);
            ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(44, 8); ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, 47, 15);

            cv.addEventListener('click', () => {
                this.state.activeStrokeDash = idx;
                const sel = this.state.selectedShape;
                if (sel && sel.type !== 'text' && sel.type !== 'group') {
                    const snap = this.history.savePreOp();
                    sel.strokeDash = idx;
                    this.history.commit(snap);
                    this.renderer.render();
                }
                this.sync();
            });
            grid.appendChild(cv);
        });
    }

    _buildArrowSwatches() {
        const grid = document.getElementById('arrowGrid');
        ARROW_MODES.forEach((mode, idx) => {
            const cv = document.createElement('canvas');
            cv.width = 48; cv.height = 16;
            cv.className = 'arrow-swatch';
            cv.title = mode.name;
            if (idx === 0) cv.classList.add('active');
            const ctx = cv.getContext('2d');
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 48, 16);
            ctx.strokeStyle = 'black'; ctx.fillStyle = 'black';
            ctx.lineWidth = 1.5; ctx.lineCap = 'butt';
            const L = 6, W = 3;
            let x1 = 7, x2 = 41;
            if (mode.end)   x2 -= L;
            if (mode.start) x1 += L;
            ctx.beginPath(); ctx.moveTo(x1, 8); ctx.lineTo(x2, 8); ctx.stroke();
            if (mode.end) {
                ctx.beginPath(); ctx.moveTo(41, 8); ctx.lineTo(41-L, 8-W); ctx.lineTo(41-L, 8+W); ctx.closePath(); ctx.fill();
            }
            if (mode.start) {
                ctx.beginPath(); ctx.moveTo(7, 8); ctx.lineTo(7+L, 8-W); ctx.lineTo(7+L, 8+W); ctx.closePath(); ctx.fill();
            }
            ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 47, 15);

            cv.addEventListener('click', () => {
                this.state.activeArrowMode = idx;
                const sel = this.state.selectedShape;
                if (sel && (sel.type === 'line' || sel.type === 'bezier')) {
                    const snap = this.history.savePreOp();
                    sel.arrowMode = idx;
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
        document.querySelectorAll('.stroke-pattern-swatch').forEach((s, i) =>
            s.classList.toggle('active', i === this.state.activeStrokePatternIdx));
        document.querySelectorAll('.stroke-swatch').forEach((s, i) =>
            s.classList.toggle('active', STROKE_WIDTHS[i] === this.state.activeStrokeWidth));
        document.querySelectorAll('.dash-swatch').forEach((s, i) =>
            s.classList.toggle('active', i === this.state.activeStrokeDash));
        document.querySelectorAll('.arrow-swatch').forEach((s, i) =>
            s.classList.toggle('active', i === this.state.activeArrowMode));
    }

    _attachEvents() {
        this.buttons.forEach(btn => {
            btn.addEventListener('click',    () => this._select(btn.dataset.tool, false));
            btn.addEventListener('dblclick', () => this._select(btn.dataset.tool, true));
        });

        document.addEventListener('keydown', e => {
            if (e.target !== document.body && e.target.tagName !== 'CANVAS') return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const map = { s: 'select', r: 'rectangle', o: 'roundrect', e: 'ellipse', l: 'line', b: 'bezier', t: 'text', a: 'arc' };
            if (map[e.key.toLowerCase()]) this._select(map[e.key.toLowerCase()], false);
        });
    }

    _select(name, sticky = false) {
        this.state.activeTool = name;
        this.state.toolSticky = sticky;
        const labels = { select: 'Select', rectangle: 'Rektangel', roundrect: 'Rundrekt.', ellipse: 'Ellips', line: 'Linje', bezier: 'Bezier', text: 'Text', arc: 'Båge' };
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