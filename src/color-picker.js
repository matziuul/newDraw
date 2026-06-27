function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r, g, b;
    if      (h < 60)  { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const v = max, s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d !== 0) {
        if      (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else                h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s, v];
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Canvas geometry constants
const CX = 100, CY = 100, OR = 97, IR = 72;
const SX = 55,  SY = 55,  SW = 90, SH = 90;

export class ColorPicker {
    constructor() {
        this.onChange    = null;  // (target: 'fill'|'stroke', color: string|null) => void
        this.onDragStart = null;  // () => void — called when drag begins (save pre-op snapshot)
        this.onDragEnd   = null;  // () => void — called when drag ends   (commit snapshot)

        this._target      = 'fill';
        this._hue         = 0;
        this._sat         = 1;
        this._val         = 1;
        this._fillColor   = null;
        this._strokeColor = null;
        this._dragging    = null;

        this._build();
    }

    _build() {
        const panel = document.createElement('div');
        panel.className = 'mac-palette';
        panel.innerHTML = `
            <div class="mac-palette-title">
                <span class="mac-palette-label">Colors</span>
                <button class="mac-palette-close" title="Close">&#x2715;</button>
            </div>
            <div class="mac-palette-body">
                <div class="cp-tabs">
                    <div class="cp-tab cp-tab-active" id="_cpTabFill">
                        <div class="cp-swatch" id="_cpFillSwatch"></div>
                        <span>Fill</span>
                    </div>
                    <div class="cp-tab" id="_cpTabStroke">
                        <div class="cp-swatch" id="_cpStrokeSwatch"></div>
                        <span>Border</span>
                    </div>
                </div>
                <canvas id="_cpCanvas" width="200" height="200"></canvas>
                <div class="cp-bottom">
                    <button class="cp-none-btn" id="_cpNone">None</button>
                    <input type="text" id="_cpHex" class="cp-hex" maxlength="7" placeholder="#rrggbb">
                    <div class="cp-preview" id="_cpPreview"></div>
                </div>
            </div>`;
        panel.style.display = 'none';
        document.body.appendChild(panel);
        this._panel = panel;

        this._canvas = panel.querySelector('#_cpCanvas');
        this._ctx2d  = this._canvas.getContext('2d');
        this._fillSwatch   = panel.querySelector('#_cpFillSwatch');
        this._strokeSwatch = panel.querySelector('#_cpStrokeSwatch');
        this._hexInput = panel.querySelector('#_cpHex');
        this._preview  = panel.querySelector('#_cpPreview');

        this._makeDraggable(panel, panel.querySelector('.mac-palette-title'));
        panel.querySelector('.mac-palette-close').addEventListener('click', () => this.hide());

        panel.querySelector('#_cpTabFill').addEventListener('click', () => this._setTarget('fill'));
        panel.querySelector('#_cpTabStroke').addEventListener('click', () => this._setTarget('stroke'));

        panel.querySelector('#_cpNone').addEventListener('click', () => {
            this.onDragStart?.();
            this._applyColor(null);
            this.onDragEnd?.();
            this._draw();
        });

        this._hexInput.addEventListener('change', () => {
            const rgb = hexToRgb(this._hexInput.value);
            if (!rgb) { this._syncHex(); return; }
            [this._hue, this._sat, this._val] = rgbToHsv(...rgb);
            this.onDragStart?.();
            this._applyColor(rgbToHex(...rgb));
            this.onDragEnd?.();
            this._draw();
        });

        this._canvas.addEventListener('mousedown', e => {
            const r = this._canvas.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;
            const dist = Math.hypot(mx - CX, my - CY);
            if (dist >= IR && dist <= OR) {
                e.preventDefault();
                this.onDragStart?.();
                this._dragging = 'ring';
                this._doHue(mx, my);
            } else if (mx >= SX && mx <= SX + SW && my >= SY && my <= SY + SH) {
                e.preventDefault();
                this.onDragStart?.();
                this._dragging = 'sq';
                this._doSV(mx, my);
            }
        });

        this._onMove = e => {
            if (!this._dragging) return;
            const r = this._canvas.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;
            if (this._dragging === 'ring') this._doHue(mx, my);
            else this._doSV(mx, my);
        };
        this._onUp = () => {
            if (!this._dragging) return;
            this._dragging = null;
            this.onDragEnd?.();
        };
        document.addEventListener('mousemove', this._onMove);
        document.addEventListener('mouseup',   this._onUp);

        this._draw();
    }

    _doHue(mx, my) {
        this._hue = ((Math.atan2(my - CY, mx - CX) * 180 / Math.PI + 90 + 360) % 360);
        this._commit();
    }

    _doSV(mx, my) {
        this._sat = Math.max(0, Math.min(1, (mx - SX) / SW));
        this._val = Math.max(0, Math.min(1, 1 - (my - SY) / SH));
        this._commit();
    }

    _commit() {
        const [r, g, b] = hsvToRgb(this._hue, this._sat, this._val);
        this._applyColor(rgbToHex(r, g, b));
        this._draw();
    }

    _applyColor(css) {
        if (this._target === 'fill') {
            this._fillColor = css;
            this._updateSwatch(this._fillSwatch, css);
        } else {
            this._strokeColor = css;
            this._updateSwatch(this._strokeSwatch, css);
        }
        this._syncHex();
        this.onChange?.(this._target, css);
    }

    _updateSwatch(el, css) {
        el.style.background = css ?? 'white';
        el.style.backgroundImage = css ? 'none'
            : 'repeating-linear-gradient(45deg,#ccc 0,#ccc 3px,white 0,white 50%)';
    }

    _syncHex() {
        const css = this._target === 'fill' ? this._fillColor : this._strokeColor;
        this._hexInput.value = css ?? '';
        this._preview.style.background = css ?? 'white';
        this._preview.style.backgroundImage = css ? 'none'
            : 'repeating-linear-gradient(45deg,#ccc 0,#ccc 3px,white 0,white 50%)';
    }

    _setTarget(t) {
        this._target = t;
        this._panel.querySelector('#_cpTabFill').classList.toggle('cp-tab-active', t === 'fill');
        this._panel.querySelector('#_cpTabStroke').classList.toggle('cp-tab-active', t === 'stroke');
        const css = t === 'fill' ? this._fillColor : this._strokeColor;
        if (css) {
            const rgb = hexToRgb(css);
            if (rgb) [this._hue, this._sat, this._val] = rgbToHsv(...rgb);
        }
        this._syncHex();
        this._draw();
    }

    _draw() {
        const c = this._ctx2d;
        c.clearRect(0, 0, 200, 200);

        // Hue ring: draw 360 thin arc segments
        for (let h = 0; h < 360; h++) {
            const a1 = (h - 90) * Math.PI / 180;
            const a2 = (h + 1.5 - 90) * Math.PI / 180;
            c.beginPath();
            c.moveTo(CX + IR * Math.cos(a1), CY + IR * Math.sin(a1));
            c.arc(CX, CY, OR, a1, a2);
            c.arc(CX, CY, IR, a2, a1, true);
            c.closePath();
            c.fillStyle = `hsl(${h},100%,50%)`;
            c.fill();
        }

        // SV square: hue base + white-to-transparent gradient + black-to-transparent gradient
        c.fillStyle = `hsl(${this._hue},100%,50%)`;
        c.fillRect(SX, SY, SW, SH);
        const gW = c.createLinearGradient(SX, SY, SX + SW, SY);
        gW.addColorStop(0, 'rgba(255,255,255,1)');
        gW.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gW; c.fillRect(SX, SY, SW, SH);
        const gB = c.createLinearGradient(SX, SY, SX, SY + SH);
        gB.addColorStop(0, 'rgba(0,0,0,0)');
        gB.addColorStop(1, 'rgba(0,0,0,1)');
        c.fillStyle = gB; c.fillRect(SX, SY, SW, SH);

        // Hue ring cursor
        const ha = (this._hue - 90) * Math.PI / 180;
        const mr = (IR + OR) / 2;
        const hx = CX + mr * Math.cos(ha), hy = CY + mr * Math.sin(ha);
        c.beginPath(); c.arc(hx, hy, 7, 0, Math.PI * 2);
        c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.stroke();
        c.beginPath(); c.arc(hx, hy, 7, 0, Math.PI * 2);
        c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();

        // SV cursor
        const scx = SX + this._sat * SW, scy = SY + (1 - this._val) * SH;
        c.beginPath(); c.arc(scx, scy, 6, 0, Math.PI * 2);
        c.strokeStyle = (this._val < 0.5 || this._sat > 0.8) ? '#fff' : '#000';
        c.lineWidth = 2; c.stroke();
    }

    /** Syncs swatches and wheel to the given fill/stroke colors (called when selection changes). */
    setColors(fillColor, strokeColor) {
        this._fillColor   = fillColor   ?? null;
        this._strokeColor = strokeColor ?? null;
        this._updateSwatch(this._fillSwatch,   this._fillColor);
        this._updateSwatch(this._strokeSwatch, this._strokeColor);
        const css = this._target === 'fill' ? this._fillColor : this._strokeColor;
        if (css) {
            const rgb = hexToRgb(css);
            if (rgb) [this._hue, this._sat, this._val] = rgbToHsv(...rgb);
        }
        this._syncHex();
        this._draw();
    }

    show()   { this._panel.style.display = ''; }
    hide()   { this._panel.style.display = 'none'; }
    toggle() { this._panel.style.display === 'none' ? this.show() : this.hide(); }
    get visible() { return this._panel.style.display !== 'none'; }

    _makeDraggable(panel, handle) {
        handle.style.cursor = 'move';
        handle.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            const pr = panel.getBoundingClientRect();
            const ox = pr.left, oy = pr.top, sx = e.clientX, sy = e.clientY;
            const mv = e2 => {
                panel.style.left = (ox + e2.clientX - sx) + 'px';
                panel.style.top  = (oy + e2.clientY - sy) + 'px';
            };
            const up = () => {
                document.removeEventListener('mousemove', mv);
                document.removeEventListener('mouseup',   up);
            };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup',   up);
            e.preventDefault();
        });
    }

    destroy() {
        document.removeEventListener('mousemove', this._onMove);
        document.removeEventListener('mouseup',   this._onUp);
        this._panel.remove();
    }
}
