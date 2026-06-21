import { parsePict, isPictVersionAt } from './pict-parser.js';
import { parseMacDraw } from './drw-parser.js';

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

// ─── Canvas size ──────────────────────────────────────────────────────────────

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
    for (const hdr of [512, 0]) {
        if (isPictVersionAt(bytes, hdr)) return 'pict';
    }
    if (isMacDrawHeader(bytes)) return 'macdraw';
    return 'unknown';
}

function isMacDrawHeader(bytes) {
    if (bytes.length < 4) return false;
    if (bytes[0]===0x44&&bytes[1]===0x52&&bytes[2]===0x57&&bytes[3]===0x47) return true; // 'DRWG'
    const v = (bytes[0] << 8) | bytes[1];
    if (v === 0x0000 || v === 0x0100 || v === 0x0200 || v === 0x0300) return true;
    return false;
}
