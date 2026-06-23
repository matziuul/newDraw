import { parsePict, isPictVersionAt } from './pict-parser.js';
import { parseMacDraw } from './drw-parser.js';

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Parses a raw file buffer as either a PICT or MacDraw II document and returns
 * the resulting shapes together with canvas dimensions and a format label.
 * Throws if the buffer does not match any recognised format.
 *
 * @param {ArrayBuffer} buffer - Raw bytes of the file to import.
 * @returns {{ shapes: object[], format: string, canvasWidth?: number, canvasHeight?: number }}
 */
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

/**
 * Converts QuickDraw point dimensions (72 dpi) to canvas pixel dimensions (96 dpi).
 *
 * @param {number} wPts - Width in 72-dpi points.
 * @param {number} hPts - Height in 72-dpi points.
 * @returns {{ canvasWidth: number, canvasHeight: number }}
 */
function ptsToCanvasSize(wPts, hPts) {
    const s = 96 / 72;
    return { canvasWidth: Math.round(wPts * s), canvasHeight: Math.round(hPts * s) };
}

/**
 * Reads the page dimensions from a MacDraw II (.drw) file header.
 * Returns an empty object if the header is too short or dimensions are invalid.
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @returns {{ canvasWidth?: number, canvasHeight?: number }}
 */
function readMacDrawCanvas(bytes) {
    // DRW header: int16 BE at 0xA6 = page height in pts, 0xA8 = page width in pts.
    if (bytes.length < 0xAB) return {};
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const hPts = view.getUint16(0xA6, false);
    const wPts = view.getUint16(0xA8, false);
    if (wPts < 10 || hPts < 10) return {};
    return ptsToCanvasSize(wPts, hPts);
}

/**
 * Reads the bounding rectangle from a PICT file header to determine canvas size.
 * Handles both bare PICT (no header) and PICT files with a 512-byte resource fork header.
 * Returns an empty object if the file is too short or dimensions are invalid.
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @returns {{ canvasWidth?: number, canvasHeight?: number }}
 */
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

/**
 * Detects whether a file is a PICT, MacDraw II, or unknown format by inspecting
 * magic bytes at known header offsets.
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @returns {'pict' | 'macdraw' | 'unknown'}
 */
function detectFormat(bytes) {
    for (const hdr of [512, 0]) {
        if (isPictVersionAt(bytes, hdr)) return 'pict';
    }
    if (isMacDrawHeader(bytes)) return 'macdraw';
    return 'unknown';
}

/**
 * Returns true if the file starts with a recognised MacDraw II header signature.
 * Accepts the 'DRWG' four-byte magic or the legacy version-word values 0x0000–0x0300.
 *
 * @param {Uint8Array} bytes - Raw file bytes.
 * @returns {boolean}
 */
function isMacDrawHeader(bytes) {
    if (bytes.length < 4) return false;
    if (bytes[0]===0x44&&bytes[1]===0x52&&bytes[2]===0x57&&bytes[3]===0x47) return true; // 'DRWG'
    const v = (bytes[0] << 8) | bytes[1];
    return v === 0x0000 || v === 0x0100 || v === 0x0200 || v === 0x0300;

}
