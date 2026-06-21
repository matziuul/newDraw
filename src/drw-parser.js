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

function readFixed(view, offset) {
    return view.getInt16(offset, false) + view.getUint16(offset + 2, false) / 65536;
}

// ─── Freehand stroke helpers ──────────────────────────────────────────────────

// Ramer-Douglas-Peucker polyline simplification.
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

// Convert a simplified polyline to bezier points using Catmull-Rom tangents.
function catmullRomBezier(pts) {
    const n = pts.length;
    const result = [];
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        let tx, ty;
        if (i === 0)       { tx = pts[1].x - p.x;         ty = pts[1].y - p.y; }
        else if (i === n-1){ tx = p.x - pts[n-2].x;       ty = p.y - pts[n-2].y; }
        else               { tx = (pts[i+1].x - pts[i-1].x) / 2; ty = (pts[i+1].y - pts[i-1].y) / 2; }
        result.push({
            x:   p.x,             y:   p.y,
            c1x: i === 0   ? p.x : p.x - tx / 3,
            c1y: i === 0   ? p.y : p.y - ty / 3,
            c2x: i === n-1 ? p.x : p.x + tx / 3,
            c2y: i === n-1 ? p.y : p.y + ty / 3,
        });
    }
    return result;
}

// Freehand pencil stroke (shape type 0x08).
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

// ─── Text extraction ──────────────────────────────────────────────────────────

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

function isPrintableAt(bytes, off, minRun) {
    for (let i = 0; i < minRun; i++) {
        if (off + i >= bytes.length) return false;
        const c = bytes[off + i];
        if ((c < 32 || c >= 127) && c !== 0x0D && c !== 0x0A) return false;
    }
    return true;
}

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

// MacDraw II DRWG format: 512-byte header + 4-byte section marker at 0x200 → records from 0x204.
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

export function parseMacDraw(buffer, bytes) {
    const view = new DataView(buffer);
    const shapes = [];
    const scale  = 96 / 72;

    const startOffset = findMacDrawObjects(bytes);
    if (startOffset < 0) throw new Error('MacDraw II: could not locate drawing objects in file.');

    const recs = [];
    if (startOffset >= 0 &&
        bytes[startOffset] >= 0x02 &&
        bytes[startOffset + 1] !== 0x03 &&
        bytes[startOffset + 2] < 0x20) {
        recs.push(startOffset);
    }
    for (let i = startOffset; i < bytes.length - 3; i++) {
        if (bytes[i] >= 0x01 && bytes[i+1] >= 0x01 && bytes[i+2] < 0x20) {
            if (recs.length === 0 || i - recs[recs.length - 1] >= 24) recs.push(i);
        }
    }
    dbg('MDraw recs found:', recs.length, 'at offsets', recs.slice(0, 10).map(r => '0x'+r.toString(16)));
    for (let _ri = 0; _ri < Math.min(recs.length, 5); _ri++) {
        const _o = recs[_ri];
        const _len = _ri + 1 < recs.length ? recs[_ri+1] - _o : bytes.length - _o;
        const _d = Array.from({length: Math.min(48, _len)}, (_, k) => bytes[_o+k].toString(16).padStart(2,'0')).join(' ');
        dbg(`  rec[${_ri}] 0x${_o.toString(16)} len=${_len}: ${_d}`);
    }
    recs.push(bytes.length);

    // First pass: collect raw Fixed16.16 bboxes for all candidate records
    const rawBoxes = [];
    for (let ri = 0; ri < recs.length - 1; ri++) {
        const o = recs[ri];
        if (recs[ri+1] - o < 20 || o + 20 > bytes.length) { rawBoxes.push(null); continue; }
        const _t = readFixed(view, o + 4), _l = readFixed(view, o + 8);
        const _f3 = readFixed(view, o + 12), _f4 = readFixed(view, o + 16);
        const _recLen = recs[ri+1] - o;
        const _isLine = bytes[o+2]===0x02 && bytes[o+1]!==0x05;
        const _isArc = (bytes[o+2]===0x01 || (bytes[o+2]===0x02 && bytes[o+1]===0x05)) && _recLen >= 28;
        if (_isLine) {
            rawBoxes.push({ top: Math.min(_t, _f3), left: Math.min(_l, _f4),
                            bot: Math.max(_t, _f3), rgt: Math.max(_l, _f4) });
        } else if (_isArc) {
            rawBoxes.push({ top: _t, left: _l, bot: _f3, rgt: _f4 });
        } else {
            rawBoxes.push({ top: _t, left: _l, bot: _f3, rgt: _f4 });
        }
    }

    const pageOffPtX = 0;
    const pageOffPtY = 0;

    const GROUP_TYPES = new Set([0x04, 0x11]);
    const groupContainerIdxs = new Set();
    for (let i = 0; i < rawBoxes.length; i++) {
        const a = rawBoxes[i];
        if (!a) continue;
        if (!GROUP_TYPES.has(bytes[recs[i] + 2])) continue;
        let uTop = Infinity, uLeft = Infinity, uBot = -Infinity, uRgt = -Infinity, n = 0;
        for (let j = 0; j < rawBoxes.length; j++) {
            if (i === j) continue;
            const b = rawBoxes[j];
            if (!b) continue;
            if (b.top >= a.top && b.left >= a.left && b.bot <= a.bot && b.rgt <= a.rgt) {
                uTop = Math.min(uTop, b.top); uLeft = Math.min(uLeft, b.left);
                uBot = Math.max(uBot, b.bot); uRgt = Math.max(uRgt, b.rgt);
                n++;
            }
        }
        const tol = 1.0;
        if (n >= 2 &&
            Math.abs(uTop - a.top) < tol && Math.abs(uLeft - a.left) < tol &&
            Math.abs(uBot - a.bot) < tol && Math.abs(uRgt - a.rgt) < tol) {
            groupContainerIdxs.add(i);
        }
    }

    const groupChildMap = new Map();
    const claimed = new Set();
    const sortedGroups = [...groupContainerIdxs].sort((a, b) => {
        const ba = rawBoxes[a], bb = rawBoxes[b];
        return (ba.rgt - ba.left) * (ba.bot - ba.top) - (bb.rgt - bb.left) * (bb.bot - bb.top);
    });
    for (const gi of sortedGroups) {
        const a = rawBoxes[gi];
        const children = [];
        for (let j = 0; j < rawBoxes.length; j++) {
            if (j === gi || claimed.has(j)) continue;
            const b = rawBoxes[j];
            if (!b) continue;
            if (b.top >= a.top && b.left >= a.left && b.bot <= a.bot && b.rgt <= a.rgt)
                children.push(j);
        }
        groupChildMap.set(gi, children);
        for (const ci of children) claimed.add(ci);
    }

    const buildGroup = (gi) => {
        const childShapes = [];
        for (const ci of groupChildMap.get(gi) || []) {
            const co = recs[ci];
            let s;
            if (groupContainerIdxs.has(ci)) {
                s = buildGroup(ci);
            } else {
                s = parseMacDrawRecord(view, bytes, co, bytes[co+2], bytes[co+3], scale, pageOffPtX, pageOffPtY, recs[ci+1] - co);
            }
            if (s) childShapes.push(s);
        }
        return childShapes.length > 0 ? new GroupShape(childShapes) : null;
    };

    // ── Typed group containers (shapeTypeCode = 0x0a) ─────────────────────────
    const typedGroupHandled = new Set();

    for (let pos = startOffset - 4; pos + 40 < bytes.length; pos++) {
        if (bytes[pos] !== 0x0a) continue;
        const o = pos + 4;
        if (o + 36 > bytes.length) continue;
        if (bytes[o] < 0x02 || bytes[o + 1] !== 0x03 || bytes[o + 2] >= 0x20) continue;

        const childCount = (bytes[o + 20] << 8) | bytes[o + 21];
        if (childCount === 0 || childCount > 200) continue;

        const childStart = o + 36;
        const groupByteEnd = childStart + childCount * 24;
        if (groupByteEnd > bytes.length) continue;

        let allValid = true;
        for (let ci = 0; ci < childCount; ci++) {
            const hp0 = childStart + ci * 24 + 4;
            if (hp0 + 4 > bytes.length ||
                bytes[hp0] < 0x02 || bytes[hp0 + 1] < 0x01 || bytes[hp0 + 2] >= 0x20 ||
                bytes[hp0] > 0x0a) { allValid = false; break; }
        }
        if (!allValid) continue;

        const childShapes = [];
        for (let ci = 0; ci < childCount; ci++) {
            const hp = childStart + ci * 24 + 4;
            if (hp + 20 > bytes.length) break;
            if (bytes[hp] < 0x02 || bytes[hp + 1] < 0x01 || bytes[hp + 2] >= 0x20) break;
            const s = parseMacDrawRecord(view, bytes, hp, bytes[hp + 2], bytes[hp + 3],
                                         scale, pageOffPtX, pageOffPtY, 20);
            if (s) childShapes.push(s);
        }

        if (childShapes.length > 0) {
            const g = new GroupShape(childShapes);
            g.debugSource = { format: 'DRW', offset: o, typeCode: 0x0a };
            shapes.push(g);
            typedGroupHandled.add(o);
        }

        const claimEnd = groupByteEnd + 8;
        for (let j = 0; j < recs.length - 1; j++) {
            if (recs[j] >= pos && recs[j] < claimEnd) claimed.add(j);
        }

        pos = groupByteEnd + 7;
    }

    for (let ri = 0; ri < recs.length - 1; ri++) {
        const o = recs[ri];
        if (recs[ri+1] - o < 20 || claimed.has(ri)) continue;
        if (typedGroupHandled.has(o)) continue;
        const shapeTypePre = o >= 4 ? bytes[o - 4] : 0;
        let shape;
        if (groupContainerIdxs.has(ri)) {
            const gcAttr = Array.from({length: 28}, (_, k) => (bytes[o + 20 + k] ?? 0).toString(16).padStart(2, '0')).join(' ');
            dbg(`MDraw GROUP type=0x${bytes[o+2].toString(16).padStart(2,'0')} flags=0x${bytes[o+3].toString(16).padStart(2,'0')} len=${recs[ri+1]-o}  attr[+20..+47]: ${gcAttr}`);
            shape = buildGroup(ri);
        } else if (shapeTypePre === 0x08) {
            shape = parseFreehandStroke(view, bytes, o, scale);
            if (shape) {
                let deltaEnd = o + 36;
                while (deltaEnd + 1 < bytes.length) {
                    if (bytes[deltaEnd] === 0 && bytes[deltaEnd + 1] === 0) break;
                    deltaEnd += 2;
                }
                for (let j = ri + 1; j < recs.length - 1; j++) {
                    if (recs[j] <= deltaEnd) claimed.add(j); else break;
                }
            }
        } else {
            shape = parseMacDrawRecord(view, bytes, o, bytes[o+2], bytes[o+3], scale, pageOffPtX, pageOffPtY, recs[ri+1] - o);
        }
        if (shape) {
            shape.debugSource = { format: 'DRW', offset: o, typeCode: bytes[o+2] };
            shapes.push(shape);
        }
    }

    for (const t of parseMacDrawText(view, bytes, scale)) shapes.push(t);
    return shapes;
}
