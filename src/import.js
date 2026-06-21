import { RectangleShape, EllipseShape, LineShape, TextShape, RoundRectShape, ArcShape, GroupShape, BezierShape } from './shapes.js';
import { QD_PATTERNS } from './patterns.js';

// ─── Public entry point ───────────────────────────────────────────────────────

export function importMacFile(buffer) {
    const bytes = new Uint8Array(buffer);
    const fmt = detectFormat(bytes);
    if (fmt === 'pict') {
        const canvas = readPictCanvas(bytes);
        return { shapes: parsePict(buffer, bytes), format: 'PICT', ...canvas };
    }
    if (fmt === 'macdraw') {
        const canvas = readMacDrawCanvas(bytes);
        return { shapes: parseMacDraw(buffer, bytes), format: 'MacDraw II', ...canvas };
    }
    throw new Error('Unrecognized format — expected a PICT (.pict) or MacDraw II (.drw) file.');
}

// Canvas size is stored in 72-dpi QuickDraw points; scale to 96-dpi canvas pixels.
function ptsToCanvasSize(wPts, hPts) {
    const s = 96 / 72;
    return { canvasWidth: Math.round(wPts * s), canvasHeight: Math.round(hPts * s) };
}

function readMacDrawCanvas(bytes) {
    // DRW header: int16 BE at 0xA6 = page height in pts, 0xA8 = page width in pts.
    if (bytes.length < 0xAB) return {};
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const hPts = view.getUint16(0xA6, false);
    const wPts = view.getUint16(0xA8, false);
    if (wPts < 10 || hPts < 10) return {};
    return ptsToCanvasSize(wPts, hPts);
}

function readPictCanvas(bytes) {
    // PICT boundrect: picSize(2) + rect(8) starting at hdrSize+0.
    // boundrect right = width, bottom = height, all in 72-dpi pts.
    const hdrSize = isPictVersionAt(bytes, 512) ? 512 : 0;
    if (bytes.length < hdrSize + 10) return {};
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const o = hdrSize + 2; // skip picSize
    const top  = view.getInt16(o,     false);
    const left = view.getInt16(o + 2, false);
    const bot  = view.getInt16(o + 4, false);
    const rgt  = view.getInt16(o + 6, false);
    const wPts = rgt - left, hPts = bot - top;
    if (wPts < 10 || hPts < 10) return {};
    return ptsToCanvasSize(wPts, hPts);
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

function scaleShapes(shapes, s) {
    for (const sh of shapes) {
        if ('x1' in sh) {
            sh.x1 = Math.round(sh.x1 * s); sh.y1 = Math.round(sh.y1 * s);
            sh.x2 = Math.round(sh.x2 * s); sh.y2 = Math.round(sh.y2 * s);
        } else if (sh.type === 'bezier') {
            for (const p of sh.points) {
                p.x   = Math.round(p.x   * s); p.y   = Math.round(p.y   * s);
                p.c1x = Math.round(p.c1x * s); p.c1y = Math.round(p.c1y * s);
                p.c2x = Math.round(p.c2x * s); p.c2y = Math.round(p.c2y * s);
            }
        } else if ('x' in sh) {
            sh.x = Math.round(sh.x * s); sh.y = Math.round(sh.y * s);
            sh.width  = Math.round(sh.width  * s);
            sh.height = Math.round(sh.height * s);
            if ('cornerRadius' in sh) sh.cornerRadius = Math.round(sh.cornerRadius * s);
        }
        if (sh.children) scaleShapes(sh.children, s);
    }
}

// ─── PICT parser ──────────────────────────────────────────────────────────────

function parsePict(buffer, bytes) {
    const headerSize = isPictVersionAt(bytes, 512) ? 512 : 0;
    const shapes = new PictParser(new DataView(buffer), bytes, headerSize).parse();
    return mergeConsecutiveLines(shapes);
}

function mergeConsecutiveLines(shapes) {
    const result = [];
    let i = 0;
    while (i < shapes.length) {
        const s = shapes[i];
        if (s.type !== 'line') { result.push(s); i++; continue; }
        const chain = [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
        let j = i + 1;
        while (j < shapes.length && shapes[j].type === 'line') {
            const t = shapes[j], last = chain[chain.length - 1];
            if (t.x1 === last.x && t.y1 === last.y) { chain.push({ x: t.x2, y: t.y2 }); j++; }
            else break;
        }
        if (chain.length >= 3) {
            const pts = chain.map(p => ({ x: p.x, y: p.y, c1x: p.x, c1y: p.y, c2x: p.x, c2y: p.y }));
            const b = new BezierShape(pts);
            b.strokeWidth = s.strokeWidth;
            b.strokePatternIdx = s.strokePatternIdx;
            b.fillIdx = 0;
            b.debugSource = s.debugSource;
            result.push(b);
            i = j;
        } else { result.push(s); i++; }
    }
    return result;
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
        s.cornerRadius = Math.round(this.ovalSize / 2);
        s.fillIdx = strokeOnly ? 0 : this.fillPat;
        s.strokeWidth = this.penW;
        return s;
    }
    line(a, b) {
        const s = new LineShape(a.x, a.y, b.x, b.y);
        s.strokeWidth = this.penW;
        return s;
    }
    arc(r, startAngle, arcAngle, strokeOnly, usePen) {
        const s = new ArcShape(r.l, r.t, r.r - r.l, r.b - r.t);
        // PICT angles are degrees CW from 12 o'clock; map arc midpoint to our quadrant
        const mid = ((startAngle + arcAngle / 2) % 360 + 360) % 360;
        s.quadrant = Math.min(3, Math.floor(mid / 90));
        s.strokeWidth = this.penW;
        if (strokeOnly) s.fillIdx = 0;
        else if (usePen)  s.fillIdx = this.penPat;
        else              s.fillIdx = this.fillPat;
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
        scaleShapes(this.shapes, 96 / 72);
        return this.shapes;
    }

    runV1() {
        while (this.o < this.b.length) {
            const opOff = this.o;
            const op = this.u8();
            if (op === 0xFF) break;
            const prevLen = this.shapes.length;
            this.op(op);
            for (let i = prevLen; i < this.shapes.length; i++)
                this.shapes[i].debugSource = { format: 'PICT', offset: opOff, opcode: op };
        }
    }

    runV2() {
        while (this.o < this.b.length) {
            this.align();
            const opOff = this.o;
            const op = this.u16();
            if (op === 0x00FF) break;
            const prevLen = this.shapes.length;
            if (op <= 0xFF)  this.op(op);
            else             this.skipReservedV2(op);
            for (let i = prevLen; i < this.shapes.length; i++)
                this.shapes[i].debugSource = { format: 'PICT', offset: opOff, opcode: op };
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
        case 0x30: { // frameRect — PICT expands bbox by floor(penW/2) top/left, floor((penW-1)/2) bottom/right
            const r=this.readRect(); this.lastRect=r;
            const sh=this.rect(r,true);
            if(this.penW>1){const si=Math.floor(this.penW/2);sh.x+=si;sh.y+=si;sh.width-=this.penW-1;sh.height-=this.penW-1;}
            this.shapes.push(sh); break; }
        case 0x31: { const r=this.readRect(); this.lastRect=r;
            const s=this.rect(r,false); s.fillIdx=this.penPat; this.shapes.push(s); break; }
        case 0x32: { this.readRect(); break; }  // eraseRect
        case 0x33: { this.readRect(); break; }  // invertRect
        case 0x34: { const r=this.readRect(); this.lastRect=r;
            const s=this.rect(r,false); s.strokeWidth=0; this.shapes.push(s); break; }
        case 0x38: { // frameSameRect — merge stroke into preceding fill-only rect
            const last=this.shapes[this.shapes.length-1];
            if(last&&last.type==='rectangle'&&last.strokeWidth===0){
                if(this.penW>1){const si=Math.floor(this.penW/2);last.x+=si;last.y+=si;last.width-=this.penW-1;last.height-=this.penW-1;}
                last.strokeWidth=this.penW;last.strokePatternIdx=this.penPat;
            } else if(this.lastRect){this.shapes.push(this.rect(this.lastRect,true));}
            break; }
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
        case 0x48: { // frameSameRRect — apply stroke and inset the preceding fill-only rrect
            // PICT exports filled+stroked shapes by expanding the fillRRect outward by
            // penW/2 on each side so the stroke straddles the true shape boundary.
            // Inset back to get the real shape dimensions; cornerRadius shrinks by the same amount.
            const last = this.shapes[this.shapes.length - 1];
            if (last && last.type === 'roundrect' && last.strokeWidth === 0) {
                const inset = Math.floor(this.penW / 2);
                last.x      += inset;
                last.y      += inset;
                last.width  -= inset * 2;
                last.height -= inset * 2;
                last.cornerRadius  = Math.max(0, Math.floor((this.ovalSize - this.penW) / 2));
                last.strokeWidth   = Math.max(1, this.penW - 2);
                last.strokePatternIdx = this.penPat;
            }
            break;
        }
        case 0x49: case 0x4A: case 0x4B: case 0x4C: break; // same-rrect variants, 0 bytes

        // ── Oval ──
        case 0x50: { const r=this.readRect(); this.lastRect=r; this.shapes.push(this.oval(r,true)); break; }
        case 0x51: { const r=this.readRect(); this.lastRect=r;
            const s=this.oval(r,false); s.fillIdx=this.penPat; this.shapes.push(s); break; }
        case 0x52: { this.readRect(); break; }
        case 0x53: { this.readRect(); break; }
        case 0x54: { const r=this.readRect(); this.lastRect=r;
            const s=this.oval(r,false); s.strokeWidth=0; this.shapes.push(s); break; }
        case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: break; // same-oval, 0 bytes

        // ── Arc ──
        case 0x60: case 0x61: case 0x64: {
            const r = this.readRect(), sa = this.i16(), aa = this.i16();
            this.lastRect = r;
            this.shapes.push(this.arc(r, sa, aa, op === 0x60, op === 0x61));
            break;
        }
        case 0x62: case 0x63: { const r = this.readRect(); this.lastRect = r; this.skip(4); break; }
        case 0x68: case 0x69: case 0x6C: {
            const sa = this.i16(), aa = this.i16();
            if (this.lastRect) this.shapes.push(this.arc(this.lastRect, sa, aa, op === 0x68, op === 0x69));
            break;
        }
        case 0x6A: case 0x6B: this.skip(4); break;

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
        if (draw && pts.length >= 2) {
            const bezPts = pts.map(p => ({ x: p.x, y: p.y, c1x: p.x, c1y: p.y, c2x: p.x, c2y: p.y }));
            // Close open polygon
            const first = pts[0], last = pts[pts.length - 1];
            if (pts.length > 2 && (first.x !== last.x || first.y !== last.y))
                bezPts.push({ x: first.x, y: first.y, c1x: first.x, c1y: first.y, c2x: first.x, c2y: first.y });
            const b = new BezierShape(bezPts);
            b.strokeWidth = this.penW;
            b.strokePatternIdx = this.penPat;
            this.shapes.push(b);
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

    // Diagnostic: dump the first 32 bytes from startOffset

    // Collect all record-start positions (02 03 type flags, type < 0x20).
    // Enforce a minimum gap of 24 bytes (= minimum record size: 4 header + 16 bbox + 4 attr)
    // so that any spurious 02 03 XX inside a record body never shadows the next real record.
    const recs = [];
    // Force-insert startOffset when the record there has a non-standard marker byte
    // (e.g. 0x05 for reshape arcs) that the pattern scanner won't pick up.
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
    console.log('MDraw recs found:', recs.length, 'at offsets', recs.slice(0, 10).map(r => '0x'+r.toString(16)));
    for (let _ri = 0; _ri < Math.min(recs.length, 5); _ri++) {
        const _o = recs[_ri];
        const _len = _ri + 1 < recs.length ? recs[_ri+1] - _o : bytes.length - _o;
        const _d = Array.from({length: Math.min(48, _len)}, (_, k) => bytes[_o+k].toString(16).padStart(2,'0')).join(' ');
        console.log(`  rec[${_ri}] 0x${_o.toString(16)} len=${_len}: ${_d}`);
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
        // Reshape arcs have type=0x02 with strokePat=0x05; exclude them from line min/max.
        const _isLine = bytes[o+2]===0x02 && bytes[o+1]!==0x05;
        // Reshape arcs have marker byte 0x05 instead of 0x03; bbox is still absolute.
        const _isArc = (bytes[o+2]===0x01 || (bytes[o+2]===0x02 && bytes[o+1]===0x05)) && _recLen >= 28;
        if (_isLine) {
            rawBoxes.push({ top: Math.min(_t, _f3), left: Math.min(_l, _f4),
                            bot: Math.max(_t, _f3), rgt: Math.max(_l, _f4) });
        } else if (_isArc) {
            // Arc bbox is stored as absolute (top, left, BOTTOM, RIGHT)
            rawBoxes.push({ top: _t, left: _l, bot: _f3, rgt: _f4 });
        } else {
            rawBoxes.push({ top: _t, left: _l, bot: _f3, rgt: _f4 });
        }
    }

    const pageOffPtX = 0;
    const pageOffPtY = 0;

    // Identify group containers: must be a known group type (0x04 or 0x11) AND bbox
    // must equal the union of 2+ records inside it. Shape types (0x02, 0x03, 0x0F, …)
    // are never containers even if their bbox happens to encompass other records.
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

    // Assign direct children to each group, processing smallest groups first so that
    // nested group containers are claimed before the outer group reaches them.
    const groupChildMap = new Map(); // group_ri → [child_ri, ...]
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
    // MacDraw II groups store children inline. Layout:
    //   [type-block: 0a 00 .. ..] [4 header] [16 bbox] [16 metadata] [count×24 children]
    //   followed by an 8-byte terminator before the next group.
    // The global scanner cannot reliably find all groups: a terminator record between
    // groups sits only 8 bytes before the next group header, which the 24-byte gap
    // rule blocks. So we scan raw bytes for 0x0a markers instead.
    const typedGroupHandled = new Set(); // header byte offsets already emitted

    for (let pos = startOffset - 4; pos + 40 < bytes.length; pos++) {
        if (bytes[pos] !== 0x0a) continue;
        const o = pos + 4; // group header position
        if (o + 36 > bytes.length) continue;
        if (bytes[o] < 0x02 || bytes[o + 1] !== 0x03 || bytes[o + 2] >= 0x20) continue;

        const childCount = (bytes[o + 20] << 8) | bytes[o + 21];
        if (childCount === 0 || childCount > 200) continue;

        const childStart = o + 36; // 4 header + 16 bbox + 16 metadata
        const groupByteEnd = childStart + childCount * 24;
        if (groupByteEnd > bytes.length) continue;

        // Validate ALL children have recognisable headers (not just child 0),
        // to reject false-positive groups where childCount came from arc angle bytes etc.
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
            const hp = childStart + ci * 24 + 4; // +4 to skip 4-byte shape-type block
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

        // Claim all global-scanner records within this group's byte range
        // (including the 8-byte terminator that follows).
        const claimEnd = groupByteEnd + 8;
        for (let j = 0; j < recs.length - 1; j++) {
            if (recs[j] >= pos && recs[j] < claimEnd) claimed.add(j);
        }

        pos = groupByteEnd + 7; // skip to end of terminator; loop will ++pos
    }

    for (let ri = 0; ri < recs.length - 1; ri++) {
        const o = recs[ri];
        if (recs[ri+1] - o < 20 || claimed.has(ri)) continue;
        if (typedGroupHandled.has(o)) continue;
        const shapeTypePre = o >= 4 ? bytes[o - 4] : 0;
        let shape;
        if (groupContainerIdxs.has(ri)) {
            const gcAttr = Array.from({length: 28}, (_, k) => (bytes[o + 20 + k] ?? 0).toString(16).padStart(2, '0')).join(' ');
            console.log(`MDraw GROUP type=0x${bytes[o+2].toString(16).padStart(2,'0')} flags=0x${bytes[o+3].toString(16).padStart(2,'0')} len=${recs[ri+1]-o}  attr[+20..+47]: ${gcAttr}`);
            shape = buildGroup(ri);
        } else if (shapeTypePre === 0x08) {
            // Freehand pencil stroke: header at o contains start point at o+28(y) o+32(x);
            // raw signed-byte (dh,dv) delta pairs follow at o+36, terminated by (0,0).
            shape = parseFreehandStroke(view, bytes, o, scale);
            // Claim all scanner-found records that fall inside the delta stream so
            // they aren't mis-processed as separate shapes.
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
                y = view.getInt16(i + 7,  false) * scale;
                x = view.getInt16(i + 9,  false) * scale;
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

    // Deduplicate by text content (first occurrence — typed inner records — wins)
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

// MacDraw II DRWG format: 512-byte header + 4-byte section marker at 0x200 → records from 0x204.
// Records always start at 0x204 regardless of the marker byte at that position.
function findMacDrawObjects(bytes) {
    const isDRWG = bytes.length >= 0x208 &&
        bytes[0] === 0x44 && bytes[1] === 0x52 && bytes[2] === 0x57 && bytes[3] === 0x47;

    if (isDRWG) {
        const d = Array.from({length: Math.min(20, bytes.length - 0x204)}, (_, k) => bytes[0x204+k].toString(16).padStart(2,'0')).join(' ');
        console.log(`MDraw DRWG file. bytes[0x204..]: ${d}`);
        return 0x204;
    }
    // Non-DRWG fallback scan
    for (let i = 4; i < Math.min(bytes.length - 3, 2048); i++) {
        if (bytes[i] >= 0x02 && bytes[i+1] === 0x03 && bytes[i+2] < 0x20) return i;
    }
    return -1;
}

// Each record: [02][03][type][flags] + 4 × Fixed16.16 bounding rect (top, left, bottom, right)
// Coordinates are 72 DPI page units; scale × (96/72) = × (4/3) to reach canvas pixels.
const SHAPE_TYPE_NAMES = {
    0x02: 'line', 0x03: 'line-rev', 0x04: 'rect', 0x05: 'roundrect',
    0x06: 'ellipse', 0x07: 'arc', 0x08: 'freehand', 0x09: 'polygon/bezier', 0x0a: 'group',
};

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
// Each interior point gets c1/c2 from the centripetal tangent; endpoints use
// one-sided tangents so the curve enters/exits smoothly without overshooting.
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
// Header (36 bytes): [0..3] record header, [4..19] bbox (unused), [20..27] extra,
// [28..31] start-y Fixed16.16 BE, [32..35] start-x Fixed16.16 BE.
// After the header: raw signed-byte (dh, dv) delta pairs, terminated by (0, 0).
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

    // Simplify the dense delta-point cloud, then fit smooth bezier curves.
    // Tolerance 1.5 canvas px keeps visible detail while collapsing runs of
    // nearly-collinear deltas into single cubic segments.
    const simplified = rdpSimplify(raw, 1.5);
    const pts = catmullRomBezier(simplified);

    const s = new BezierShape(pts);
    s.strokeWidth      = Math.max(1, bytes[o] - 1);
    s.strokePatternIdx = bytes[o + 1];
    s.fillIdx          = 0;
    return s;
}
// byte[o+3] — when non-zero selects rect/roundrect class and encodes corner radius.
// 0x00 = standard (dispatch via shapeTypeCode). 0x01–0x06 = rect/roundrect variants:
//   0x01 = square (no rounding), 0x02–0x06 = class/16 inch corner radius.
// Corner oval diameter (pts) = class * 9; visual radius = floor((diam - qdPenW) / 2).
const SHAPE_CLASS_NAMES = {
    0x00: 'standard',
    0x01: 'rect/square',    0x02: 'roundrect(1/8")',  0x03: 'roundrect(3/16")',
    0x04: 'roundrect(1/4")', 0x05: 'roundrect(5/16")', 0x06: 'roundrect(3/8")',
};
// byte[o+2] — fill/draw variant. 0x01=transparent, 0x02=white, 0x03=black, 0x05=grey.
const FILL_MODE_NAMES = {
    0x01: 'transparent', 0x02: 'white', 0x03: 'black', 0x05: 'grey',
};
function readFixed(view, offset) {
    return view.getInt16(offset, false) + view.getUint16(offset + 2, false) / 65536;
}

function parseMacDrawRecord(view, bytes, o, type, flags, scale, pageOffPtX = 0, pageOffPtY = 0, recLen = 24) {
    if (o + 20 > bytes.length) return null;

    const top  = readFixed(view, o + 4);
    const left = readFixed(view, o + 8);
    const h_pt = readFixed(view, o + 12);  // old format: relative height; new format: absolute bottom
    const w_pt = readFixed(view, o + 16);  // old format: relative width;  new format: absolute right

    // The 4 bytes BEFORE the found header (bytes[o-4..o-1]) are the shape-type block:
    //   byte[0]: shape type code — 0x04=rect, 0x05=roundrect, 0x06=ellipse, 0x07=arc,
    //            0x02/0x03=line.  Zero when record is at the very start of the buffer.
    // The "type" param (bytes[o+2]) is the fill variant: 0x01=transparent, 0x02=white,
    //   0x03=black, 0x05=grey.  Map to our fillIdx: 0x01→0, 0x02→1, else use value.
    const shapeTypeCode = o >= 4 ? bytes[o - 4] : 0;
    const fillFromType  = type === 0x01 ? 0 : type === 0x02 ? 1 : type;
    const strokeWidth   = Math.max(1, bytes[o] - 1);
    const strokePat     = bytes[o + 1];
    // False-positive guard: real MacDraw shapes use pen widths 1–8 (bytes[o] 2–9).
    // Values ≥ 25 (strokeWidth ≥ 24) indicate the scanner landed on binary data, not a header.
    if (strokeWidth >= 24) return null;

    // Lines: explicit type byte 0x02, shapeTypeCode not a known 2-D shape type.
    // MacDraw II can store near-integer coordinates as Fixed16.16 values like 0x00fe.ffd8
    // (≈254.9998 pts) rather than the exact 0x00ff.0000. Allow the high byte of each
    // fractional part to be 0x00 (near zero) or 0xff (near one); anything in between
    // indicates a truly sub-pixel free-hand bbox, not a line endpoint.
    // flags byte encodes arrow mode: 0x00=none, 0x01=start, 0x02=end, 0x03=both.
    // bytes[o+1]===0x05 marks reshape arcs, which also use type=0x02 — exclude them.
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

    // Rectangle (shape type 0x04): fill from type byte, size +1 for inclusive right/bottom.
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

    // Polygon / straight bezier (shape type 0x09): point array at o+28 (y,x Fixed16.16 pairs)
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

    // Arc full-oval bboxes can have negative left/top when the visible quadrant starts
    // at the canvas edge (e.g. a Q0 arc at x=0 has full oval left = cx - rx < 0).
    // Reshape arcs (marker=0x05, type=0x02) follow the same absolute-bbox convention.
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
    console.log(`MDraw shapeType=0x${shapeTypeCode.toString(16).padStart(2,'0')}(${SHAPE_TYPE_NAMES[shapeTypeCode] ?? '?'}) class=0x${flags.toString(16).padStart(2,'0')}(${SHAPE_CLASS_NAMES[flags] ?? '?'}) fillMode=0x${type.toString(16).padStart(2,'0')}(${FILL_MODE_NAMES[type] ?? '?'}) (${x},${y}) ${w}×${h}  fill=${fillIdx} pen=${strokeWidth} len=${recLen}  bbox: ${bboxHex}`);

    // class byte 0x01–0x06: rect/roundrect family; fill variant in type byte.
    // qdPenW = bytes[o+0]+1 (DRW stores QD pen width minus one).
    // Oval diameter (pts) = class * 9; visual corner radius = floor((diam - qdPenW) / 2).
    if (flags >= 0x01 && flags <= 0x06) {
        const qdPenW = bytes[o + 0] + 1;
        const ovalDiamPts = flags >= 0x02 ? flags * 9 : 0; // 0x01 = square, no rounding
        const cornerPts = Math.max(0, Math.floor((ovalDiamPts - qdPenW) / 2));
        const s = cornerPts > 0 ? new RoundRectShape(x, y, w, h) : new RectangleShape(x, y, w, h);
        if (cornerPts > 0) s.cornerRadius = Math.round(cornerPts * scale);
        s.fillIdx = fillFromType;
        s.strokeWidth = strokeWidth;
        s.strokePatternIdx = bytes[o + 1];
        return s;
    }
    if (flags !== 0) {
        console.log(`MDraw: unknown class=0x${flags.toString(16).padStart(2,'0')} shapeType=0x${shapeTypeCode.toString(16).padStart(2,'0')}(${SHAPE_TYPE_NAMES[shapeTypeCode] ?? '?'}) fillMode=0x${type.toString(16).padStart(2,'0')}(${FILL_MODE_NAMES[type] ?? '?'}) (${x},${y}) ${w}×${h} — skipped`);
        return null;
    }

    // Arc (shape type 0x07): type byte encodes fill pattern, not shape kind.
    // Must dispatch here so filled arcs don't fall through to wrong shapes in switch.
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
        console.log(`MDraw ARC start=${startAngle} arc=${arcAngle} → Q${quadrant}  (${x},${y}) ${arc_w}×${arc_h} fill=${fillIdx}`);
        const s = new ArcShape(x, y, arc_w, arc_h);
        s.quadrant       = quadrant;
        s.startAngleDeg  = startAngle;
        s.arcAngleDeg    = arcAngle;
        s.fillIdx        = fillIdx;
        s.strokeWidth    = strokeWidth;
        s.strokePatternIdx = strokePat;
        return s;
    }

    // Ellipse (shape type 0x06): type byte only encodes fill variant, not shape class.
    // Must dispatch here so white/grey/black fills don't fall through to rectangle in switch.
    if (shapeTypeCode === 0x06) {
        const s = new EllipseShape(x, y, w + 1, h + 1);
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth; s.strokePatternIdx = strokePat;
        return s;
    }

    switch (type) {
    case 0x01: { // ARC (28 bytes: bbox=absolute, angles at o+20/22) or OVAL (24 bytes)
        if (recLen >= 28 && o + 28 <= bytes.length) {
            // Arc bbox is stored as absolute (top, left, BOTTOM, RIGHT) — compute from that
            const arc_w = Math.round((w_pt - left) * scale) + 1;
            const arc_h = Math.round((h_pt - top)  * scale) + 1;
            if (arc_w <= 0 || arc_h <= 0) return null;
            const startAngle = view.getInt16(o + 20, false);
            const arcAngle   = view.getInt16(o + 22, false);
            const mid = ((startAngle + arcAngle / 2) % 360 + 360) % 360;
            const quadrant = Math.min(3, Math.floor(mid / 90));
            console.log(`MDraw ARC start=${startAngle} arc=${arcAngle} → Q${quadrant}  (${x},${y}) ${arc_w}×${arc_h}`);
            const s = new ArcShape(x, y, arc_w, arc_h);
            s.quadrant = quadrant;
            s.fillIdx = 0; // frame arc — stroke only
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
        // Reshape arc: same 28-byte absolute-bbox format as standard arcs,
        // but marker byte is 0x05 instead of 0x03.
        if (bytes[o + 1] === 0x05 && recLen >= 28 && o + 28 <= bytes.length) {
            const arc_w = Math.round((w_pt - left) * scale) + 1;
            const arc_h = Math.round((h_pt - top)  * scale) + 1;
            if (arc_w <= 0 || arc_h <= 0) return null;
            const startAngleDeg = view.getInt16(o + 20, false);
            const arcAngleDeg   = view.getInt16(o + 22, false);
            const mid = ((startAngleDeg + arcAngleDeg / 2) % 360 + 360) % 360;
            const quadrant = Math.min(3, Math.floor(mid / 90));
            const reshapeFill   = bytes[o + 24] ?? 0;
            const reshapeStroke = bytes[o + 1]; // marker byte doubles as pen pattern index
            console.log(`MDraw RESHAPE ARC start=${startAngleDeg} arc=${arcAngleDeg} → Q${quadrant} (${x},${y}) ${arc_w}×${arc_h} fill=${reshapeFill} strokePat=${reshapeStroke}`);
            const s = new ArcShape(x, y, arc_w, arc_h);
            s.quadrant = quadrant;
            s.startAngleDeg = startAngleDeg;
            s.arcAngleDeg   = arcAngleDeg;
            // MacDraw fill 0 = white pattern (QD pattern 0 = no ink = paper = white);
            // our index 0 is transparent, index 1 is white — so offset by 1.
            s.fillIdx        = reshapeFill + 1;
            s.strokePatternIdx = reshapeStroke; // 0x05 → patterns[5] = 'grå' (50% grey)
            s.strokeWidth    = strokeWidth;
            return s;
        }
        const s = new RectangleShape(x, y, w, h);
        s.fillIdx = fillIdx;
        s.strokeWidth = strokeWidth;
        return s;
    }
    case 0x03: { // ROUND RECT (flags=0x00 old encoding)
        const s = new RoundRectShape(x, y, w, h);
        s.cornerRadius = 10;
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth;
        return s;
    }
    case 0x05: { // OVAL variant (solid/filled oval in some MacDraw II files)
        const s = new EllipseShape(x, y, w, h);
        s.fillIdx = fillIdx; s.strokeWidth = strokeWidth;
        return s;
    }
    default:
        console.log(`MDraw: unknown fillMode=0x${type.toString(16).padStart(2,'0')}(${FILL_MODE_NAMES[type] ?? '?'}) — skipped`);
        return null;
    }
}
