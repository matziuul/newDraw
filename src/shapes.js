import { fontCss } from './text-defs.js';

export const STROKE_DASHES = [
    { name: 'Heldragen',   dash: [] },
    { name: 'Streckad',    dash: [10, 5] },
    { name: 'Prickad',     dash: [2, 5] },
    { name: 'Streck-pkt',  dash: [10, 5, 2, 5] },
    { name: 'Lång streck', dash: [20, 5] },
    { name: 'Dubbelpkt',   dash: [10, 5, 2, 5, 2, 5] },
];

export const HANDLE_DEFS = [
    { id: 'nw', cursor: 'nw-resize' }, { id: 'n', cursor: 'n-resize'  },
    { id: 'ne', cursor: 'ne-resize' }, { id: 'e', cursor: 'e-resize'  },
    { id: 'se', cursor: 'se-resize' }, { id: 's', cursor: 's-resize'  },
    { id: 'sw', cursor: 'sw-resize' }, { id: 'w', cursor: 'w-resize'  },
];
export const HS = 6;

let _uid = 0;
export function nextUid() { return ++_uid; }

export function normalize(x, y, w, h) {
    return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, width: Math.abs(w), height: Math.abs(h) };
}

export function snap(v) { return Math.round(v); }

export function offsetShape(shape, dx, dy) {
    if (shape.type === 'line') {
        shape.x1 += dx; shape.y1 += dy;
        shape.x2 += dx; shape.y2 += dy;
    } else if (shape.type === 'bezier') {
        for (const p of shape.points) {
            p.x += dx; p.y += dy;
            p.c1x += dx; p.c1y += dy;
            p.c2x += dx; p.c2y += dy;
        }
    } else if (shape.type === 'group') {
        for (const c of shape.children) offsetShape(c, dx, dy);
    } else {
        shape.x += dx; shape.y += dy;
    }
}

// Reset shape to origin clone coords + delta (used for live-drag from saved origin)
export function applyMoveFromOrigin(shape, origin, dx, dy) {
    if (shape.type === 'line') {
        shape.x1 = origin.x1 + dx; shape.y1 = origin.y1 + dy;
        shape.x2 = origin.x2 + dx; shape.y2 = origin.y2 + dy;
    } else if (shape.type === 'bezier') {
        for (let i = 0; i < shape.points.length; i++) {
            const op = origin.points[i];
            shape.points[i].x   = op.x   + dx; shape.points[i].y   = op.y   + dy;
            shape.points[i].c1x = op.c1x + dx; shape.points[i].c1y = op.c1y + dy;
            shape.points[i].c2x = op.c2x + dx; shape.points[i].c2y = op.c2y + dy;
        }
    } else if (shape.type === 'group') {
        for (let i = 0; i < shape.children.length; i++)
            applyMoveFromOrigin(shape.children[i], origin.children[i], dx, dy);
    } else {
        shape.x = origin.x + dx; shape.y = origin.y + dy;
    }
}

export function getHandlePoints(b) {
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    return [
        { id: 'nw', x: b.x,           y: b.y             },
        { id: 'n',  x: cx,            y: b.y             },
        { id: 'ne', x: b.x + b.width, y: b.y             },
        { id: 'e',  x: b.x + b.width, y: cy              },
        { id: 'se', x: b.x + b.width, y: b.y + b.height  },
        { id: 's',  x: cx,            y: b.y + b.height  },
        { id: 'sw', x: b.x,           y: b.y + b.height  },
        { id: 'w',  x: b.x,           y: cy              },
    ];
}

export function hitTestHandle(px, py, bounds) {
    for (const h of getHandlePoints(bounds)) {
        if (Math.abs(px - h.x) <= HS && Math.abs(py - h.y) <= HS) return h.id;
    }
    return null;
}

export function hitTestBezierHandle(px, py, shape) {
    const CR = 6; // hit radius for control-point circles
    for (let i = 0; i < shape.points.length; i++) {
        const p = shape.points[i];
        if (Math.abs(px - p.x) <= HS && Math.abs(py - p.y) <= HS)
            return { pointIdx: i, role: 'anchor' };
        if ((p.c2x !== p.x || p.c2y !== p.y) && Math.hypot(px - p.c2x, py - p.c2y) <= CR)
            return { pointIdx: i, role: 'c2' };
        if ((p.c1x !== p.x || p.c1y !== p.y) && Math.hypot(px - p.c1x, py - p.c1y) <= CR)
            return { pointIdx: i, role: 'c1' };
    }
    return null;
}

export class RectangleShape {
    constructor(x, y, w, h) {
        this.id = nextUid(); this.type = 'rectangle';
        this.x = x; this.y = y; this.width = w; this.height = h;
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.locked = false;
    }

    getBounds() { return normalize(this.x, this.y, this.width, this.height); }

    hitTest(px, py) {
        const { x, y, width, height } = this.getBounds();
        return px >= x && px <= x + width && py >= y && py <= y + height;
    }

    clone() {
        const s = new RectangleShape(this.x, this.y, this.width, this.height);
        s.id = this.id; s.fillIdx = this.fillIdx; s.strokeWidth = this.strokeWidth; s.strokeDash = this.strokeDash; s.strokePatternIdx = this.strokePatternIdx; s.locked = this.locked;
        return s;
    }

    draw(ctx, patterns, qd) {
        const { x, y, width, height } = this.getBounds();
        const px = qd ? snap(x) + 0.5 : x, py = qd ? snap(y) + 0.5 : y;
        const pw = qd ? snap(width) : width, ph = qd ? snap(height) : height;
        ctx.save();
        ctx.lineWidth = this.strokeWidth;
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        const pat = patterns[this.fillIdx];
        if (pat) { ctx.fillStyle = pat; ctx.fillRect(px - 0.5, py - 0.5, pw, ph); }
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        if (strokePat !== null) { ctx.strokeStyle = strokePat; ctx.strokeRect(px, py, pw, ph); }
        ctx.restore();
    }
}

export class EllipseShape {
    constructor(x, y, w, h) {
        this.id = nextUid(); this.type = 'ellipse';
        this.x = x; this.y = y; this.width = w; this.height = h;
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.locked = false;
    }

    getBounds() { return normalize(this.x, this.y, this.width, this.height); }

    hitTest(px, py) {
        const { x, y, width, height } = this.getBounds();
        if (width === 0 || height === 0) return false;
        const dx = (px - (x + width / 2)) / (width / 2);
        const dy = (py - (y + height / 2)) / (height / 2);
        return dx * dx + dy * dy <= 1;
    }

    clone() {
        const s = new EllipseShape(this.x, this.y, this.width, this.height);
        s.id = this.id; s.fillIdx = this.fillIdx; s.strokeWidth = this.strokeWidth; s.strokeDash = this.strokeDash; s.strokePatternIdx = this.strokePatternIdx; s.locked = this.locked;
        return s;
    }

    draw(ctx, patterns, qd) {
        const { x, y, width, height } = this.getBounds();
        const px = qd ? snap(x) : x, py = qd ? snap(y) : y;
        const pw = qd ? snap(width) : width, ph = qd ? snap(height) : height;
        ctx.save();
        ctx.lineWidth = this.strokeWidth;
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        ctx.beginPath();
        ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
        const pat = patterns[this.fillIdx];
        if (pat) { ctx.fillStyle = pat; ctx.fill(); }
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        if (strokePat !== null) { ctx.strokeStyle = strokePat; ctx.stroke(); }
        ctx.restore();
    }
}

export class LineShape {
    constructor(x1, y1, x2, y2) {
        this.id = nextUid(); this.type = 'line';
        this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.locked = false;
    }

    getBounds() {
        return {
            x: Math.min(this.x1, this.x2), y: Math.min(this.y1, this.y2),
            width: Math.abs(this.x2 - this.x1), height: Math.abs(this.y2 - this.y1),
        };
    }

    hitTest(px, py) {
        const dx = this.x2 - this.x1, dy = this.y2 - this.y1;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(px - this.x1, py - this.y1) < 8;
        const t = Math.max(0, Math.min(1, ((px - this.x1) * dx + (py - this.y1) * dy) / len2));
        return Math.hypot(px - (this.x1 + t * dx), py - (this.y1 + t * dy)) < 6;
    }

    clone() {
        const s = new LineShape(this.x1, this.y1, this.x2, this.y2);
        s.id = this.id; s.fillIdx = this.fillIdx; s.strokeWidth = this.strokeWidth; s.strokeDash = this.strokeDash; s.strokePatternIdx = this.strokePatternIdx; s.locked = this.locked;
        return s;
    }

    draw(ctx, patterns, qd) {
        const x1 = qd ? snap(this.x1) + 0.5 : this.x1;
        const y1 = qd ? snap(this.y1) + 0.5 : this.y1;
        const x2 = qd ? snap(this.x2) + 0.5 : this.x2;
        const y2 = qd ? snap(this.y2) + 0.5 : this.y2;
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        if (strokePat === null) return;
        ctx.save();
        ctx.strokeStyle = strokePat; ctx.lineWidth = this.strokeWidth;
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
    }
}

let _scratchCtx = null;
function getScratchCtx() {
    if (!_scratchCtx) {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        _scratchCtx = c.getContext('2d');
    }
    return _scratchCtx;
}

// Each point: { x, y, c1x, c1y, c2x, c2y }
// c1 = in-handle (from previous segment), c2 = out-handle (to next segment)
// Corner points have c1 = c2 = { x, y }
export class BezierShape {
    constructor(points = []) {
        this.id = nextUid(); this.type = 'bezier';
        this.points = points;
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.locked = false;
    }

    _makePath() {
        const pts = this.points, path = new Path2D();
        if (pts.length < 1) return path;
        path.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            path.bezierCurveTo(pts[i-1].c2x, pts[i-1].c2y, pts[i].c1x, pts[i].c1y, pts[i].x, pts[i].y);
        }
        return path;
    }

    getBounds() {
        if (this.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
        const xs = this.points.flatMap(p => [p.x, p.c1x, p.c2x]);
        const ys = this.points.flatMap(p => [p.y, p.c1y, p.c2y]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    hitTest(px, py) {
        if (this.points.length < 2) return false;
        const ctx = getScratchCtx();
        ctx.lineWidth = Math.max(this.strokeWidth, 8);
        return ctx.isPointInStroke(this._makePath(), px, py);
    }

    clone() {
        const b = new BezierShape(this.points.map(p => ({ ...p })));
        b.id = this.id; b.fillIdx = this.fillIdx; b.strokeWidth = this.strokeWidth; b.strokeDash = this.strokeDash; b.strokePatternIdx = this.strokePatternIdx; b.locked = this.locked;
        return b;
    }

    draw(ctx, patterns, _qd) {
        if (this.points.length < 2) return;
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        ctx.save();
        ctx.lineWidth = this.strokeWidth;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        const path = this._makePath();
        const pat = patterns[this.fillIdx];
        if (pat) { ctx.fillStyle = pat; ctx.fill(path); }
        if (strokePat !== null) { ctx.strokeStyle = strokePat; ctx.stroke(path); }
        ctx.restore();
    }
}

export class RoundRectShape {
    constructor(x, y, w, h) {
        this.id = nextUid(); this.type = 'roundrect';
        this.x = x; this.y = y; this.width = w; this.height = h;
        this.cornerRadius = 10;
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.locked = false;
    }

    getBounds() { return normalize(this.x, this.y, this.width, this.height); }

    hitTest(px, py) {
        const { x, y, width, height } = this.getBounds();
        return px >= x && px <= x + width && py >= y && py <= y + height;
    }

    clone() {
        const s = new RoundRectShape(this.x, this.y, this.width, this.height);
        s.id = this.id; s.cornerRadius = this.cornerRadius;
        s.fillIdx = this.fillIdx; s.strokeWidth = this.strokeWidth; s.strokeDash = this.strokeDash; s.strokePatternIdx = this.strokePatternIdx; s.locked = this.locked;
        return s;
    }

    _makePath(x, y, w, h) {
        const r = Math.min(this.cornerRadius, w / 2, h / 2);
        const p = new Path2D();
        p.moveTo(x + r, y);
        p.lineTo(x + w - r, y);       p.arcTo(x + w, y,     x + w, y + r,     r);
        p.lineTo(x + w, y + h - r);   p.arcTo(x + w, y + h, x + w - r, y + h, r);
        p.lineTo(x + r, y + h);       p.arcTo(x,     y + h, x,     y + h - r, r);
        p.lineTo(x, y + r);           p.arcTo(x,     y,     x + r, y,         r);
        p.closePath();
        return p;
    }

    draw(ctx, patterns, qd) {
        const { x, y, width, height } = this.getBounds();
        const px = qd ? snap(x) : x, py = qd ? snap(y) : y;
        const pw = qd ? snap(width) : width, ph = qd ? snap(height) : height;
        ctx.save();
        ctx.lineWidth = this.strokeWidth;
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        const path = this._makePath(px, py, pw, ph);
        const pat = patterns[this.fillIdx];
        if (pat) { ctx.fillStyle = pat; ctx.fill(path); }
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        if (strokePat !== null) { ctx.strokeStyle = strokePat; ctx.stroke(path); }
        ctx.restore();
    }
}

export class GroupShape {
    constructor(children = []) {
        this.id = nextUid(); this.type = 'group';
        this.children = children;
        this.locked = false;
    }

    getBounds() {
        if (this.children.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
        const bs = this.children.map(c => c.getBounds());
        const minX = Math.min(...bs.map(b => b.x));
        const minY = Math.min(...bs.map(b => b.y));
        const maxX = Math.max(...bs.map(b => b.x + b.width));
        const maxY = Math.max(...bs.map(b => b.y + b.height));
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    hitTest(px, py) { return this.children.some(c => c.hitTest(px, py)); }

    clone() {
        const g = new GroupShape(this.children.map(c => c.clone()));
        g.id = this.id; g.locked = this.locked;
        return g;
    }

    draw(ctx, patterns, qd) {
        for (const c of this.children) c.draw(ctx, patterns, qd);
    }
}

export class TextShape {
    constructor(x, y, text = '', fontFamily = 'Geneva', fontSize = 12, fontStyle = 0) {
        this.id = nextUid(); this.type = 'text';
        this.x = x; this.y = y;
        this.text = text;
        this.fontFamily = fontFamily;
        this.fontSize = fontSize;
        this.fontStyle = fontStyle; // bitmask: 1=bold 2=italic 4=underline 8=outline 16=shadow
        this.fillIdx = 0; this.strokeWidth = 0; this.locked = false;
    }

    _cssFont() {
        const bold   = (this.fontStyle & 1) ? 'bold '   : '';
        const italic = (this.fontStyle & 2) ? 'italic ' : '';
        return `${italic}${bold}${this.fontSize}px ${fontCss(this.fontFamily)}`;
    }

    _lineHeight() { return Math.ceil(this.fontSize * 1.25); }

    getBounds() {
        const ctx = getScratchCtx();
        ctx.font = this._cssFont();
        const lines = this.text ? this.text.split('\n') : [''];
        const maxW = Math.max(...lines.map(l => ctx.measureText(l || ' ').width), 20);
        return { x: this.x, y: this.y, width: maxW, height: lines.length * this._lineHeight() };
    }

    hitTest(px, py) {
        const b = this.getBounds();
        return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
    }

    clone() {
        const t = new TextShape(this.x, this.y, this.text, this.fontFamily, this.fontSize, this.fontStyle);
        t.id = this.id; t.locked = this.locked;
        return t;
    }

    draw(ctx, _p, _q) {
        if (!this.text) return;
        const lines = this.text.split('\n');
        const lh = this._lineHeight();
        ctx.save();
        ctx.font = this._cssFont();
        ctx.textBaseline = 'top';

        const hasShadow    = !!(this.fontStyle & 16);
        const hasOutline   = !!(this.fontStyle & 8);
        const hasUnderline = !!(this.fontStyle & 4);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const tx = this.x, ty = this.y + i * lh;
            if (hasShadow) {
                ctx.fillStyle = 'rgba(0,0,0,0.35)';
                ctx.fillText(line, tx + 2, ty + 2);
            }
            if (hasOutline) {
                ctx.fillStyle = 'white';
                ctx.fillText(line, tx, ty);
                ctx.strokeStyle = 'black';
                ctx.lineWidth = Math.max(1, this.fontSize / 14);
                ctx.lineJoin = 'round';
                ctx.strokeText(line, tx, ty);
            } else {
                ctx.fillStyle = 'black';
                ctx.fillText(line, tx, ty);
            }
            if (hasUnderline) {
                const w = ctx.measureText(line).width;
                ctx.strokeStyle = 'black';
                ctx.lineWidth = Math.max(1, Math.round(this.fontSize / 12));
                ctx.beginPath();
                ctx.moveTo(tx, ty + this.fontSize + 1);
                ctx.lineTo(tx + w, ty + this.fontSize + 1);
                ctx.stroke();
            }
        }
        ctx.restore();
    }
}