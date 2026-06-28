// ── HSV ↔ RGB ↔ Hex color conversion helpers ─────────────────────────────────

/**
 * Converts an HSV color to RGB integer components.
 * @param {number} hue - Hue in degrees [0, 360).
 * @param {number} saturation - Saturation [0, 1].
 * @param {number} value - Value/brightness [0, 1].
 * @returns {[number, number, number]} Red, green, blue in [0, 255].
 */
function hsvToRgb(hue, saturation, value) {
    const chroma    = value * saturation;
    const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const offset    = value - chroma;
    let red, green, blue;
    if      (hue < 60)  { red = chroma;    green = secondary; blue = 0; }
    else if (hue < 120) { red = secondary; green = chroma;    blue = 0; }
    else if (hue < 180) { red = 0;         green = chroma;    blue = secondary; }
    else if (hue < 240) { red = 0;         green = secondary; blue = chroma; }
    else if (hue < 300) { red = secondary; green = 0;         blue = chroma; }
    else                { red = chroma;    green = 0;         blue = secondary; }
    return [
        Math.round((red   + offset) * 255),
        Math.round((green + offset) * 255),
        Math.round((blue  + offset) * 255),
    ];
}

/**
 * Converts RGB integer components to an HSV color.
 * @param {number} red - Red [0, 255].
 * @param {number} green - Green [0, 255].
 * @param {number} blue - Blue [0, 255].
 * @returns {[number, number, number]} Hue (degrees), saturation [0,1], value [0,1].
 */
function rgbToHsv(red, green, blue) {
    const r = red / 255, g = green / 255, b = blue / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    const value = max, saturation = max === 0 ? 0 : delta / max;
    let hue = 0;
    if (delta !== 0) {
        if      (max === r) hue = ((g - b) / delta + 6) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else                hue = (r - g) / delta + 4;
        hue *= 60;
    }
    return [hue, saturation, value];
}

/**
 * Parses a hex color string to RGB integer components.
 * @param {string} hex - A '#rrggbb' or 'rrggbb' string.
 * @returns {[number, number, number]|null} RGB triple, or null if the string is invalid.
 */
function hexToRgb(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    const packed = parseInt(match[1], 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
}

/**
 * Formats RGB integer components as a lowercase `#rrggbb` hex string.
 * @param {number} red - Red [0, 255].
 * @param {number} green - Green [0, 255].
 * @param {number} blue - Blue [0, 255].
 * @returns {string} Hex color string, e.g. `'#ff8000'`.
 */
function rgbToHex(red, green, blue) {
    return '#' + [red, green, blue].map(c => c.toString(16).padStart(2, '0')).join('');
}

// ── Canvas geometry constants ─────────────────────────────────────────────────
// The wheel is drawn on a 200×200 canvas. The hue ring occupies the annular
// region between RING_INNER_R and RING_OUTER_R, centred at (RING_CX, RING_CY).
// The SV square sits inside the inner circle.

const RING_CX      = 100;  // ring centre X
const RING_CY      = 100;  // ring centre Y
const RING_OUTER_R =  97;  // outer radius of hue ring
const RING_INNER_R =  72;  // inner radius of hue ring (= edge of SV square region)
const SQ_X         =  55;  // SV square left edge
const SQ_Y         =  55;  // SV square top edge
const SQ_W         =  90;  // SV square width  (fits inside inner circle: diagonal ≈ 127 < 2*72)
const SQ_H         =  90;  // SV square height

// ── ColorPicker ───────────────────────────────────────────────────────────────

/**
 * An inline HSV colour picker embedded in the inspector sidebar.
 *
 * Expects these elements to already exist in the DOM:
 *   `#_cpTabFill`, `#_cpTabStroke`, `#_cpFillSwatch`, `#_cpStrokeSwatch`,
 *   `#_cpCanvas`, `#_cpNone`, `#_cpHex`, `#_cpPreview`
 *
 * Wire up the three callbacks before first use:
 *   - `onChange`    — fired whenever the active colour changes (drag and hex input).
 *   - `onDragStart` — fired on the first mousedown inside the wheel or on "None".
 *   - `onDragEnd`   — fired on the corresponding mouseup (or immediately after "None").
 *
 * The start/end pair is designed for undo batching: save a history snapshot in
 * `onDragStart` and commit it in `onDragEnd` so an entire drag registers as one
 * undoable operation.
 */
export class ColorPicker {
    /**
     * Locates the picker elements in the DOM and wires up all interaction.
     * Must be called after the DOM is ready.
     */
    constructor() {
        /** @type {((target: 'fill'|'stroke', color: string|null) => void)|null} */
        this.onChange    = null;
        /** @type {(() => void)|null} Called at the start of a wheel drag or "None" click. */
        this.onDragStart = null;
        /** @type {(() => void)|null} Called at the end of a wheel drag or "None" click. */
        this.onDragEnd   = null;

        this._target      = /** @type {'fill'|'stroke'} */ ('fill');
        this._hue         = 0;    // degrees [0, 360)
        this._saturation  = 1;    // [0, 1]
        this._value       = 1;    // [0, 1]
        this._fillColor   = /** @type {string|null} */ (null);
        this._strokeColor = /** @type {string|null} */ (null);
        this._dragging    = /** @type {'ring'|'sq'|null} */ (null);

        this._attachToDOM();
    }

    // ── DOM wiring ────────────────────────────────────────────────────────────

    /** Finds picker elements by ID and attaches all event listeners. */
    _attachToDOM() {
        this._canvas       = document.getElementById('_cpCanvas');
        this._ctx          = this._canvas.getContext('2d');
        this._fillSwatch   = document.getElementById('_cpFillSwatch');
        this._strokeSwatch = document.getElementById('_cpStrokeSwatch');
        this._hexInput     = document.getElementById('_cpHex');
        this._preview      = document.getElementById('_cpPreview');
        this._tabFill      = document.getElementById('_cpTabFill');
        this._tabStroke    = document.getElementById('_cpTabStroke');

        this._tabFill.addEventListener('click',   () => this._setTarget('fill'));
        this._tabStroke.addEventListener('click', () => this._setTarget('stroke'));

        document.getElementById('_cpNone').addEventListener('click', () => {
            this.onDragStart?.();
            this._applyColor(null);
            this.onDragEnd?.();
            this._redraw();
        });

        this._hexInput.addEventListener('change', () => {
            const rgb = hexToRgb(this._hexInput.value);
            if (!rgb) { this._syncControls(); return; }
            [this._hue, this._saturation, this._value] = rgbToHsv(...rgb);
            this.onDragStart?.();
            this._applyColor(rgbToHex(...rgb));
            this.onDragEnd?.();
            this._redraw();
        });

        this._canvas.addEventListener('mousedown', e => {
            const [canvasX, canvasY] = this._canvasCoords(e);
            const dist = Math.hypot(canvasX - RING_CX, canvasY - RING_CY);

            if (dist >= RING_INNER_R && dist <= RING_OUTER_R) {
                e.preventDefault();
                this.onDragStart?.();
                this._dragging = 'ring';
                this._updateHueFromCanvas(canvasX, canvasY);
            } else if (canvasX >= SQ_X && canvasX <= SQ_X + SQ_W &&
                       canvasY >= SQ_Y && canvasY <= SQ_Y + SQ_H) {
                e.preventDefault();
                this.onDragStart?.();
                this._dragging = 'sq';
                this._updateSVFromCanvas(canvasX, canvasY);
            }
        });

        document.addEventListener('mousemove', e => {
            if (!this._dragging) return;
            const [canvasX, canvasY] = this._canvasCoords(e);
            if (this._dragging === 'ring') this._updateHueFromCanvas(canvasX, canvasY);
            else                           this._updateSVFromCanvas(canvasX, canvasY);
        });

        document.addEventListener('mouseup', () => {
            if (!this._dragging) return;
            this._dragging = null;
            this.onDragEnd?.();
        });

        this._redraw();
    }

    // ── Coordinate scaling ────────────────────────────────────────────────────

    /**
     * Converts a MouseEvent to canvas coordinate space, accounting for any CSS scaling
     * applied to the canvas element (e.g. `width: 100%`).
     * @param {MouseEvent} e
     * @returns {[number, number]} `[canvasX, canvasY]` in the canvas's own pixel space.
     */
    _canvasCoords(e) {
        const rect   = this._canvas.getBoundingClientRect();
        const scaleX = this._canvas.width  / rect.width;
        const scaleY = this._canvas.height / rect.height;
        return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
    }

    // ── Drag update helpers ───────────────────────────────────────────────────

    /**
     * Updates `_hue` from a canvas-space pointer position on the hue ring,
     * then commits the colour and redraws.
     * @param {number} canvasX - Pointer X in canvas coordinates.
     * @param {number} canvasY - Pointer Y in canvas coordinates.
     */
    _updateHueFromCanvas(canvasX, canvasY) {
        this._hue = ((Math.atan2(canvasY - RING_CY, canvasX - RING_CX)
            * 180 / Math.PI + 90 + 360) % 360);
        this._commitCurrentColor();
    }

    /**
     * Updates `_saturation` and `_value` from a canvas-space pointer position
     * inside the SV square, then commits the colour and redraws.
     * @param {number} canvasX - Pointer X in canvas coordinates.
     * @param {number} canvasY - Pointer Y in canvas coordinates.
     */
    _updateSVFromCanvas(canvasX, canvasY) {
        this._saturation = Math.max(0, Math.min(1, (canvasX - SQ_X) / SQ_W));
        this._value      = Math.max(0, Math.min(1, 1 - (canvasY - SQ_Y) / SQ_H));
        this._commitCurrentColor();
    }

    /**
     * Converts the current HSV state to a hex colour string, applies it, and redraws.
     */
    _commitCurrentColor() {
        const [red, green, blue] = hsvToRgb(this._hue, this._saturation, this._value);
        this._applyColor(rgbToHex(red, green, blue));
        this._redraw();
    }

    // ── Colour state management ───────────────────────────────────────────────

    /**
     * Stores `hexColor` for the active target (fill or stroke), updates the
     * relevant swatch, syncs the hex input / preview, and fires `onChange`.
     * @param {string|null} hexColor - A `'#rrggbb'` string, or null for "none".
     */
    _applyColor(hexColor) {
        if (this._target === 'fill') {
            this._fillColor = hexColor;
            this._updateSwatch(this._fillSwatch, hexColor);
        } else {
            this._strokeColor = hexColor;
            this._updateSwatch(this._strokeSwatch, hexColor);
        }
        this._syncControls();
        this.onChange?.(this._target, hexColor);
    }

    /**
     * Updates a swatch element's background to reflect a colour or a "none" crosshatch.
     * @param {HTMLElement} swatchEl - The swatch div to update.
     * @param {string|null} hexColor - The colour to display, or null for "none".
     */
    _updateSwatch(swatchEl, hexColor) {
        swatchEl.style.background        = hexColor ?? 'white';
        swatchEl.style.backgroundImage   = hexColor
            ? 'none'
            : 'repeating-linear-gradient(45deg,#ccc 0,#ccc 3px,white 0,white 50%)';
    }

    /**
     * Syncs the hex input field and preview box to the active target's current colour.
     */
    _syncControls() {
        const color = this._target === 'fill' ? this._fillColor : this._strokeColor;
        this._hexInput.value                = color ?? '';
        this._preview.style.background      = color ?? 'white';
        this._preview.style.backgroundImage = color
            ? 'none'
            : 'repeating-linear-gradient(45deg,#ccc 0,#ccc 3px,white 0,white 50%)';
    }

    /**
     * Switches the active editing target between fill and stroke, updates the tab
     * highlight, and syncs the wheel and controls to the newly active colour.
     * @param {'fill'|'stroke'} target - Which colour to edit.
     */
    _setTarget(target) {
        this._target = target;
        this._tabFill.classList.toggle('cp-tab-active',   target === 'fill');
        this._tabStroke.classList.toggle('cp-tab-active', target === 'stroke');
        const color = target === 'fill' ? this._fillColor : this._strokeColor;
        if (color) {
            const rgb = hexToRgb(color);
            if (rgb) [this._hue, this._saturation, this._value] = rgbToHsv(...rgb);
        }
        this._syncControls();
        this._redraw();
    }

    // ── Canvas rendering ──────────────────────────────────────────────────────

    /**
     * Repaints the hue ring, saturation/value square, and both cursors onto the canvas.
     */
    _redraw() {
        const ctx = this._ctx;
        ctx.clearRect(0, 0, 200, 200);

        // Hue ring: 360 arc segments, each 1.5° wide to avoid sub-pixel gaps
        for (let deg = 0; deg < 360; deg++) {
            const segStart = (deg - 90) * Math.PI / 180;
            const segEnd   = (deg + 1.5 - 90) * Math.PI / 180;
            ctx.beginPath();
            ctx.moveTo(RING_CX + RING_INNER_R * Math.cos(segStart),
                       RING_CY + RING_INNER_R * Math.sin(segStart));
            ctx.arc(RING_CX, RING_CY, RING_OUTER_R, segStart, segEnd);
            ctx.arc(RING_CX, RING_CY, RING_INNER_R, segEnd, segStart, true);
            ctx.closePath();
            ctx.fillStyle = `hsl(${deg},100%,50%)`;
            ctx.fill();
        }

        // SV square: solid hue layer, then white→transparent left-to-right,
        // then black→transparent top-to-bottom
        ctx.fillStyle = `hsl(${this._hue},100%,50%)`;
        ctx.fillRect(SQ_X, SQ_Y, SQ_W, SQ_H);

        const whiteGrad = ctx.createLinearGradient(SQ_X, SQ_Y, SQ_X + SQ_W, SQ_Y);
        whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
        whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(SQ_X, SQ_Y, SQ_W, SQ_H);

        const blackGrad = ctx.createLinearGradient(SQ_X, SQ_Y, SQ_X, SQ_Y + SQ_H);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = blackGrad;
        ctx.fillRect(SQ_X, SQ_Y, SQ_W, SQ_H);

        // Hue ring cursor: double-ring so it's visible on all hues
        const hueAngle    = (this._hue - 90) * Math.PI / 180;
        const midRadius   = (RING_INNER_R + RING_OUTER_R) / 2;
        const ringCursorX = RING_CX + midRadius * Math.cos(hueAngle);
        const ringCursorY = RING_CY + midRadius * Math.sin(hueAngle);
        ctx.beginPath(); ctx.arc(ringCursorX, ringCursorY, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(ringCursorX, ringCursorY, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1;   ctx.stroke();

        // SV square cursor: white outline on dark colours, black outline on light ones
        const sqCursorX = SQ_X + this._saturation * SQ_W;
        const sqCursorY = SQ_Y + (1 - this._value) * SQ_H;
        ctx.beginPath(); ctx.arc(sqCursorX, sqCursorY, 6, 0, Math.PI * 2);
        ctx.strokeStyle = (this._value < 0.5 || this._saturation > 0.8) ? '#fff' : '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Syncs the picker's swatches and wheel to reflect a new selection.
     * Call this whenever the selected shape changes so the picker stays in sync.
     * @param {string|null} fillColor - The selected shape's fill colour, or null.
     * @param {string|null} strokeColor - The selected shape's stroke colour, or null.
     */
    setColors(fillColor, strokeColor) {
        this._fillColor   = fillColor   ?? null;
        this._strokeColor = strokeColor ?? null;
        this._updateSwatch(this._fillSwatch,   this._fillColor);
        this._updateSwatch(this._strokeSwatch, this._strokeColor);
        const color = this._target === 'fill' ? this._fillColor : this._strokeColor;
        if (color) {
            const rgb = hexToRgb(color);
            if (rgb) [this._hue, this._saturation, this._value] = rgbToHsv(...rgb);
        }
        this._syncControls();
        this._redraw();
    }
}
