import { QD_PATTERNS, buildPattern } from './patterns.js';
import { normalize, STROKE_DASHES } from './shapes.js';

function buildFillsImage(shapes, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const patterns = QD_PATTERNS.map(p => p.rows ? buildPattern(ctx, p.rows) : null);

    for (const shape of shapes) {
        const pat = patterns[shape.fillIdx];
        if (pat === null) continue; // ingen — no fill

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
        }
    }

    return canvas.toDataURL('image/png');
}

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

function buildStrokePatternDefs(shapes) {
    const indices = [...new Set(shapes.map(s => s.strokePatternIdx ?? 3))]
        .filter(i => i !== 0 && i !== 3 && QD_PATTERNS[i]?.rows);
    if (!indices.length) return '';
    const defs = indices.map(i => {
        const url = patternTileDataUrl(QD_PATTERNS[i].rows);
        return `<pattern id="sp${i}" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse"><image href="${url}" width="8" height="8"/></pattern>`;
    }).join('\n    ');
    return `<defs>\n    ${defs}\n  </defs>`;
}

function strokeAttr(shape) {
    const idx = shape.strokePatternIdx ?? 3;
    if (idx === 0) return 'stroke="none"';
    if (idx === 3) return 'stroke="black"';
    return `stroke="url(#sp${idx})"`;
}

function dashAttr(shape) {
    const dash = STROKE_DASHES[shape.strokeDash ?? 0]?.dash;
    return dash?.length ? ` stroke-dasharray="${dash.join(' ')}"` : '';
}

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
    if (shape.type === 'line') {
        return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${strokeAttr(shape)} stroke-width="${shape.strokeWidth}"${dashAttr(shape)} stroke-linecap="round"/>`;
    }
    if (shape.type === 'bezier' && shape.points.length >= 2) {
        const pts = shape.points;
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            d += ` C ${pts[i-1].c2x} ${pts[i-1].c2y} ${pts[i].c1x} ${pts[i].c1y} ${pts[i].x} ${pts[i].y}`;
        }
        return `<path d="${d}" fill="none" ${strokeAttr(shape)} stroke-width="${shape.strokeWidth}"${dashAttr(shape)} stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return '';
}

export function buildSvg(shapes, width, height) {
    const hasFills = shapes.some(s => QD_PATTERNS[s.fillIdx]?.rows !== null);
    const fillsLayer = hasFills
        ? `<image href="${buildFillsImage(shapes, width, height)}" width="${width}" height="${height}"/>`
        : '';
    const defs = buildStrokePatternDefs(shapes);
    const body = shapes.map(shapeToSvg).join('\n  ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  ${defs}\n  ${fillsLayer}\n  ${body}\n</svg>`;
}

export function printDrawing(shapes, width, height) {
    const svg = buildSvg(shapes, width, height);
    const win = window.open('', '_blank');
    if (!win) { alert('Allow popups to print.'); return; }

    win.document.write(`<!DOCTYPE html><html><head><title>MacDraw</title>
<style>
* { margin: 0 }
body { background: white }
svg { max-width: 100%; height: auto; display: block }
@media print { @page { margin: 10mm; size: auto } }
</style>
</head><body>${svg}</body></html>`);
    win.document.close();
    win.addEventListener('afterprint', () => win.close());
    setTimeout(() => win.print(), 100);
}
