import { RectangleShape, EllipseShape, LineShape, BezierShape, RoundRectShape, ArcShape } from './shapes.js';
import { QD_PATTERNS } from './patterns.js';

// ─── PICT version probe (also used by import.js for canvas-size detection) ────

/**
 * Probes a byte array to determine whether a valid PICT header exists at the
 * given offset. Checks for both PICT v1 (opcode 0x11 0x01) and PICT v2
 * (opcode 0x00 0x11 0x02 0xFF) version markers.
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @param {number} headerSize - Byte offset at which the PICT data begins
 *   (typically 0 or 512 for the Mac 512-byte resource fork header).
 * @returns {boolean} True if a recognised PICT version marker is found.
 */
export function isPictVersionAt(bytes, headerSize) {
    const o = headerSize + 2 + 8; // skip picSize(2) + boundrect(8)
    if (bytes.length < o + 4) return false;
    if (bytes[o] === 0x11 && bytes[o+1] === 0x01) return true;            // PICT v1
    if (bytes[o] === 0x00 && bytes[o+1] === 0x11 &&
        bytes[o+2] === 0x02 && bytes[o+3] === 0xFF) return true;          // PICT v2
    return false;
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

/**
 * Maps an 8-row QuickDraw pattern (one byte per row) to the nearest index in
 * the application's QD_PATTERNS palette. Tries an exact match first; falls
 * back to a density-based bucket (empty → sparse → medium → dense → solid).
 *
 * @param {number[]} rows - Eight bytes representing the 8×8 pattern bitmap.
 * @returns {number} Index into QD_PATTERNS (1-based; 0 means no fill).
 */
function matchPattern(rows) {
    for (let i = 1; i < QD_PATTERNS.length; i++) {
        const p = QD_PATTERNS[i];
        if (p.rows && rows.every((b, j) => b === p.rows[j])) return i;
    }
    const bits = rows.reduce((s, b) => s + popcount(b), 0);
    if (bits === 0)  return 1;
    if (bits <= 10)  return 2;
    if (bits <= 32)  return 3;
    if (bits <= 54)  return 4;
    return 5;
}

/**
 * Counts the number of set bits (population count) in a 32-bit integer.
 *
 * @param {number} n - The integer to count bits in.
 * @returns {number} Number of 1-bits in n.
 */
function popcount(n) {
    let c = 0; while (n) { c += n & 1; n >>>= 1; } return c;
}

/**
 * Scales all coordinate values of the given shapes by a uniform factor.
 * Handles line shapes (x1/y1/x2/y2), bezier shapes (point + control-point
 * pairs), and box-like shapes (x/y/width/height, and optional cornerRadius).
 * Recurses into any shape's children array.
 *
 * @param {object[]} shapes - Array of shape objects to scale in-place.
 * @param {number} s - Scale factor to apply (e.g. 96/72 to convert 72 dpi to
 *   96 dpi screen pixels).
 */
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

/**
 * Post-processes the shape list by merging runs of adjacent LineShapes that
 * share the same endpoint, stroke width, and stroke pattern into a single
 * BezierShape polyline. Runs of fewer than three points are left as
 * individual lines. Non-line shapes pass through unchanged.
 *
 * @param {object[]} shapes - Flat array of parsed shapes.
 * @returns {object[]} New array with eligible line runs collapsed into
 *   BezierShapes.
 */
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
            if (t.x1 === last.x && t.y1 === last.y &&
                t.strokeWidth === s.strokeWidth && t.strokePatternIdx === s.strokePatternIdx) {
                chain.push({ x: t.x2, y: t.y2 }); j++;
            } else break;
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

// ─── PICT parser ──────────────────────────────────────────────────────────────

class PictParser {
    /**
     * Creates a new PictParser for a single PICT resource.
     *
     * @param {DataView} view - DataView wrapping the underlying ArrayBuffer,
     *   used for typed integer reads.
     * @param {Uint8Array} bytes - Raw byte array of the same buffer, used for
     *   direct index access.
     * @param {number} hdr - Byte offset at which actual PICT data begins
     *   (0 or 512 depending on whether a Mac resource-fork header is present).
     */
    constructor(view, bytes, hdr) {
        this.v = view; this.b = bytes; this.o = hdr;
        this.shapes = [];
        this.penW    = 1;
        this.penPat  = 3;  // svart (solid black)
        this.fillPat = 0;  // no fill
        this.ovalSize = 10; // corner radius for rounded rects
        this.lastRect = null;
        this.lastPt   = { x: 0, y: 0 };
        this.isV2 = false;
    }

    /** Reads an unsigned 8-bit integer and advances the cursor by 1. @returns {number} */
    u8()    { return this.b[this.o++]; }
    /** Reads a signed 8-bit integer and advances the cursor by 1. @returns {number} */
    i8()    { const v = this.v.getInt8(this.o++); return v; }
    /** Reads an unsigned 16-bit big-endian integer and advances the cursor by 2. @returns {number} */
    u16()   { const v = this.v.getUint16(this.o, false); this.o += 2; return v; }
    /** Reads a signed 16-bit big-endian integer and advances the cursor by 2. @returns {number} */
    i16()   { const v = this.v.getInt16(this.o, false);  this.o += 2; return v; }
    /** Advances the cursor by n bytes without reading. @param {number} n */
    skip(n) { this.o += n; }
    /** Advances the cursor to the next even byte boundary (word-aligns for PICT v2). */
    align() { if (this.o & 1) this.o++; }

    /**
     * Reads a QuickDraw Rect structure (top, left, bottom, right — each a
     * signed 16-bit integer, 8 bytes total) and advances the cursor.
     *
     * @returns {{ t: number, l: number, b: number, r: number }}
     */
    readRect()  {
        const t=this.i16(), l=this.i16(), b=this.i16(), r=this.i16();
        return { t, l, b, r };
    }
    /** Reads a QuickDraw Point (v then h, each a signed 16-bit integer, 4 bytes) and returns {x, y}. @returns {{ x: number, y: number }} */
    readPt()    { const y=this.i16(), x=this.i16(); return { x, y }; }
    /** Reads an 8-byte QuickDraw Pattern (one byte per row of an 8×8 bitmap) and returns the row array. @returns {number[]} */
    readPat()   { const rows=[]; for(let i=0;i<8;i++) rows.push(this.u8()); return rows; }

    // Shape constructors

    /**
     * Creates a RectangleShape from a QuickDraw Rect, applying the current pen
     * width and fill/stroke pattern state.
     *
     * @param {{ t: number, l: number, b: number, r: number }} r - Bounding rect.
     * @param {boolean} strokeOnly - When true the fill index is forced to 0
     *   (frame operations); when false the current fillPat is used.
     * @returns {RectangleShape}
     */
    rect(r, strokeOnly) {
        const s = new RectangleShape(r.l, r.t, r.r-r.l, r.b-r.t);
        s.fillIdx = strokeOnly ? 0 : this.fillPat;
        s.strokeWidth = this.penW;
        s.strokePatternIdx = this.penPat;
        return s;
    }
    /**
     * Creates an EllipseShape from a QuickDraw Rect, applying the current pen
     * width and fill/stroke pattern state.
     *
     * @param {{ t: number, l: number, b: number, r: number }} r - Bounding rect.
     * @param {boolean} strokeOnly - When true the fill index is forced to 0.
     * @returns {EllipseShape}
     */
    oval(r, strokeOnly) {
        const s = new EllipseShape(r.l, r.t, r.r-r.l, r.b-r.t);
        s.fillIdx = strokeOnly ? 0 : this.fillPat;
        s.strokeWidth = this.penW;
        s.strokePatternIdx = this.penPat;
        return s;
    }
    /**
     * Creates a RoundRectShape from a QuickDraw Rect. The corner radius is
     * derived from the current ovalSize state (set by the OvSize opcode 0x0B).
     *
     * @param {{ t: number, l: number, b: number, r: number }} r - Bounding rect.
     * @param {boolean} strokeOnly - When true the fill index is forced to 0.
     * @returns {RoundRectShape}
     */
    rrect(r, strokeOnly) {
        const s = new RoundRectShape(r.l, r.t, r.r-r.l, r.b-r.t);
        s.cornerRadius = Math.round(this.ovalSize / 2);
        s.fillIdx = strokeOnly ? 0 : this.fillPat;
        s.strokeWidth = this.penW;
        s.strokePatternIdx = this.penPat;
        return s;
    }
    /**
     * Creates a LineShape between two points, applying the current pen width
     * and stroke pattern state.
     *
     * @param {{ x: number, y: number }} a - Start point.
     * @param {{ x: number, y: number }} b - End point.
     * @returns {LineShape}
     */
    line(a, b) {
        const s = new LineShape(a.x, a.y, b.x, b.y);
        s.strokeWidth = this.penW;
        s.strokePatternIdx = this.penPat;
        return s;
    }
    /**
     * Creates an ArcShape from a QuickDraw Rect and angle parameters. The
     * quadrant field is derived from the midpoint of the arc sweep so the
     * renderer can pick the correct quarter-ellipse.
     *
     * @param {{ t: number, l: number, b: number, r: number }} r - Bounding rect.
     * @param {number} startAngle - Start angle in degrees (QuickDraw convention:
     *   0 = 12 o'clock, clockwise).
     * @param {number} arcAngle - Sweep angle in degrees (positive = clockwise).
     * @param {boolean} strokeOnly - When true forces fill index to 0 (frame arc).
     * @param {boolean} usePen - When true uses penPat as fill (paint arc);
     *   otherwise uses fillPat (fill arc).
     * @returns {ArcShape}
     */
    arc(r, startAngle, arcAngle, strokeOnly, usePen) {
        const s = new ArcShape(r.l, r.t, r.r - r.l, r.b - r.t);
        const mid = ((startAngle + arcAngle / 2) % 360 + 360) % 360;
        s.quadrant = Math.min(3, Math.floor(mid / 90));
        s.strokeWidth = this.penW;
        if (strokeOnly) s.fillIdx = 0;
        else if (usePen)  s.fillIdx = this.penPat;
        else              s.fillIdx = this.fillPat;
        return s;
    }

    /**
     * Entry point for parsing a PICT resource. Reads the picture header, detects
     * PICT v1 or v2, dispatches to the appropriate opcode loop, and finally
     * scales all produced shapes from 72 dpi to 96 dpi screen coordinates.
     *
     * @returns {object[]} Array of shape objects ready for rendering.
     */
    parse() {
        this.skip(2 + 8); // picSize + boundrect

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

    /**
     * Main opcode dispatch loop for PICT version 1. Reads one-byte opcodes
     * until the end-of-picture marker (0xFF) or end of data is reached.
     * Attaches a debugSource record to every shape produced by each opcode.
     */
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

    /**
     * Main opcode dispatch loop for PICT version 2. Word-aligns before each
     * opcode, reads two-byte opcodes until the end-of-picture marker (0x00FF),
     * and delegates known opcodes (≤ 0xFF) to op() or skips reserved v2 opcodes.
     * Attaches a debugSource record to every shape produced by each opcode.
     */
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

    /**
     * Handles a single QuickDraw opcode. Updates parser state (pen size,
     * patterns, oval size, current point/rect) and emits shapes for drawing
     * opcodes. Unrecognised or unsupported opcodes are silently ignored.
     *
     * @param {number} op - The opcode byte value (0x00 – 0xFF).
     */
    op(op) {
        switch (op) {
        case 0x00: break; // NOP
        case 0x01: { const n=this.u16(); this.skip(n-2); break; } // Clip
        case 0x02: this.skip(8); break;  // BkPat
        case 0x03: this.skip(2); break;  // TxFont
        case 0x04: this.u8();   break;   // TxFace (1-byte Style)
        case 0x05: this.skip(2); break;  // TxMode
        case 0x06: this.skip(4); break;  // SpExtra
        case 0x07: {                     // PnSize: Point = (v, h)
            const _v=this.i16(), w=this.i16();
            this.penW = Math.max(1, w);
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

        default: break;
        }
    }

    /**
     * Reads a QuickDraw Polygon record (opcodes 0x70–0x74 and 0x78–0x7C) and,
     * for frame/paint operations, converts the vertex list to a closed
     * BezierShape polyline. The polygon size field encodes the total byte
     * length of the record including the size word itself.
     *
     * @param {number} op - The opcode byte that triggered this read. Determines
     *   whether the polygon should be drawn (frame/paint) or only consumed from
     *   the stream (erase/invert/fill).
     */
    readPoly(op) {
        const size = this.u16();
        this.readRect(); // bounding rect (8 bytes, consumed)
        const nPts = (size - 10) / 4;
        const pts = [];
        for (let i = 0; i < nPts; i++) pts.push(this.readPt());

        const draw = (op & 0xF8) === 0x70 || (op & 0xF8) === 0x78;
        if (draw && pts.length >= 2) {
            const bezPts = pts.map(p => ({ x: p.x, y: p.y, c1x: p.x, c1y: p.y, c2x: p.x, c2y: p.y }));
            const first = pts[0], last = pts[pts.length - 1];
            if (pts.length > 2 && (first.x !== last.x || first.y !== last.y))
                bezPts.push({ x: first.x, y: first.y, c1x: first.x, c1y: first.y, c2x: first.x, c2y: first.y });
            const b = new BezierShape(bezPts);
            b.strokeWidth = this.penW;
            b.strokePatternIdx = this.penPat;
            this.shapes.push(b);
        }
    }

    /**
     * Skips a BitsRect or BitsRgn bitmap record (opcodes 0x90 / 0x91). The
     * record contains an uncompressed bitmap; we advance past it without
     * rendering because pixel bitmaps are not supported.
     *
     * @param {boolean} withRegion - True for opcode 0x91 (BitsRgn), which
     *   includes an additional clip-region payload after the transfer mode.
     */
    skipBitsRect(withRegion) {
        const rRaw = this.u16(), rowBytes = rRaw & 0x7FFF, isPixmap = !!(rRaw & 0x8000);
        const bds = this.readRect(), height = Math.max(0, bds.b - bds.t);
        if (isPixmap) { this.skip(36); this.skipColorTable(); }
        this.skip(8 + 8 + 2); // srcRect + dstRect + mode
        if (withRegion) { const n=this.u16(); this.skip(n-2); }
        this.skip(height * rowBytes);
    }

    /**
     * Skips a PackBitsRect or PackBitsRgn compressed bitmap record (opcodes
     * 0x98 / 0x99). Row data is PackBits-compressed; each row is preceded by
     * a 1- or 2-byte length field depending on rowBytes. We skip the bytes
     * without decoding.
     *
     * @param {boolean} withRegion - True for opcode 0x99 (PackBitsRgn), which
     *   includes an additional clip-region payload after the transfer mode.
     */
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

    /**
     * Skips a DirectBitsRect or DirectBitsRgn 32-bit direct-colour bitmap
     * record (opcodes 0x9A / 0x9B). Always includes a PixMap and colour table.
     * Row data is compressed; each row is preceded by a 1- or 2-byte length
     * field depending on rowBytes.
     *
     * @param {boolean} withRegion - True for opcode 0x9B (DirectBitsRgn),
     *   which includes an additional clip-region payload after the transfer mode.
     */
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

    /**
     * Skips a QuickDraw ColorTable structure. The table consists of a 4-byte
     * seed, a 2-byte flags field, a 2-byte count-minus-one, and then
     * (count) entries of 8 bytes each (a 2-byte value index plus a 6-byte
     * RGBColor).
     */
    skipColorTable() {
        this.skip(4 + 2); // ctSeed + ctFlags
        const ctSize = this.u16(); // count - 1
        this.skip((ctSize + 1) * 8); // value(2) + RGBColor(6) each
    }

    /**
     * Skips an unrecognised PICT v2 reserved opcode. For opcodes in the range
     * 0x0100–0x7FFF the data length is encoded in the opcode value itself
     * (bits 7–21 give the word count); opcodes below 0x0100 have no data.
     *
     * @param {number} op - The 16-bit opcode that was not handled by op().
     */
    skipReservedV2(op) {
        const dataLen = (op >= 0x0100) ? ((op >>> 7) & 0xFFFE) : 0;
        this.skip(dataLen);
    }
}

/**
 * Parses a PICT resource and returns a flat array of drawable shapes.
 * Auto-detects whether the file has a 512-byte Mac resource-fork header,
 * runs the appropriate PICT v1 or v2 opcode loop, and merges consecutive
 * collinear lines into polylines for cleaner rendering.
 *
 * @param {ArrayBuffer} buffer - The raw PICT file data as an ArrayBuffer.
 * @param {Uint8Array} bytes - A Uint8Array view of the same buffer.
 * @returns {object[]} Array of shape objects (RectangleShape, EllipseShape,
 *   LineShape, BezierShape, RoundRectShape, ArcShape, etc.) scaled to 96 dpi.
 */
export function parsePict(buffer, bytes) {
    const headerSize = isPictVersionAt(bytes, 512) ? 512 : 0;
    const shapes = new PictParser(new DataView(buffer), bytes, headerSize).parse();
    return mergeConsecutiveLines(shapes);
}
