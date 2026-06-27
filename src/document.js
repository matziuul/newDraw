import {
    RectangleShape, EllipseShape, LineShape, BezierShape,
    RoundRectShape, ArcShape, GroupShape, TextShape, seedUid,
} from './shapes.js';

const FORMAT_VERSION = 1;

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Converts a shape object into a plain JSON-serializable object.
 * Each shape type includes only the properties it needs; unknown types throw.
 * @param {object} shape - A shape instance (RectangleShape, LineShape, etc.).
 * @returns {object} Plain data object suitable for JSON serialization.
 */
function serializeShape(shape) {
    const base = { type: shape.type, id: shape.id, locked: shape.locked ?? false };
    switch (shape.type) {
        case 'rectangle':
        case 'ellipse':
            return { ...base,
                x: shape.x, y: shape.y, width: shape.width, height: shape.height,
                fillIdx: shape.fillIdx, strokeWidth: shape.strokeWidth,
                strokeDash: shape.strokeDash, strokePatternIdx: shape.strokePatternIdx,
                fillColor: shape.fillColor ?? null, strokeColor: shape.strokeColor ?? null };
        case 'roundrect':
            return { ...base,
                x: shape.x, y: shape.y, width: shape.width, height: shape.height,
                cornerRadius: shape.cornerRadius,
                fillIdx: shape.fillIdx, strokeWidth: shape.strokeWidth,
                strokeDash: shape.strokeDash, strokePatternIdx: shape.strokePatternIdx,
                fillColor: shape.fillColor ?? null, strokeColor: shape.strokeColor ?? null };
        case 'line':
            return { ...base,
                x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2,
                fillIdx: shape.fillIdx, strokeWidth: shape.strokeWidth,
                strokeDash: shape.strokeDash, strokePatternIdx: shape.strokePatternIdx,
                arrowMode: shape.arrowMode,
                fillColor: shape.fillColor ?? null, strokeColor: shape.strokeColor ?? null };
        case 'bezier':
            return { ...base,
                points: shape.points.map(p => ({ ...p })),
                fillIdx: shape.fillIdx, strokeWidth: shape.strokeWidth,
                strokeDash: shape.strokeDash, strokePatternIdx: shape.strokePatternIdx,
                arrowMode: shape.arrowMode,
                fillColor: shape.fillColor ?? null, strokeColor: shape.strokeColor ?? null };
        case 'arc':
            return { ...base,
                x: shape.x, y: shape.y, width: shape.width, height: shape.height,
                quadrant: shape.quadrant,
                startAngleDeg: shape.startAngleDeg, arcAngleDeg: shape.arcAngleDeg,
                fillIdx: shape.fillIdx, strokeWidth: shape.strokeWidth,
                strokeDash: shape.strokeDash, strokePatternIdx: shape.strokePatternIdx,
                fillColor: shape.fillColor ?? null, strokeColor: shape.strokeColor ?? null };
        case 'group':
            return { ...base, children: shape.children.map(serializeShape) };
        case 'text':
            return { ...base,
                x: shape.x, y: shape.y, text: shape.text,
                fontFamily: shape.fontFamily, fontSize: shape.fontSize,
                fontStyle: shape.fontStyle,
                fillIdx: shape.fillIdx, strokeWidth: shape.strokeWidth };
        default:
            throw new Error(`Unknown shape type: ${shape.type}`);
    }
}

// ── Deserialization ───────────────────────────────────────────────────────────

/**
 * Reconstructs a shape instance from a serialized plain data object.
 * Applies defaults for any optional fields that may be absent in older documents.
 * @param {object} data - Plain data object as produced by {@link serializeShape}.
 * @returns {object} A fully initialized shape instance.
 */
function deserializeShape(data) {
    let shape;
    switch (data.type) {
        case 'rectangle':
            shape = new RectangleShape(data.x, data.y, data.width, data.height);
            break;
        case 'ellipse':
            shape = new EllipseShape(data.x, data.y, data.width, data.height);
            break;
        case 'roundrect':
            shape = new RoundRectShape(data.x, data.y, data.width, data.height);
            shape.cornerRadius = data.cornerRadius ?? 10;
            break;
        case 'line':
            shape = new LineShape(data.x1, data.y1, data.x2, data.y2);
            shape.arrowMode = data.arrowMode ?? 0;
            break;
        case 'bezier':
            shape = new BezierShape(data.points.map(p => ({ ...p })));
            shape.arrowMode = data.arrowMode ?? 0;
            break;
        case 'arc':
            shape = new ArcShape(data.x, data.y, data.width, data.height);
            shape.quadrant = data.quadrant ?? 1;
            if (data.startAngleDeg !== undefined) shape.startAngleDeg = data.startAngleDeg;
            if (data.arcAngleDeg   !== undefined) shape.arcAngleDeg   = data.arcAngleDeg;
            break;
        case 'group':
            shape = new GroupShape(data.children.map(deserializeShape));
            break;
        case 'text':
            shape = new TextShape(
                data.x, data.y, data.text ?? '',
                data.fontFamily ?? 'Geneva', data.fontSize ?? 12, data.fontStyle ?? 0,
            );
            break;
        default:
            throw new Error(`Unknown shape type: ${data.type}`);
    }

    shape.id = data.id;
    shape.locked = data.locked ?? false;

    if (data.type !== 'group') {
        shape.fillIdx = data.fillIdx ?? 0;
        shape.strokeWidth = data.strokeWidth ?? (data.type === 'text' ? 0 : 2);
        if (data.type !== 'text') {
            shape.strokeDash = data.strokeDash ?? 0;
            shape.strokePatternIdx = data.strokePatternIdx ?? 3;
            if (data.fillColor)   shape.fillColor   = data.fillColor;
            if (data.strokeColor) shape.strokeColor = data.strokeColor;
        }
    }

    return shape;
}

/**
 * Recursively collects all shape IDs, including those nested inside groups.
 * Used to determine the highest existing ID so the UID generator can be seeded correctly.
 * @param {object} shape - A shape instance, possibly of type 'group'.
 * @returns {number[]} Flat array of all IDs reachable from this shape.
 */
function collectIds(shape) {
    if (shape.type === 'group') return [shape.id, ...shape.children.flatMap(collectIds)];
    return [shape.id];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Serializes the current drawing to a `.mcd` JSON file and triggers a browser download.
 * @param {object[]} shapes - Array of shape instances to save.
 * @param {number} canvasWidth - Logical canvas width in pixels.
 * @param {number} canvasHeight - Logical canvas height in pixels.
 * @param {string} [filename='drawing.mcd'] - Name for the downloaded file.
 */
export function saveDocument(shapes, canvasWidth, canvasHeight, filename = 'drawing.mcd') {
    const doc = {
        version: FORMAT_VERSION,
        canvasWidth,
        canvasHeight,
        shapes: shapes.map(serializeShape),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Parses a `.mcd` file buffer and returns the reconstructed drawing state.
 * Validates the format version and re-seeds the UID generator to avoid ID collisions.
 * @param {ArrayBuffer} buffer - Raw file contents as returned by the FileReader API.
 * @returns {{ shapes: object[], canvasWidth: number, canvasHeight: number }} Restored drawing state.
 * @throws {Error} If the buffer is not a valid MacDraw document or uses an unsupported version.
 */
export function loadDocument(buffer) {
    const text = new TextDecoder().decode(buffer);
    const data = JSON.parse(text);
    if (typeof data.version !== 'number') throw new Error('Not a MacDraw document');
    if (data.version !== FORMAT_VERSION)  throw new Error(`Unsupported version: ${data.version}`);
    const shapes = (data.shapes ?? []).map(deserializeShape);
    const maxId = Math.max(0, ...shapes.flatMap(collectIds).filter(Number.isFinite));
    seedUid(maxId);
    return { shapes, canvasWidth: data.canvasWidth, canvasHeight: data.canvasHeight };
}
