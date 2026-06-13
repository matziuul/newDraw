import { QD_PATTERNS, buildPattern } from './patterns.js';
import { normalize } from './shapes.js';

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
        } else if (shape.type === 'ellipse') {
            const { x, y, width: w, height: h } = normalize(shape.x, shape.y, shape.width, shape.height);
            ctx.beginPath();
            ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    return canvas.toDataURL('image/png');
}

function shapeToSvg(shape) {
    const sw = `stroke="black" stroke-width="${shape.strokeWidth}"`;

    if (shape.type === 'rectangle') {
        const { x, y, width, height } = normalize(shape.x, shape.y, shape.width, shape.height);
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" ${sw}/>`;
    }
    if (shape.type === 'ellipse') {
        const { x, y, width, height } = normalize(shape.x, shape.y, shape.width, shape.height);
        const cx = x + width / 2, cy = y + height / 2;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${width / 2}" ry="${height / 2}" fill="none" ${sw}/>`;
    }
    if (shape.type === 'line') {
        return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="black" stroke-width="${shape.strokeWidth}" stroke-linecap="round"/>`;
    }
    if (shape.type === 'bezier' && shape.points.length >= 2) {
        const pts = shape.points;
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            d += ` C ${pts[i-1].c2x} ${pts[i-1].c2y} ${pts[i].c1x} ${pts[i].c1y} ${pts[i].x} ${pts[i].y}`;
        }
        return `<path d="${d}" fill="none" stroke="black" stroke-width="${shape.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return '';
}

export function buildSvg(shapes, width, height) {
    const hasFills = shapes.some(s => QD_PATTERNS[s.fillIdx]?.rows !== null);
    const fillsLayer = hasFills
        ? `<image href="${buildFillsImage(shapes, width, height)}" width="${width}" height="${height}"/>`
        : '';
    const body = shapes.map(shapeToSvg).join('\n  ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  ${fillsLayer}\n  ${body}\n</svg>`;
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
