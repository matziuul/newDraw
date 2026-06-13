import { RectangleShape, EllipseShape, LineShape, TextShape, RoundRectShape } from './shapes.js';
import { QD_PATTERNS } from './patterns.js';

// ─── Public entry point ───────────────────────────────────────────────────────

export function importMacFile(buffer) {
    const bytes = new Uint8Array(buffer);
    const fmt = detectFormat(bytes);
    if (fmt === 'pict')    return { shapes: parsePict(buffer, bytes),    format: 'PICT' };
    if (fmt === 'macdraw') return { shapes: parseMacDraw(buffer, bytes), format: 'MacDraw II' };
    throw new Error('Unrecognized format — expected a PICT (.pict) or MacDraw II (.drw) file.');
}

// ─── Format detection ─────────────────────────────────────────────────────────

function detectFormat(bytes) {
    // PICT: look for the version opcode at offset 10 (no header) or 522 (512-byte header)
    for (const hdr of [512, 0]) {
        if (isPictVersionAt(bytes, hdr)) return 'pict';
    }
    if (isMacDrawHeader(bytes)) return 'macdraw';
    return 'unknown';
}

function isPictVersionAt(bytes, headerSize) {
    const o = headerSize + 2 + 8; // skip picSize(2) + boundrect(8)
    if (bytes.length < o + 4) return false;
    if (bytes[o] === 0x11 && bytes[o+1] === 0x01) return true;            // PICT v1
    if (bytes[o] === 0x00 && bytes[o+1] === 0x11 &&
        bytes[o+2] === 0x02 && bytes[o+3] === 0xFF) return true;          // PICT v2
    return false;
}

function isMacDrawHeader(bytes) {
    if (bytes.length < 4) return false;
    // 'DRWG' literal in first 8 bytes (some flat versions)
    if (bytes[0]===0x44&&bytes[1]===0x52&&bytes[2]===0x57&&bytes[3]===0x47) return true;
    // Known version word at offset 0: 0x0000, 0x0100, 0x0200, 0x0300
    const v = (bytes[0] << 8) | bytes[1];
    if (v === 0x0000 || v === 0x0100 || v === 0x0200 || v === 0x0300) return true;
    return false;
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

function matchPattern(rows) {
    // Exact match against our palette (skip index 0 = ingen/transparent)
    for (let i = 1; i < QD_PATTERNS.length; i++) {
        const p = QD_PATTERNS[i];
        if (p.rows && rows.every((b, j) => b === p.rows[j])) return i;
    }
    // Approximate by bit density
    const bits = rows.reduce((s, b) => s + popcount(b), 0);
    if (bits === 0)  return 1; // white
    if (bits <= 10)  return 2; // light
    if (bits <= 32)  return 3; // gray
    if (bits <= 54)  return 4; // dark
    return 5;                  // black
}

function popcount(n) {
    let c = 0; while (n) { c += n & 1; n >>>= 1; } return c;
}

// ─── PICT parser ──────────────────────────────────────────────────────────────

function parsePict(buffer, bytes) {
    const headerSize = isPictVersionAt(bytes, 512) ? 512 : 0;
    return new PictParser(new DataView(buffer), bytes, headerSize).parse();
}

class PictParser {
    constructor(view, bytes, hdr) {
        this.v = view; this.b = bytes; this.o = hdr;
        this.shapes = [];
        this.penW    = 1;
        this.penPat  = 5;  // solid black
        this.fillPat = 0;  // no fill
        this.ovalSize = 10; // corner radius for rounded rects
        this.lastRect = null;
        this.lastPt   = { x: 0, y: 0 };
        this.isV2 = false;
    }

    u8()    { return this.b[this.o++]; }
    i8()    { const v = this.v.getInt8(this.o++); return v; }
    u16()   { const v = this.v.getUint16(this.o, false); this.o += 2; return v; }
    i16()   { const v = this.v.getInt16(this.o, false);  this.o += 2; return v; }
    skip(n) { this.o += n; }
    align() { if (this.o & 1) this.o++; }

    readRect()  {
        const t=this.i16(), l=this.i16(), b=this.i16(), r=this.i16();
        return { t, l, b, r };
    }
    readPt()    { const y=this.i16(), x=this.i16(); return { x, y }; }
    readPat()   { const rows=[]; for(let i=0;i<8;i++) rows.push(this.u8()); return rows; }

    // Shape constructors
    rect(r, strokeOnly) {
        const s = new RectangleShape(r.l, r.t, r.r-r.l, r.b-r.t);
        s.fillIdx = strokeOnly ? 0 : this.fillPat;
        s.strokeWidth = this.penW;
        return s;
    }
    oval(r, strokeOnly) {
        const s = new EllipseShape(r.l, r.t, r.r-r.l, r.b-r.t);
        s.fillIdx = strokeOnly ? 0 : this.fillPat;
        s.strokeWidth = this.penW;
        return s;
    }
    rrect(r, strokeOnly) {
        const s = new RoundRectShape(r.l, r.t, r.r-r.l, r.b-r.t);
        s.cornerRadius = this.ovalSize;
        s.fillIdx = strokeOnly ? 0 : this.fillPat;
        s.strokeWidth = this.penW;
        return s;
    }
    line(a, b) {
        const s = new LineShape(a.x, a.y, b.x, b.y);
        s.strokeWidth = this.penW;
        return s;
    }

    parse() {
        this.skip(2 + 8); // picSize + boundrect

        // Version detection
        if (this.b[this.o] === 0x11 && this.b[this.o+1] === 0x01) {
            this.o += 2;
            this.runV1();
        } else if (this.b[this.o] === 0x00 && this.b[this.o+1] === 0x11) {
            this.isV2 = true;
            this.o += 4; // 0x0011 + 0x02FF
            if (this.b[this.o] === 0x0C && this.b[this.o+1] === 0x00) {
                this.o += 2; // headerOp opcode
                this.skip(24); // headerOp data
            }
            this.runV2();
        }
        return this.shapes;
    }

    runV1() {
        while (this.o < this.b.length) {
            const op = this.u8();
            if (op === 0xFF) break;
            this.op(op);
        }
    }

    runV2() {
        while (this.o < this.b.length) {
            this.align();
            const op = this.u16();
            if (op === 0x00FF) break;
            if (op <= 0xFF)  this.op(op);
            else             this.skipReservedV2(op);
        }
    }

    // Shared opcode handler (v1 byte values; v2 delegates low-byte ops here)
    op(op) {
        switch (op) {
        case 0x00: break; // NOP
        case 0x01: { const n=this.u16(); this.skip(n-2); break; } // Clip
        case 0x02: this.skip(8); break;  // BkPat
        case 0x03: this.skip(2); break;  // TxFont
        case 0x04: this.u8();   break;   // TxFace (1-byte Style)
        case 0x05: this.skip(2); break;  // TxMode
        case 0x06: this.skip(4); break;  // SpExtra
        case 0x07: {                     // PnSize
            const h=this.i16(), _v=this.i16();
            this.penW = Math.max(1, h);
            break;
        }
        case 0x08: this.skip(2); break;  // PnMode
        case 0x09: this.penPat  = matchPattern(this.readPat()); break; // PnPat
        case 0x0A: this.fillPat = matchPattern(this.readPat()); break; // FillPat
        case 0x0B: { const h=this.i16(), w=this.i16(); this.ovalSize = Math.round((h+w)/2); break; } // OvSize
        case 0x0C: this.skip(4); break;  // Origin
        case 0x0D: this.skip(2); break;  // TxSize
        case 0x0E: this.skip(4); break;  // FgColor
        case 0x0F: this.skip(4); break;  // BkColor
        case 0x10: this.skip(8); break;  // TxRatio
        case 0x11: this.u8();   break;   // picVersion byte (v1)
        case 0x15: this.skip(2); break;  // PnLocHFrac
        case 0x16: this.skip(2); break;  // ChExtra
        case 0x1A: this.skip(6); break;  // RGBFgCol
        case 0x1B: this.skip(6); break;  // RGBBkCol
        case 0x1C: break;                // HiliteMode
        case 0x1D: this.skip(6); break;  // HiliteColor
        case 0x1E: break;                // DefHilite
        case 0x1F: this.skip(6); break;  // OpColor

        // ── Lines ──
        case 0x20: {
            const a=this.readPt(), b=this.readPt();
            this.lastPt=b; this.shapes.push(this.line(a,b)); break;
        }
        case 0x21: {
            const b=this.readPt();
            this.shapes.push(this.line(this.lastPt,b)); this.lastPt=b; break;
        }
        case 0x22: {
            const a=this.readPt(), dh=this.i8(), dv=this.i8();
            const b={x:a.x+dh, y:a.y+dv};
            this.lastPt=b; this.shapes.push(this.line(a,b)); break;
        }
        case 0x23: {
            const dh=this.i8(), dv=this.i8();
            const b={x:this.lastPt.x+dh, y:this.lastPt.y+dv};
            this.shapes.push(this.line(this.lastPt,b)); this.lastPt=b; break;
        }

        // ── Text (skip) ──
        case 0x28: { this.readPt(); const n=this.u8(); this.skip(n); break; }
        case 0x29: { this.u8(); const n=this.u8(); this.skip(n); break; }
        case 0x2A: { this.u8(); const n=this.u8(); this.skip(n); break; }
        case 0x2B: { this.skip(2); const n=this.u8(); this.skip(n); break; }
        case 0x2C: { const n=this.u16(); this.skip(n-2); break; }
        case 0x2D: this.skip(10); break;
        case 0x2E: { const n=this.u16(); this.skip(n-2); break; }

        // ── Rect ──
        case 0x30: { const r=this.readRect(); this.lastRect=r; this.shapes.push(this.rect(r,true)); break; }
        case 0x31: { const r=this.readRect(); this.lastRect=r;
            const s=this.rect(r,false); s.fillIdx=this.penPat; this.shapes.push(s); break; }
        case 0x32: { this.readRect(); break; }  // eraseRect
        case 0x33: { this.readRect(); break; }  // invertRect
        case 0x34: { const r=this.readRect(); this.lastRect=r;
            const s=this.rect(r,false); s.strokeWidth=0; this.shapes.push(s); break; }
        case 0x38: { if(this.lastRect) this.shapes.push(this.rect(this.lastRect,true)); break; }
        case 0x39: { if(this.lastRect) { const s=this.rect(this.lastRect,false); s.fillIdx=this.penPat; this.shapes.push(s); } break; }
        case 0x3A: case 0x3B: break;
        case 0x3C: { if(this.lastRect) { const s=this.rect(this.lastRect,false); s.strokeWidth=0; this.shapes.push(s); } break; }

        // ── Rounded rect ──
        case 0x40: { const r=this.readRect(); this.lastRect=r; this.shapes.push(this.rrect(r,true)); break; }
        case 0x41: { const r=this.readRect(); this.lastRect=r;
            const s=this.rrect(r,false); s.fillIdx=this.penPat; this.shapes.push(s); break; }
        case 0x42: { this.readRect(); break; }
        case 0x43: { this.readRect(); break; }
        case 0x44: { const r=this.readRect(); this.lastRect=r;
            const s=this.rrect(r,false); s.strokeWidth=0; this.shapes.push(s); break; }
        case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: break; // same-rrect, 0 bytes

        // ── Oval ──
        case 0x50: { const r=this.readRect(); this.lastRect=r; this.shapes.push(this.oval(r,true)); break; }
        case 0x51: { const r=this.readRect(); this.lastRect=r;
            const s=this.oval(r,false); s.fillIdx=this.penPat; this.shapes.push(s); break; }
        case 0x52: { this.readRect(); break; }
        case 0x53: { this.readRect(); break; }
        case 0x54: { const r=this.readRect(); this.lastRect=r;
            const s=this.oval(r,false); s.strokeWidth=0; this.shapes.push(s); break; }
        case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: break; // same-oval, 0 bytes

        // ── Arc (skip — no arc type yet) ──
        case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: this.skip(12); break;
        case 0x68: case 0x69: case 0x6A: case 0x6B: case 0x6C: this.skip(4); break;

        // ── Polygon ──
        case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: this.readPoly(op); break;
        case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: this.readPoly(op); break;

        // ── Region (skip) ──
        case 0x80: case 0x81: case 0x82: case 0x83: case 0x84:
        case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8C: {
            const n=this.u16(); this.skip(n-2); break;
        }

        // ── Bitmaps (skip — we can't render these) ──
        case 0x90: case 0x91: this.skipBitsRect(op===0x91); break;
        case 0x98: case 0x99: this.skipPackBitsRect(op===0x99); break;
        case 0x9A: case 0x9B: this.skipDirectBitsRect(op===0x9B); break;

        // ── Comments ──
        case 0xA0: this.skip(2); break;                                // ShortComment
        case 0xA1: { this.skip(2); const n=this.u16(); this.skip(n); break; } // LongComment

        default: break; // unknown — stop-gap, caller can bail
        }
    }

    readPoly(op) {
        const size = this.u16();
        this.readRect(); // bounding rect (8 bytes, consumed)
        const nPts = (size - 10) / 4;
        const pts = [];
        for (let i = 0; i < nPts; i++) pts.push(this.readPt());

        const draw = (op & 0xF8) === 0x70 || (op & 0xF8) === 0x78;
        if (draw) {
            for (let i = 0; i < pts.length - 1; i++)
                this.shapes.push(this.line(pts[i], pts[i+1]));
            if (pts.length > 2) {
                const a=pts[pts.length-1], b=pts[0];
                if (a.x!==b.x || a.y!==b.y) this.shapes.push(this.line(a,b));
            }
        }
    }

    skipBitsRect(withRegion) {
        const rRaw = this.u16(), rowBytes = rRaw & 0x7FFF, isPixmap = !!(rRaw & 0x8000);
        const bds = this.readRect(), height = bds.b - bds.t;
        if (isPixmap) { this.skip(36); this.skipColorTable(); }
        this.skip(8 + 8 + 2); // srcRect + dstRect + mode
        if (withRegion) { const n=this.u16(); this.skip(n-2); }
        this.skip(height * rowBytes);
    }

    skipPackBitsRect(withRegion) {
        const rRaw = this.u16(), rowBytes = rRaw & 0x7FFF, isPixmap = !!(rRaw & 0x8000);
        const bds = this.readRect(), height = bds.b - bds.t;
        if (isPixmap) { this.skip(36); this.skipColorTable(); }
        this.skip(8 + 8 + 2);
        if (withRegion) { const n=this.u16(); this.skip(n-2); }
        for (let i = 0; i < height; i++) {
            const n = rowBytes > 250 ? this.u16() : this.u8();
            this.skip(n);
        }
    }

    skipDirectBitsRect(withRegion) {
        this.skip(4); // baseAddr placeholder
        const rRaw = this.u16(), rowBytes = rRaw & 0x7FFF;
        const bds = this.readRect(), height = bds.b - bds.t;
        this.skip(36); this.skipColorTable();
        this.skip(8 + 8 + 2);
        if (withRegion) { const n=this.u16(); this.skip(n-2); }
        for (let i = 0; i < height; i++) {
            const n = rowBytes > 250 ? this.u16() : this.u8();
            this.skip(n);
        }
    }

    skipColorTable() {
        this.skip(4 + 2); // ctSeed + ctFlags
        const ctSize = this.u16(); // count - 1
        this.skip((ctSize + 1) * 8); // value(2) + RGBColor(6) each
    }

    skipReservedV2(op) {
        // PICT v2 reserved opcodes: upper byte encodes data-word count
        // 0x0100–0x7FFF: skip (op >> 7) & ~1 bytes (approximate rule)
        // Safe fallback: skip based on upper nibble
        const dataLen = (op >= 0x0100) ? ((op >>> 7) & 0xFFFE) : 0;
        this.skip(dataLen);
    }
}

// ─── MacDraw II parser ───────────────────────────────────────────────────────

function parseMacDraw(buffer, bytes) {
    const view = new DataView(buffer);
    const shapes = [];
    const scale  = 96 / 72;

    const startOffset = findMacDrawObjects(bytes);
    if (startOffset < 0) throw new Error('MacDraw II: could not locate drawing objects in file.');

    // Collect all record-start positions (02 03 type flags, type < 0x20)
    const recs = [];
    for (let i = startOffset; i < bytes.length - 3; i++) {
        if (bytes[i] === 0x02 && bytes[i+1] === 0x03 && bytes[i+2] < 0x20) recs.push(i);
    }
    recs.push(bytes.length);

    for (let ri = 0; ri < recs.length - 1; ri++) {
        const o = recs[ri];
        if (recs[ri+1] - o < 20) continue; // too small for coordinate data (group containers etc.)

        const type = bytes[o+2], flags = bytes[o+3];
        const shape = parseMacDrawRecord(view, bytes, o, type, flags, scale);
        if (shape) shapes.push(shape);
    }

    // Second pass: extract text objects
    for (const t of parseMacDrawText(view, bytes, scale)) shapes.push(t);

    return shapes;
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
    // Two-pass: collect typed inner records first (0x01/0x1A), then 0x02 wrappers.
    // This way inner-record positions win over outer wrapper positions for same text.
    const entries = [];  // { text, x, y, priority }

    for (const pass of [0, 1]) {
        for (let i = 0x200; i < bytes.length - 30; i++) {
            if (bytes[i] !== 0x02 || bytes[i+1] !== 0x03) continue;
            const type = bytes[i+2], flags = bytes[i+3];
            const isWrapper = (type === 0x02 && flags === 0x00);
            if (pass === 0 && isWrapper) continue;   // typed records first
            if (pass === 1 && !isWrapper) continue;  // wrappers second

            let textOff = -1, x = 0, y = 0;

            if (type === 0x01 && flags === 0x01) {
                if (i + 12 > bytes.length) continue;
                textOff = 15;
                x = view.getInt16(i + 8,  true) * scale;
                y = view.getInt16(i + 10, true) * scale;
            } else if (type === 0x1A) {
                if (i + 14 > bytes.length) continue;
                textOff = 19;
                x = view.getInt16(i + 10, true) * scale;
                y = view.getInt16(i + 12, true) * scale;
            } else if (isWrapper) {
                // Skip if valid geometric bbox (top >= 5 and left >= 5 pts).
                const top2  = view.getInt16(i + 4,  false) + view.getUint16(i + 6,  false) / 65536;
                const left2 = view.getInt16(i + 8,  false) + view.getUint16(i + 10, false) / 65536;
                const bot2  = view.getInt16(i + 12, false) + view.getUint16(i + 14, false) / 65536;
                const rgt2  = view.getInt16(i + 16, false) + view.getUint16(i + 18, false) / 65536;
                const w2 = rgt2 - left2, h2 = bot2 - top2;
                if (top2 >= 5 && left2 >= 5 && w2 > 0 && h2 > 0 && w2 < 5000 && h2 < 5000) continue;
                if (i + 22 > bytes.length) continue;
                textOff = 24;
                y = view.getInt16(i + 14, false) * scale;
                x = view.getInt16(i + 20, false) * scale;
            } else {
                continue;
            }

            if (i + textOff >= bytes.length) continue;
            if (!isPrintableAt(bytes, i + textOff, 3)) continue;
            const text = macDrawReadString(bytes, i + textOff);
            if (!text || text.trim().length < 2) continue;
            entries.push({ text, x, y });
        }
    }

    // Deduplicate by text content (first occurrence — typed inner records — wins)
    const seenText = new Set();
    const shapes = [];
    for (const { text, x, y } of entries) {
        const key = text.trim().slice(0, 30);
        if (seenText.has(key)) continue;
        seenText.add(key);
        shapes.push(new TextShape(x, y, text, 'Geneva', 12, 0));
    }
    return shapes;
}

// MacDraw II DRWG format: 512-byte header + 4-byte section marker at 0x200 → records from 0x204.
// The first record always starts with 02 03.
function findMacDrawObjects(bytes) {
    if (bytes.length >= 0x208 &&
        bytes[0] === 0x44 && bytes[1] === 0x52 && bytes[2] === 0x57 && bytes[3] === 0x47 &&
        bytes[0x204] === 0x02 && bytes[0x205] === 0x03 && bytes[0x206] < 0x20) {
        return 0x204;
    }
    // Fallback scan for the first 02 03 [type < 0x20] beyond any header
    for (let i = 4; i < Math.min(bytes.length - 3, 2048); i++) {
        if (bytes[i] === 0x02 && bytes[i+1] === 0x03 && bytes[i+2] < 0x20) return i;
    }
    return -1;
}

// Each record: [02][03][type][flags] + 4 × Fixed16.16 bounding rect (top, left, bottom, right)
// Coordinates are 72 DPI page units; scale × (96/72) = × (4/3) to reach canvas pixels.
function readFixed(view, offset) {
    return view.getInt16(offset, false) + view.getUint16(offset + 2, false) / 65536;
}

function parseMacDrawRecord(view, bytes, o, type, flags, scale) {
    if (o + 20 > bytes.length) return null;

    const top  = readFixed(view, o + 4);
    const left = readFixed(view, o + 8);
    const bot  = readFixed(view, o + 12);
    const rgt  = readFixed(view, o + 16);

    const x = Math.round(left * scale);
    const y = Math.round(top  * scale);
    const w = Math.round((rgt - left) * scale);
    const h = Math.round((bot - top)  * scale);

    if (w <= 0 || h <= 0 || x < -200 || y < -200 || x > 5000 || y > 5000 || w > 5000 || h > 5000) return null;
    // Require meaningful page coordinates — rejects false-positives whose bbox bytes encode
    // non-coordinate data with near-zero fractional Fixed16.16 top/left values.
    if (top < 5 || left < 5) return null;

    switch (type) {
    case 0x02: { // RECT — no fill, just border
        const s = new RectangleShape(x, y, w, h);
        s.fillIdx = 0; s.strokeWidth = 1;
        return s;
    }
    case 0x04: // OVAL — diagonal medium-dark fill
    case 0x11: { // OVAL variant — same fill
        const s = new EllipseShape(x, y, w, h);
        s.fillIdx = 14; // QD_PATTERNS[14] = 'diag ↘↘' (diagonal lines, medium-dark)
        s.strokeWidth = 1;
        return s;
    }
    case 0x0F: { // Small rect with light line fill
        const s = new RectangleShape(x, y, w, h);
        s.fillIdx = 20; // QD_PATTERNS[20] = 'h-gles' (light horizontal lines)
        s.strokeWidth = 1;
        return s;
    }
    default: return null;
    }
}
