import { RectangleShape, EllipseShape, LineShape, TextShape, RoundRectShape, ArcShape, GroupShape, BezierShape } from './shapes.js';

const DEBUG = true;
const dbg = (...a) => DEBUG && console.log(...a);

const SHAPE_TYPE_NAMES = {
    0x02: 'line', 0x03: 'line-rev', 0x04: 'rect', 0x05: 'roundrect',
    0x06: 'ellipse', 0x07: 'arc', 0x08: 'freehand', 0x09: 'polygon/bezier', 0x0a: 'group',
};

// byte[o+3] — when non-zero selects rect/roundrect class and encodes corner radius.
// 0x00 = standard (dispatch via shapeTypeCode). 0x01–0x06 = rect/roundrect variants:
//   0x01 = square (no rounding), 0x02–0x06 = class/16 inch corner radius.
const SHAPE_CLASS_NAMES = {
    0x00: 'standard',
    0x01: 'rect/square',     0x02: 'roundrect(1/8")',   0x03: 'roundrect(3/16")',
    0x04: 'roundrect(1/4")', 0x05: 'roundrect(5/16")',  0x06: 'roundrect(3/8")',
};

// byte[o+2] — fill/draw variant. 0x01=transparent, 0x02=white, 0x03=black, 0x05=grey.
const FILL_MODE_NAMES = {
    0x01: 'transparent', 0x02: 'white', 0x03: 'black', 0x05: 'grey',
};

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/**
 * Reads a 16.16 fixed-point number (big-endian) from a DataView.
 * The high 16 bits are the signed integer part; the low 16 bits are the fractional part.
 *
 * @param {DataView} view - The DataView wrapping the file buffer.
 * @param {number} offset - Byte offset into the DataView.
 * @returns {number} The fixed-point value as a JavaScript float.
 */
function readFixed(view, offset) {
    return view.getInt16(offset, false) + view.getUint16(offset + 2, false) / 65536;
}

// ─── Freehand stroke helpers ──────────────────────────────────────────────────

/**
 * Simplifies a polyline using the Ramer-Douglas-Peucker algorithm.
 * Removes points that deviate less than `eps` pixels from the straight line
 * between their neighbours, reducing point count while preserving shape.
 *
 * @param {{x: number, y: number}[]} pts - Input polyline points.
 * @param {number} eps - Maximum allowed perpendicular deviation in pixels.
 * @returns {{x: number, y: number}[]} Simplified polyline (new array).
 */
function rdpSimplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const p0 = pts[0], pn = pts[pts.length - 1];
    const dx = pn.x - p0.x, dy = pn.y - p0.y;
    const len2 = dx * dx + dy * dy;
    let maxDist = 0, maxIdx = 1;
    for (let i = 1; i < pts.length - 1; i++) {
        const d = len2 === 0
            ? Math.hypot(pts[i].x - p0.x, pts[i].y - p0.y)
            : Math.abs(dx * (p0.y - pts[i].y) - dy * (p0.x - pts[i].x)) / Math.sqrt(len2);
        if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist <= eps) return [p0, pn];
    const L = rdpSimplify(pts.slice(0, maxIdx + 1), eps);
    const R = rdpSimplify(pts.slice(maxIdx), eps);
    return L.concat(R.slice(1));
}

/**
 * Converts a polyline to a cubic Bézier control-point sequence using
 * Catmull-Rom tangents, so each segment flows smoothly through every knot.
 * The first and last points use one-sided (endpoint) tangents.
 *
 * @param {{x: number, y: number}[]} pts - Simplified polyline points.
 * @returns {{x: number, y: number, c1x: number, c1y: number, c2x: number, c2y: number}[]}
 *   Array of knot objects, each carrying the anchor and its two cubic control points.
 */
function catmullRomBezier(pts) {
    const last = pts.length - 1;
    return pts.map((knot, i) => {
        const prev = pts[i - 1];
        const next = pts[i + 1];

        // Catmull-Rom tangent at this knot: chord from the previous point to
        // the next point, scaled to half-length. At the endpoints we use a
        // one-sided chord (start→next or prev→end) so the curve doesn't overshoot.
        let tangentX, tangentY;
        if      (i === 0)    { tangentX = next.x - knot.x;          tangentY = next.y - knot.y; }
        else if (i === last) { tangentX = knot.x - prev.x;          tangentY = knot.y - prev.y; }
        else                 { tangentX = (next.x - prev.x) / 2;    tangentY = (next.y - prev.y) / 2; }

        // The cubic Bézier control points sit one-third of the tangent away from
        // the knot on each side. The in-handle (c1) pulls back along the tangent;
        // the out-handle (c2) pushes forward. At the first knot c1 collapses to
        // the knot itself (no incoming segment), and at the last knot c2 does the same.
        return {
            x:   knot.x,
            y:   knot.y,
            c1x: i === 0    ? knot.x : knot.x - tangentX / 3,
            c1y: i === 0    ? knot.y : knot.y - tangentY / 3,
            c2x: i === last ? knot.x : knot.x + tangentX / 3,
            c2y: i === last ? knot.y : knot.y + tangentY / 3,
        };
    });
}

/**
 * Parses a MacDraw II freehand pencil stroke record (shape type 0x08).
 * The record header encodes pen width and pattern; starting coordinates are
 * stored as two 16.16 fixed-point values at o+28/o+32. Subsequent pairs of
 * signed delta bytes (dH, dV) trace the path until a (0, 0) terminator.
 * The raw point list is simplified with RDP and then converted to Bézier form.
 *
 * @param {DataView} view - The DataView wrapping the file buffer.
 * @param {Uint8Array} bytes - Raw file bytes.
 * @param {number} o - Byte offset of the stroke record within `bytes`.
 * @param {number} scale - Points-to-pixels scale factor (96/72).
 * @returns {BezierShape|null} The parsed stroke, or null if the record is malformed.
 */
function parseFreehandStroke(view, bytes, o, scale) {
    if (o + 36 > bytes.length) return null;
    const sy = view.getInt16(o + 28, false) + view.getUint16(o + 30, false) / 65536;
    const sx = view.getInt16(o + 32, false) + view.getUint16(o + 34, false) / 65536;

    let cx = sx * scale, cy = sy * scale;
    const raw = [{ x: cx, y: cy }];

    for (let i = o + 36; i + 1 < bytes.length; i += 2) {
        const dh = (bytes[i]   << 24) >> 24;
        const dv = (bytes[i+1] << 24) >> 24;
        if (dh === 0 && dv === 0) break;
        cx += dh * scale;
        cy += dv * scale;
        raw.push({ x: cx, y: cy });
    }

    if (raw.length < 2) return null;

    const simplified = rdpSimplify(raw, 1.5);
    const pts = catmullRomBezier(simplified);

    const s = new BezierShape(pts);
    s.strokeWidth      = Math.max(1, bytes[o] - 1);
    s.strokePatternIdx = bytes[o + 1];
    s.fillIdx          = 0;
    return s;
}

// ─── Record size helper ───────────────────────────────────────────────────────

// Returns the total byte size of a record starting at pos (prefix included).
// Record layout: [typeCode, 0x00, {0|1}, 0x00] prefix + 4-byte header + data.
// Sizes: 0x02–0x06 = 24, 0x07 = 28, 0x08 = variable (00 00 terminator), 0x09 = 32+nPts*8.
// Returns 0 for text (0x01), unknown types, or out-of-bounds.
function recordSize(bytes, pos) {
    const tc = bytes[pos];
    const hp = pos + 4;
    if (tc === 0x08) {
        let e = hp + 36;
        while (e + 1 < bytes.length && !(bytes[e] === 0 && bytes[e + 1] === 0)) e += 2;
        return (e + 2) - pos;
    }
    if (tc === 0x09) {
        if (hp + 10 > bytes.length) return 0;
        const nPts = (bytes[hp + 8] << 8) | bytes[hp + 9];
        if (nPts < 1 || nPts > 500) return 0;
        const sz = 32 + nPts * 8;
        return pos + sz <= bytes.length ? sz : 0;
    }
    if (tc === 0x07) return hp + 24 <= bytes.length ? 28 : 0;
    if (tc >= 0x02 && tc <= 0x06) return hp + 20 <= bytes.length ? 24 : 0;
    return 0;
}

// ─── Text extraction ──────────────────────────────────────────────────────────

/**
 * Reads a MacDraw II inline text string from raw bytes.
 * Stops at a NUL (0x00) or SOH (0x01) terminator, or after 300 bytes.
 * CR (0x0D) and LF (0x0A) are converted to newlines; non-ASCII bytes end the string.
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @param {number} start - Byte offset at which to begin reading.
 * @returns {string} The decoded text string.
 */
function macDrawReadString(bytes, start) {
    let s = '';
    for (let i = start; i < bytes.length && i < start + 300; i++) {
        const c = bytes[i];
        if (c === 0x01 || c === 0x00) break;
        if (c === 0x0D || c === 0x0A) { s += '\n'; continue; }
        if (c >= 32 && c < 127) s += String.fromCharCode(c);
        else break;
    }
    return s;
}

/**
 * Returns true if at least `minRun` consecutive bytes starting at `off` are
 * all printable ASCII (0x20–0x7E) or line-ending characters (CR/LF).
 * Used as a quick sanity check before attempting to read a text string.
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @param {number} off - Byte offset to test.
 * @param {number} minRun - Minimum number of printable bytes required.
 * @returns {boolean}
 */
function isPrintableAt(bytes, off, minRun) {
    for (let i = 0; i < minRun; i++) {
        if (off + i >= bytes.length) return false;
        const c = bytes[off + i];
        if ((c < 32 || c >= 127) && c !== 0x0D && c !== 0x0A) return false;
    }
    return true;
}

/**
 * Scans the file for MacDraw II text records and returns them as TextShape objects.
 * Runs two passes over the byte stream from offset 0x200 onward: the first pass
 * collects non-wrapper text records (type 0x01/0x1A); the second collects wrapper
 * records (type 0x02, flags 0x00). Duplicate strings (by trimmed 30-char prefix)
 * are suppressed. Coordinates are scaled from points to pixels.
 *
 * @param {DataView} view - The DataView wrapping the file buffer.
 * @param {Uint8Array} bytes - Raw file bytes.
 * @param {number} scale - Points-to-pixels scale factor (96/72).
 * @returns {TextShape[]} Array of positioned text shapes found in the file.
 */
function parseMacDrawText(view, bytes, scale) {
    const entries = [];

    for (const pass of [0, 1]) {
        for (let i = 0x200; i < bytes.length - 30; i++) {
            if (bytes[i] !== 0x02 || bytes[i+1] !== 0x03) continue;
            const type = bytes[i+2], flags = bytes[i+3];
            const isWrapper = (type === 0x02 && flags === 0x00);
            if (pass === 0 && isWrapper) continue;
            if (pass === 1 && !isWrapper) continue;

            let textOff = -1, x = 0, y = 0;

            if (type === 0x01 && flags === 0x01) {
                if (i + 12 > bytes.length) continue;
                textOff = 15;
                y = view.getInt16(i + 7,  false) * scale;
                x = view.getInt16(i + 9,  false) * scale;
            } else if (type === 0x1A) {
                if (i + 14 > bytes.length) continue;
                textOff = 19;
                x = view.getInt16(i + 10, true) * scale;
                y = view.getInt16(i + 12, true) * scale;
            } else if (isWrapper) {
                const top2  = view.getInt16(i + 4,  false) + view.getUint16(i + 6,  false) / 65536;
                const left2 = view.getInt16(i + 8,  false) + view.getUint16(i + 10, false) / 65536;
                const bot2  = view.getInt16(i + 12, false) + view.getUint16(i + 14, false) / 65536;
                const rgt2  = view.getInt16(i + 16, false) + view.getUint16(i + 18, false) / 65536;
                const w2 = rgt2 - left2, h2 = bot2 - top2;
                if (top2 >= 5 && left2 >= 5 && w2 > 0 && h2 > 0 && w2 < 5000 && h2 < 5000) continue;
                if (i + 22 > bytes.length) continue;
                textOff = 24;
                y = view.getInt16(i + 16, false) * scale;
                x = view.getInt16(i + 18, false) * scale;
            } else {
                continue;
            }

            if (i + textOff >= bytes.length) continue;
            if (!isPrintableAt(bytes, i + textOff, 3)) continue;
            const text = macDrawReadString(bytes, i + textOff);
            if (!text || text.trim().length < 2) continue;
            entries.push({ text, x, y, offset: i, typeCode: type });
        }
    }

    const seenText = new Set();
    const shapes = [];
    for (const e of entries) {
        const key = e.text.trim().slice(0, 30);
        if (seenText.has(key)) continue;
        seenText.add(key);
        const ts = new TextShape(e.x, e.y, e.text, 'Geneva', 12, 0);
        ts.debugSource = { format: 'DRW', offset: e.offset, typeCode: e.typeCode };
        shapes.push(ts);
    }
    return shapes;
}

// ─── Record location ──────────────────────────────────────────────────────────

/**
 * Locates the start of the drawing-object stream within a MacDraw II file.
 * If the file begins with the 'DRWG' magic signature, records are known to
 * start at 0x204 (512-byte header + 4-byte section marker). Otherwise the
 * function heuristically scans the first 2 KB for the first plausible record
 * header (byte pattern: type ≥ 0x02, next byte 0x03, third byte < 0x20).
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @returns {number} Byte offset of the first record, or -1 if not found.
 */
function findMacDrawObjects(bytes) {
    const isDRWG = bytes.length >= 0x208 &&
        bytes[0] === 0x44 && bytes[1] === 0x52 && bytes[2] === 0x57 && bytes[3] === 0x47;

    if (isDRWG) {
        const d = Array.from({length: Math.min(20, bytes.length - 0x204)}, (_, k) => bytes[0x204+k].toString(16).padStart(2,'0')).join(' ');
        dbg(`MDraw DRWG file. bytes[0x204..]: ${d}`);
        return 0x204;
    }
    for (let i = 4; i < Math.min(bytes.length - 3, 2048); i++) {
        if (bytes[i] >= 0x02 && bytes[i+1] === 0x03 && bytes[i+2] < 0x20) return i;
    }
    return -1;
}

// ─── Record parser ────────────────────────────────────────────────────────────

/**
 * Parses a single MacDraw II drawing record and returns the appropriate shape object.
 *
 * Each record starts with a 4-byte header at `o`:
 *   byte 0 — pen size (raw; subtract 1 for stroke width in points)
 *   byte 1 — stroke pattern index
 *   byte 2 — fill/draw variant (the `type` parameter)
 *   byte 3 — shape class (the `flags` parameter, encodes rect/roundrect corner radius)
 * Followed by four 16.16 fixed-point values: top, left, height-endpoint, width-endpoint.
 * The byte at o-4 (preceding the header) carries the shape type code.
 *
 * Shape dispatch uses a combination of the preceding shape-type byte, the `type`
 * (fill mode), and `flags` (shape class) to produce Line, Rectangle, RoundRect,
 * Ellipse, Arc, or Bezier shapes. Returns null for unrecognised or out-of-range records.
 *
 * @param {DataView} view - The DataView wrapping the file buffer.
 * @param {Uint8Array} bytes - Raw file bytes.
 * @param {number} o - Byte offset of the record within `bytes`.
 * @param {number} type - Fill/draw mode byte (byte 2 of the header; e.g. 0x01 transparent, 0x02 white).
 * @param {number} flags - Shape class byte (byte 3; 0x00 = standard, 0x01–0x06 = rect/roundrect variant).
 * @param {number} scale - Points-to-pixels scale factor (96/72).
 * @param {number} [pageOffPtX=0] - Horizontal page origin offset in points.
 * @param {number} [pageOffPtY=0] - Vertical page origin offset in points.
 * @param {number} [recLen=24] - Total byte length of this record (used to detect extended arc records).
 * @returns {RectangleShape|RoundRectShape|EllipseShape|LineShape|ArcShape|BezierShape|null}
 */
function parseMacDrawRecord(view, bytes, o, type, flags, scale, pageOffPtX = 0, pageOffPtY = 0, recLen = 24) {
    if (o + 20 > bytes.length) return null;

    const top  = readFixed(view, o + 4);
    const left = readFixed(view, o + 8);
    const h_pt = readFixed(view, o + 12);
    const w_pt = readFixed(view, o + 16);

    const shapeTypeCode = o >= 4 ? bytes[o - 4] : 0;
    const fillFromType  = type === 0x01 ? 0 : type === 0x02 ? 1 : type;
    const strokeWidth   = Math.max(1, bytes[o] - 1);
    const strokePat     = bytes[o + 1];
    if (strokeWidth >= 24) return null;

    const NON_LINE_TYPES = new Set([0x04, 0x05, 0x06, 0x07, 0x09, 0x0a]);
    const isLineType = shapeTypeCode === 0x02 || shapeTypeCode === 0x03;
    const nearInt = b => b === 0x00 || b === 0xff;
    if (flags <= 0x03 && type === 0x02 && bytes[o + 1] !== 0x05 &&
        (isLineType || !NON_LINE_TYPES.has(shapeTypeCode)) &&
        nearInt(bytes[o+6]) && nearInt(bytes[o+10]) && nearInt(bytes[o+14]) && nearInt(bytes[o+18])) {
        const lx1 = Math.round((left - pageOffPtX) * scale);
        const ly1 = Math.round((top  - pageOffPtY) * scale);
        const lx2 = Math.round((w_pt - pageOffPtX) * scale);
        const ly2 = Math.round((h_pt - pageOffPtY) * scale);
        const s = new LineShape(lx1, ly1, lx2, ly2);
        s.strokeWidth = strokeWidth;
        s.strokePatternIdx = strokePat;
        s.arrowMode = flags; // 0=none, 1=start, 2=end, 3=both
        return s;
    }

    if (shapeTypeCode === 0x04) {
        if (top < 0 || left < 0) return null;
        const x = Math.round((left - pageOffPtX) * scale);
        const y = Math.round((top  - pageOffPtY) * scale);
        const w = Math.round((w_pt - left) * scale) + 1;
        const h = Math.round((h_pt - top)  * scale) + 1;
        if (w <= 0 || h <= 0) return null;
        const s = new RectangleShape(x, y, w, h);
        s.fillIdx = fillFromType;
        s.strokeWidth = strokeWidth;
        s.strokePatternIdx = strokePat;
        return s;
    }

    if (shapeTypeCode === 0x09) {
        if (o + 30 > bytes.length) return null;
        const nPts = (bytes[o + 8] << 8) | bytes[o + 9];
        if (nPts < 2 || o + 28 + nPts * 8 > bytes.length) return null;
        const pts = [];
        for (let i = 0; i < nPts; i++) {
            const yPt = readFixed(view, o + 28 + i * 8);
            const xPt = readFixed(view, o + 28 + i * 8 + 4);
            const cx = Math.round((xPt - pageOffPtX) * scale);
            const cy = Math.round((yPt - pageOffPtY) * scale);
            pts.push({ x: cx, y: cy, c1x: cx, c1y: cy, c2x: cx, c2y: cy });
        }
        const s = new BezierShape(pts);
        s.strokeWidth = strokeWidth;
        s.strokePatternIdx = strokePat;
        s.fillIdx = 0;
        return s;
    }

    const _isArcRec = recLen >= 28 && flags === 0x00 &&
        (type === 0x01 || (type === 0x02 && bytes[o + 1] === 0x05) || shapeTypeCode === 0x07);
    if (_isArcRec ? (top < -500 || left < -500) : (top < 0 || left < 0)) return null;

    const x = Math.round((left - pageOffPtX) * scale);
    const y = Math.round((top  - pageOffPtY) * scale);
    const w = Math.round((w_pt - left) * scale);
    const h = Math.round((h_pt - top)  * scale);

    if (w <= 0 || h <= 0 || x < -200 || y < -200 || x > 5000 || y > 5000 || w > 5000 || h > 5000) return null;

    if (flags === 0 && !_isArcRec && top < 5) return null;

    const fillIdx = fillFromType;
    const bboxHex = Array.from({length: 16}, (_, k) => bytes[o + 4 + k].toString(16).padStart(2,'0')).join(' ');
    dbg(`MDraw shapeType=0x${shapeTypeCode.toString(16).padStart(2,'0')}(${SHAPE_TYPE_NAMES[shapeTypeCode] ?? '?'}) class=0x${flags.toString(16).padStart(2,'0')}(${SHAPE_CLASS_NAMES[flags] ?? '?'}) fillMode=0x${type.toString(16).padStart(2,'0')}(${FILL_MODE_NAMES[type] ?? '?'}) (${x},${y}) ${w}×${h}  fill=${fillIdx} pen=${strokeWidth} len=${recLen}  bbox: ${bboxHex}`);

    if (flags >= 0x01 && flags <= 0x06) {
        const qdPenW = bytes[o + 0] + 1;
        const ovalDiamPts = flags >= 0x02 ? flags * 9 : 0;
        const cornerPts = Math.max(0, Math.floor((ovalDiamPts - qdPenW) / 2));
        const s = cornerPts > 0 ? new RoundRectShape(x, y, w, h) : new RectangleShape(x, y, w, h);
        if (cornerPts > 0) s.cornerRadius = Math.round(cornerPts * scale);
        s.fillIdx = fillFromType;
        s.strokeWidth = strokeWidth;
        s.strokePatternIdx = bytes[o + 1];
        return s;
    }
    if (flags !== 0) {
        dbg(`MDraw: unknown class=0x${flags.toString(16).padStart(2,'0')} shapeType=0x${shapeTypeCode.toString(16).padStart(2,'0')}(${SHAPE_TYPE_NAMES[shapeTypeCode] ?? '?'}) fillMode=0x${type.toString(16).padStart(2,'0')}(${FILL_MODE_NAMES[type] ?? '?'}) (${x},${y}) ${w}×${h} — skipped`);
        return null;
    }

    if (shapeTypeCode === 0x07) {
        const arc_w = Math.round((w_pt - left) * scale) + 1;
        const arc_h = Math.round((h_pt - top)  * scale) + 1;
        if (arc_w <= 0 || arc_h <= 0) return null;
        let startAngle = 0, arcAngle = 90, quadrant = 0;
        if (recLen >= 28 && o + 28 <= bytes.length) {
            startAngle = view.getInt16(o + 20, false);
            arcAngle   = view.getInt16(o + 22, false);
            const mid  = ((startAngle + arcAngle / 2) % 360 + 360) % 360;
            quadrant   = Math.min(3, Math.floor(mid / 90));
        }
        dbg(`MDraw ARC start=${startAngle} arc=${arcAngle} → Q${quadrant}  (${x},${y}) ${arc_w}×${arc_h} fill=${fillIdx}`);
        const s = new ArcShape(x, y, arc_w, arc_h);
        s.quadrant       = quadrant;
        s.startAngleDeg  = startAngle;
        s.arcAngleDeg    = arcAngle;
        s.fillIdx        = fillIdx;
        s.strokeWidth    = strokeWidth;
        s.strokePatternIdx = strokePat;
        return s;
    }

    if (shapeTypeCode === 0x06) {
        const s = new EllipseShape(x, y, w + 1, h + 1);
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth; s.strokePatternIdx = strokePat;
        return s;
    }

    switch (type) {
    case 0x01: {
        if (recLen >= 28 && o + 28 <= bytes.length) {
            const arc_w = Math.round((w_pt - left) * scale) + 1;
            const arc_h = Math.round((h_pt - top)  * scale) + 1;
            if (arc_w <= 0 || arc_h <= 0) return null;
            const startAngle = view.getInt16(o + 20, false);
            const arcAngle   = view.getInt16(o + 22, false);
            const mid = ((startAngle + arcAngle / 2) % 360 + 360) % 360;
            const quadrant = Math.min(3, Math.floor(mid / 90));
            dbg(`MDraw ARC start=${startAngle} arc=${arcAngle} → Q${quadrant}  (${x},${y}) ${arc_w}×${arc_h}`);
            const s = new ArcShape(x, y, arc_w, arc_h);
            s.quadrant = quadrant;
            s.fillIdx = 0;
            s.strokeWidth = strokeWidth;
            return s;
        }
        const s = new EllipseShape(x, y, w + 1, h + 1);
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth;
        return s;
    }
    case 0x04: // group type — should be filtered before here; fallback to oval
    case 0x0F: // OVAL
    case 0x11: { // group type — should be filtered before here; fallback to oval
        const s = new EllipseShape(x, y, w, h);
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth;
        return s;
    }
    case 0x02: {
        if (bytes[o + 1] === 0x05 && recLen >= 28 && o + 28 <= bytes.length) {
            const arc_w = Math.round((w_pt - left) * scale) + 1;
            const arc_h = Math.round((h_pt - top)  * scale) + 1;
            if (arc_w <= 0 || arc_h <= 0) return null;
            const startAngleDeg = view.getInt16(o + 20, false);
            const arcAngleDeg   = view.getInt16(o + 22, false);
            const mid = ((startAngleDeg + arcAngleDeg / 2) % 360 + 360) % 360;
            const quadrant = Math.min(3, Math.floor(mid / 90));
            const reshapeFill   = bytes[o + 24] ?? 0;
            const reshapeStroke = bytes[o + 1];
            dbg(`MDraw RESHAPE ARC start=${startAngleDeg} arc=${arcAngleDeg} → Q${quadrant} (${x},${y}) ${arc_w}×${arc_h} fill=${reshapeFill} strokePat=${reshapeStroke}`);
            const s = new ArcShape(x, y, arc_w, arc_h);
            s.quadrant = quadrant;
            s.startAngleDeg = startAngleDeg;
            s.arcAngleDeg   = arcAngleDeg;
            s.fillIdx        = reshapeFill + 1;
            s.strokePatternIdx = reshapeStroke;
            s.strokeWidth    = strokeWidth;
            return s;
        }
        const s = new RectangleShape(x, y, w, h);
        s.fillIdx = fillIdx;
        s.strokeWidth = strokeWidth;
        return s;
    }
    case 0x03: {
        const s = new RoundRectShape(x, y, w, h);
        s.cornerRadius = 10;
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth;
        return s;
    }
    case 0x05: {
        const s = new EllipseShape(x, y, w, h);
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth;
        return s;
    }
    default:
        dbg(`MDraw: unknown fillMode=0x${type.toString(16).padStart(2,'0')}(${FILL_MODE_NAMES[type] ?? '?'}) — skipped`);
        return null;
    }
}

// ─── Main DRW parser ──────────────────────────────────────────────────────────

/**
 * Top-level parser for a MacDraw II .drw file.
 *
 * Every record (group or shape) starts with a 4-byte prefix [typeCode, 0x00, {0|1}, 0x00]
 * followed by a 4-byte header [pen, stroke, fill, class] and shape data.
 * The parser scans sequentially, dispatching on typeCode and advancing by the known record size.
 * Group records (0x0a) contain nChildren child records starting at header+36; their inter-record
 * footer bytes are skipped naturally because they don't match the prefix pattern.
 *
 * Coordinates are 16.16 fixed-point at 72 dpi; output is in 96 dpi screen pixels (scale = 96/72).
 */
export function parseMacDraw(buffer, bytes) {
    const view = new DataView(buffer);
    const shapes = [];
    const scale  = 96 / 72;

    const startOffset = findMacDrawObjects(bytes);
    if (startOffset < 0) throw new Error('MacDraw II: could not locate drawing objects in file.');

    // ── Single sequential scan ────────────────────────────────────────────────
    // Prefix pattern: [typeCode, 0x00, {0|1}, 0x00]. typeCode 0x0a = group.
    let pos = startOffset - 4; // step back to include the prefix of the first record
    while (pos < bytes.length - 4) {
        const tc = bytes[pos];
        if (tc < 0x02 || tc > 0x0a ||
            bytes[pos + 1] !== 0x00 || bytes[pos + 2] > 0x01 || bytes[pos + 3] !== 0x00) {
            pos++; continue;
        }

        const hp = pos + 4;
        if (hp + 20 > bytes.length) break;

        if (tc === 0x0a) {
            // ── Group ─────────────────────────────────────────────────────────
            if (bytes[hp + 1] !== 0x03 || bytes[hp + 2] >= 0x20) { pos++; continue; }
            const gtop  = readFixed(view, hp + 4);
            const gleft = readFixed(view, hp + 8);
            if (gtop < -100 || gtop > 10000 || gleft < -100 || gleft > 10000) { pos++; continue; }
            const nChildren = (bytes[hp + 20] << 8) | bytes[hp + 21];
            if (nChildren === 0 || nChildren > 200) { pos++; continue; }

            const childShapes = [];
            let cPos = hp + 36; // children immediately follow the 36-byte group header
            for (let ci = 0; ci < nChildren; ci++) {
                const sz = recordSize(bytes, cPos);
                if (sz === 0) break;
                const chp = cPos + 4;
                const s = bytes[cPos] === 0x08
                    ? parseFreehandStroke(view, bytes, chp, scale)
                    : parseMacDrawRecord(view, bytes, chp, bytes[chp + 2], bytes[chp + 3], scale, 0, 0, sz);
                if (s) childShapes.push(s);
                cPos += sz;
            }

            if (childShapes.length > 0) shapes.push(new GroupShape(childShapes));
            pos = cPos; // footer bytes between groups don't match the prefix → skipped naturally
            continue;
        }

        // ── Standalone shape ──────────────────────────────────────────────────
        if (bytes[hp] < 0x01 || bytes[hp] >= 0x20 || bytes[hp + 2] >= 0x20) { pos++; continue; }

        const sz = recordSize(bytes, pos);
        if (sz === 0) { pos++; continue; }

        const shape = tc === 0x08
            ? parseFreehandStroke(view, bytes, hp, scale)
            : parseMacDrawRecord(view, bytes, hp, bytes[hp + 2], bytes[hp + 3], scale, 0, 0, sz);
        if (shape) shapes.push(shape);
        pos += sz;
    }

    for (const t of parseMacDrawText(view, bytes, scale)) shapes.push(t);
    return shapes;
}
