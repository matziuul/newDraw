import { QD_PATTERNS, buildPattern } from './patterns.js';
import { normalize, STROKE_DASHES, ARROW_MODES } from './shapes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively flattens a shape tree into a single array of leaf shapes,
 * expanding any groups into their children.
 * @param {object[]} shapes - Array of shapes, which may include groups.
 * @returns {object[]} Flat array containing only non-group shapes.
 */
function flattenShapes(shapes) {
    const out = [];
    for (const s of shapes) {
        if (s.type === 'group') out.push(...flattenShapes(s.children));
        else out.push(s);
    }
    return out;
}

/**
 * Rasterizes all pattern-filled shapes onto an off-screen canvas and returns the result as a PNG data URL.
 * This is necessary because SVG cannot natively express arbitrary 8×8 bit-pattern fills.
 * @param {object[]} shapes - Flat array of leaf shapes to render fills for.
 * @param {number} width - Canvas width in pixels.
 * @param {number} height - Canvas height in pixels.
 * @returns {string} A `data:image/png;base64,…` URL representing the composited fill layer.
 */
function buildFillsImage(shapes, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const patterns = QD_PATTERNS.map(p => p.rows ? buildPattern(ctx, p.rows) : null);

    for (const shape of shapes) {
        const pat = patterns[shape.fillIdx];
        if (pat === null) continue;

        ctx.fillStyle = pat;
        if (shape.type === 'rectangle') {
            const { x, y, width: w, height: h } = normalize(shape.x, shape.y, shape.width, shape.height);
            ctx.fillRect(x, y, w, h);
        } else if (shape.type === 'roundrect') {
            const { x, y, width: w, height: h } = normalize(shape.x, shape.y, shape.width, shape.height);
            const r = Math.min(shape.cornerRadius ?? 10, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);       ctx.arcTo(x + w, y,     x + w, y + r,     r);
            ctx.lineTo(x + w, y + h - r);   ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h);       ctx.arcTo(x,     y + h, x,     y + h - r, r);
            ctx.lineTo(x, y + r);           ctx.arcTo(x,     y,     x + r, y,         r);
            ctx.closePath(); ctx.fill();
        } else if (shape.type === 'ellipse') {
            const { x, y, width: w, height: h } = normalize(shape.x, shape.y, shape.width, shape.height);
            ctx.beginPath();
            ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (shape.type === 'arc') {
            const { x, y, width: w, height: h } = normalize(shape.x, shape.y, shape.width, shape.height);
            const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            switch (shape.quadrant ?? 1) {
                case 0: ctx.ellipse(cx,cy,rx,ry,0,-Math.PI/2,  0,         false); break;
                case 1: ctx.ellipse(cx,cy,rx,ry,0, 0,          Math.PI/2, false); break;
                case 2: ctx.ellipse(cx,cy,rx,ry,0, Math.PI/2,  Math.PI,   false); break;
                case 3: ctx.ellipse(cx,cy,rx,ry,0, 3*Math.PI/2,Math.PI,   true ); break;
            }
            ctx.closePath(); ctx.fill();
        }
    }

    return canvas.toDataURL('image/png');
}

/**
 * Renders a single 8×8 QuickDraw bit-pattern tile to a PNG data URL for use as an SVG `<pattern>` image.
 * Set bits are drawn black; clear bits are drawn white.
 * @param {number[]} rows - Array of 8 bytes, one per row, where each bit represents a pixel (MSB = leftmost).
 * @returns {string} A `data:image/png;base64,…` URL of the 8×8 tile.
 */
function patternTileDataUrl(rows) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(8, 8);
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const on = rows[y] & (1 << (7 - x));
            const i = (y * 8 + x) * 4;
            img.data[i] = img.data[i+1] = img.data[i+2] = on ? 0 : 255;
            img.data[i+3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
}

/**
 * Generates the SVG `<defs>` block containing `<pattern>` elements for non-solid stroke patterns
 * and `<marker>` elements for arrowheads, based on what the given shapes actually use.
 * Returns an empty string if no defs are needed.
 * @param {object[]} shapes - Flat array of leaf shapes to inspect.
 * @returns {string} An SVG `<defs>…</defs>` string, or `''` if nothing is required.
 */
function buildDefs(shapes) {
    const parts = [];

    const patIndices = [...new Set(shapes.map(s => s.strokePatternIdx ?? 3))]
        .filter(i => i !== 0 && i !== 3 && QD_PATTERNS[i]?.rows);
    for (const i of patIndices) {
        const url = patternTileDataUrl(QD_PATTERNS[i].rows);
        parts.push(`<pattern id="sp${i}" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse"><image href="${url}" width="8" height="8"/></pattern>`);
    }

    const needsArrow = shapes.some(s => s.arrowMode && s.arrowMode !== 0);
    if (needsArrow) {
        parts.push(`<marker id="arr-e" markerWidth="4" markerHeight="3" refX="4" refY="1.5" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 4 1.5, 0 3" fill="black"/></marker>`);
        parts.push(`<marker id="arr-s" markerWidth="4" markerHeight="3" refX="0" refY="1.5" orient="auto" markerUnits="strokeWidth"><polygon points="4 0, 0 1.5, 4 3" fill="black"/></marker>`);
    }

    if (!parts.length) return '';
    return `<defs>\n    ${parts.join('\n    ')}\n  </defs>`;
}

/**
 * Returns the SVG `stroke` attribute string for a shape, resolving pattern indices to
 * `none`, `black`, or a `url(#sp…)` reference for patterned strokes.
 * @param {object} shape - A shape object with an optional `strokePatternIdx` property.
 * @returns {string} An SVG attribute string such as `stroke="black"` or `stroke="url(#sp5)"`.
 */
function strokeAttr(shape) {
    const idx = shape.strokePatternIdx ?? 3;
    if (idx === 0) return 'stroke="none"';
    if (idx === 3) return 'stroke="black"';
    return `stroke="url(#sp${idx})"`;
}

/**
 * Returns a `stroke-dasharray` attribute string for a shape if its stroke dash style is non-solid,
 * or an empty string when no dashing is needed.
 * @param {object} shape - A shape object with an optional `strokeDash` index.
 * @returns {string} An SVG attribute string like ` stroke-dasharray="4 2"`, or `''`.
 */
function dashAttr(shape) {
    const dash = STROKE_DASHES[shape.strokeDash ?? 0]?.dash;
    return dash?.length ? ` stroke-dasharray="${dash.join(' ')}"` : '';
}

/**
 * Returns `marker-start` and/or `marker-end` attribute strings for a shape that has arrowheads,
 * or an empty string if no arrowheads are configured.
 * @param {object} shape - A shape object with an optional `arrowMode` index.
 * @returns {string} Zero or more SVG marker attribute strings, e.g. `' marker-end="url(#arr-e)"'`.
 */
function arrowAttr(shape) {
    const mode = ARROW_MODES[shape.arrowMode ?? 0];
    if (!mode || (!mode.start && !mode.end)) return '';
    let attr = '';
    if (mode.start) attr += ' marker-start="url(#arr-s)"';
    if (mode.end)   attr += ' marker-end="url(#arr-e)"';
    return attr;
}

/**
 * Converts a single shape (or group) to its SVG element string.
 * Handles rectangle, roundrect, ellipse, arc, line, bezier, group, and text shape types.
 * Returns an empty string for unknown or unsupported types.
 * @param {object} shape - A shape object with a `type` property and type-specific geometry fields.
 * @returns {string} An SVG element string, or `''` if the shape cannot be represented.
 */
function shapeToSvg(shape) {
    const sw = `${strokeAttr(shape)} stroke-width="${shape.strokeWidth}"${dashAttr(shape)}`;

    if (shape.type === 'rectangle') {
        const { x, y, width, height } = normalize(shape.x, shape.y, shape.width, shape.height);
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" ${sw}/>`;
    }
    if (shape.type === 'roundrect') {
        const { x, y, width, height } = normalize(shape.x, shape.y, shape.width, shape.height);
        const r = Math.min(shape.cornerRadius ?? 10, width / 2, height / 2);
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="none" ${sw}/>`;
    }
    if (shape.type === 'ellipse') {
        const { x, y, width, height } = normalize(shape.x, shape.y, shape.width, shape.height);
        const cx = x + width / 2, cy = y + height / 2;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${width / 2}" ry="${height / 2}" fill="none" ${sw}/>`;
    }
    if (shape.type === 'arc') {
        const { x, y, width: w, height: h } = normalize(shape.x, shape.y, shape.width, shape.height);
        const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
        let d;
        switch (shape.quadrant ?? 1) {
            case 0: d=`M ${cx} ${cy-ry} A ${rx} ${ry} 0 0 1 ${cx+rx} ${cy}`; break;
            case 1: d=`M ${cx+rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx} ${cy+ry}`; break;
            case 2: d=`M ${cx} ${cy+ry} A ${rx} ${ry} 0 0 1 ${cx-rx} ${cy}`; break;
            case 3: d=`M ${cx} ${cy-ry} A ${rx} ${ry} 0 0 0 ${cx-rx} ${cy}`; break;
        }
        return `<path d="${d}" fill="none" ${sw}/>`;
    }
    if (shape.type === 'line') {
        return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${strokeAttr(shape)} stroke-width="${shape.strokeWidth}"${dashAttr(shape)}${arrowAttr(shape)} stroke-linecap="round"/>`;
    }
    if (shape.type === 'bezier' && shape.points.length >= 2) {
        const pts = shape.points;
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            d += ` C ${pts[i-1].c2x} ${pts[i-1].c2y} ${pts[i].c1x} ${pts[i].c1y} ${pts[i].x} ${pts[i].y}`;
        }
        return `<path d="${d}" fill="none" ${strokeAttr(shape)} stroke-width="${shape.strokeWidth}"${dashAttr(shape)}${arrowAttr(shape)} stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (shape.type === 'group') {
        return shape.children.map(shapeToSvg).filter(Boolean).join('\n  ');
    }
    if (shape.type === 'text') {
        const styles = [];
        if (shape.fontFamily) styles.push(`font-family="${shape.fontFamily}"`);
        if (shape.fontSize)   styles.push(`font-size="${shape.fontSize}px"`);
        if (shape.fontStyle & 1) styles.push('font-weight="bold"');
        if (shape.fontStyle & 2) styles.push('font-style="italic"');
        const safe = (shape.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<text x="${shape.x}" y="${shape.y + (shape.fontSize ?? 12)}" ${styles.join(' ')} fill="black">${safe}</text>`;
    }
    return '';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assembles a complete SVG document string from the given shapes, including a rasterized
 * pattern-fill layer (as an embedded PNG) when needed and a `<defs>` block for stroke patterns/arrows.
 * @param {object[]} shapes - Top-level shape array (groups are handled recursively).
 * @param {number} width - Viewport width in pixels.
 * @param {number} height - Viewport height in pixels.
 * @returns {string} A complete `<svg>…</svg>` document string.
 */
export function buildSvg(shapes, width, height) {
    const flat = flattenShapes(shapes);
    const hasFills = flat.some(s => QD_PATTERNS[s.fillIdx]?.rows !== null);
    const fillsLayer = hasFills
        ? `<image href="${buildFillsImage(flat, width, height)}" width="${width}" height="${height}"/>`
        : '';
    const defs = buildDefs(flat);
    const body = shapes.map(shapeToSvg).filter(Boolean).join('\n  ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  ${defs}\n  ${fillsLayer}\n  ${body}\n</svg>`;
}

/**
 * Builds an SVG from the current drawing and triggers a browser file download.
 * @param {object[]} shapes - Top-level shape array to export.
 * @param {number} width - Canvas width in pixels (used for the SVG viewBox).
 * @param {number} height - Canvas height in pixels (used for the SVG viewBox).
 * @param {string} [filename='drawing.svg'] - Suggested filename for the downloaded file.
 */
export function exportSvg(shapes, width, height, filename = 'drawing.svg') {
    const svg = buildSvg(shapes, width, height);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
