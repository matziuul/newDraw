import { fontCss } from './text-defs.js';

export const ARROW_MODES = [
    { name: 'Ingen', start: false, end: false },
    { name: 'Slut',  start: false, end: true  },
    { name: 'Start', start: true,  end: false },
    { name: 'Båda',  start: true,  end: true  },
];

function _arrowHead(ctx, tipX, tipY, angle, sw) {
    const L = Math.max(10, sw * 3);
    const W = Math.max(4,  sw * 1.5);
    ctx.save();
    ctx.setLineDash([]);
    ctx.translate(tipX, tipY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-L, -W);
    ctx.lineTo(-L,  W);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

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
export function seedUid(n) { if (n > _uid) _uid = n; }

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

export function hitTestHandle(px, py, bounds, zoom = 1) {
    const hs = HS / zoom;
    for (const h of getHandlePoints(bounds)) {
        if (Math.abs(px - h.x) <= hs && Math.abs(py - h.y) <= hs) return h.id;
    }
    return null;
}

// Returns 0 (start handle), 1 (end handle), or null.
export function hitTestArcHandle(px, py, shape, zoom = 1) {
    const r = (HS + 2) / zoom;
    const pts = shape.getArcHandlePositions();
    for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(px - pts[i].x, py - pts[i].y) <= r) return i;
    }
    return null;
}

export function hitTestBezierHandle(px, py, shape, zoom = 1) {
    const hs = HS / zoom;
    const cr = 6 / zoom;
    for (let i = 0; i < shape.points.length; i++) {
        const p = shape.points[i];
        if (Math.abs(px - p.x) <= hs && Math.abs(py - p.y) <= hs)
            return { pointIdx: i, role: 'anchor' };
        if ((p.c2x !== p.x || p.c2y !== p.y) && Math.hypot(px - p.c2x, py - p.c2y) <= cr)
            return { pointIdx: i, role: 'c2' };
        if ((p.c1x !== p.x || p.c1y !== p.y) && Math.hypot(px - p.c1x, py - p.c1y) <= cr)
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
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.arrowMode = 0; this.locked = false;
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
        s.id = this.id; s.fillIdx = this.fillIdx; s.strokeWidth = this.strokeWidth; s.strokeDash = this.strokeDash; s.strokePatternIdx = this.strokePatternIdx; s.arrowMode = this.arrowMode; s.locked = this.locked;
        return s;
    }

    draw(ctx, patterns, qd) {
        const x1 = qd ? snap(this.x1) + 0.5 : this.x1;
        const y1 = qd ? snap(this.y1) + 0.5 : this.y1;
        const x2 = qd ? snap(this.x2) + 0.5 : this.x2;
        const y2 = qd ? snap(this.y2) + 0.5 : this.y2;
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        if (strokePat === null) return;

        const mode = ARROW_MODES[this.arrowMode ?? 0];
        const sw   = this.strokeWidth;
        const arrowL = Math.max(10, sw * 3);
        const len    = Math.hypot(x2 - x1, y2 - y1);
        const angle  = Math.atan2(y2 - y1, x2 - x1);

        // Shorten line so stroke doesn't overdraw the arrow head
        let lx1 = x1, ly1 = y1, lx2 = x2, ly2 = y2;
        if (len > 0) {
            const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
            const s  = Math.min(arrowL, len * 0.45);
            if (mode.end)   { lx2 = x2 - ux * s; ly2 = y2 - uy * s; }
            if (mode.start) { lx1 = x1 + ux * s; ly1 = y1 + uy * s; }
        }

        ctx.save();
        ctx.strokeStyle = strokePat; ctx.fillStyle = strokePat;
        ctx.lineWidth = sw;
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx2, ly2); ctx.stroke();
        if (mode.end)   _arrowHead(ctx, x2, y2, angle,             sw);
        if (mode.start) _arrowHead(ctx, x1, y1, angle + Math.PI,   sw);
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
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.arrowMode = 0; this.locked = false;
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
        b.id = this.id; b.fillIdx = this.fillIdx; b.strokeWidth = this.strokeWidth; b.strokeDash = this.strokeDash; b.strokePatternIdx = this.strokePatternIdx; b.arrowMode = this.arrowMode; b.locked = this.locked;
        return b;
    }

    _endAngle() {
        const pts = this.points, n = pts.length - 1;
        const p = pts[n];
        if (p.c1x !== p.x || p.c1y !== p.y) return Math.atan2(p.y - p.c1y, p.x - p.c1x);
        return Math.atan2(p.y - pts[n - 1].y, p.x - pts[n - 1].x);
    }

    _startAngle() {
        const pts = this.points, p = pts[0];
        if (p.c2x !== p.x || p.c2y !== p.y) return Math.atan2(p.y - p.c2y, p.x - p.c2x);
        return Math.atan2(p.y - pts[1].y, p.x - pts[1].x);
    }

    draw(ctx, patterns, _qd) {
        if (this.points.length < 2) return;
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        ctx.save();
        // Canvas anti-aliasing makes 45° strokes appear ~0.71× as heavy as axis-aligned
        // strokes at the same lineWidth. Compensate for 1px pens by rendering at √2 ≈ 1.41px
        // so diagonal segments match horizontal/vertical visual weight.
        ctx.lineWidth = this.strokeWidth === 1 ? Math.SQRT2 : this.strokeWidth;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        const path = this._makePath();
        const pat = patterns[this.fillIdx];
        if (pat) { ctx.fillStyle = pat; ctx.fill(path); }
        if (strokePat !== null) {
            ctx.strokeStyle = strokePat; ctx.fillStyle = strokePat;
            ctx.stroke(path);
            const mode = ARROW_MODES[this.arrowMode ?? 0];
            const sw   = this.strokeWidth;
            const pts  = this.points;
            if (mode.end)   _arrowHead(ctx, pts[pts.length-1].x, pts[pts.length-1].y, this._endAngle(),   sw);
            if (mode.start) _arrowHead(ctx, pts[0].x,            pts[0].y,            this._startAngle(), sw);
        }
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

function _arcEllipse(path, cx, cy, rx, ry, quadrant, startAngleDeg, arcAngleDeg) {
    if (startAngleDeg !== undefined && arcAngleDeg !== undefined) {
        // Mac convention: 0° = 12 o'clock, clockwise. Canvas: 0 = 3 o'clock, CW with anticlockwise=false.
        const s = startAngleDeg * Math.PI / 180 - Math.PI / 2;
        path.ellipse(cx, cy, rx, ry, 0, s, s + arcAngleDeg * Math.PI / 180, false);
        return;
    }
    switch (quadrant) {
        case 0: path.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2,      0,           false); break; // top → right
        case 1: path.ellipse(cx, cy, rx, ry, 0,  0,                Math.PI / 2, false); break; // right → bottom
        case 2: path.ellipse(cx, cy, rx, ry, 0,  Math.PI / 2,      Math.PI,     false); break; // bottom → left
        case 3: path.ellipse(cx, cy, rx, ry, 0,  3 * Math.PI / 2,  Math.PI,     true ); break; // top → left (CCW)
    }
}

// quadrant: 0=top-right, 1=bottom-right, 2=bottom-left, 3=top-left
// (x,y,width,height) is the bounding box of the inscribed full ellipse.
// The quadrant picks which 90° sector to show; the arc fills the corner
// that faces the same direction as the quadrant.
// rx = width/2, ry = height/2  (standard ellipse half-radii)
export class ArcShape {
    constructor(x, y, w, h) {
        this.id = nextUid(); this.type = 'arc';
        this.x = x; this.y = y; this.width = w; this.height = h;
        this.quadrant = 1; // default: bottom-right
        this.startAngleDeg = undefined; // set for reshape arcs (arbitrary angle span)
        this.arcAngleDeg   = undefined;
        this.fillIdx = 0; this.strokeWidth = 2; this.strokeDash = 0; this.strokePatternIdx = 3; this.locked = false;
    }

    getBounds() { return normalize(this.x, this.y, this.width, this.height); }

    // Returns the bounding box of the visible arc (quadrant or arbitrary angle).
    getSelectionBounds() {
        const { x, y, width: w, height: h } = normalize(this.x, this.y, this.width, this.height);
        const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
        if (this.startAngleDeg !== undefined && this.arcAngleDeg !== undefined) {
            const sa = this.startAngleDeg, ea = sa + this.arcAngleDeg;
            const pts = [];
            for (const deg of [sa, ea]) {
                const r = deg * Math.PI / 180 - Math.PI / 2;
                pts.push({ x: cx + rx * Math.cos(r), y: cy + ry * Math.sin(r) });
            }
            for (const card of [0, 90, 180, 270, 360]) {
                if (card > sa && card < ea) {
                    const r = card * Math.PI / 180 - Math.PI / 2;
                    pts.push({ x: cx + rx * Math.cos(r), y: cy + ry * Math.sin(r) });
                }
            }
            const minX = Math.min(...pts.map(p => p.x));
            const maxX = Math.max(...pts.map(p => p.x));
            const minY = Math.min(...pts.map(p => p.y));
            const maxY = Math.max(...pts.map(p => p.y));
            return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        }
        switch (this.quadrant) {
            case 0: return { x: cx, y,       width: rx, height: ry };
            case 1: return { x: cx, y: cy,   width: rx, height: ry };
            case 2: return { x,    y: cy,    width: rx, height: ry };
            case 3: return { x,    y,        width: rx, height: ry };
            default: return { x, y, width: w, height: h };
        }
    }

    // Closed wedge path (for fill and hit-test)
    _makeFillPath(x, y, w, h) {
        const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
        const p = new Path2D();
        p.moveTo(cx, cy);
        _arcEllipse(p, cx, cy, rx, ry, this.quadrant, this.startAngleDeg, this.arcAngleDeg);
        p.closePath();
        return p;
    }

    // Open arc path (for stroke only — no radii lines)
    _makeStrokePath(x, y, w, h) {
        const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
        const p = new Path2D();
        _arcEllipse(p, cx, cy, rx, ry, this.quadrant, this.startAngleDeg, this.arcAngleDeg);
        return p;
    }

    hitTest(px, py) {
        const { x, y, width, height } = this.getBounds();
        if (width === 0 || height === 0) return false;
        return getScratchCtx().isPointInPath(this._makeFillPath(x, y, width, height), px, py);
    }

    // Returns [{x,y}, {x,y}] — screen positions of the arc's start and end handles.
    getArcHandlePositions() {
        const { x, y, width: w, height: h } = this.getBounds();
        const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
        const startDeg = this.startAngleDeg ?? [0, 90, 180, 270][this.quadrant ?? 1];
        const arcDeg   = this.arcAngleDeg  ?? 90;
        return [startDeg, startDeg + arcDeg].map(deg => {
            const r = deg * Math.PI / 180 - Math.PI / 2;
            return { x: cx + rx * Math.cos(r), y: cy + ry * Math.sin(r) };
        });
    }

    clone() {
        const s = new ArcShape(this.x, this.y, this.width, this.height);
        s.id = this.id; s.quadrant = this.quadrant;
        s.startAngleDeg = this.startAngleDeg; s.arcAngleDeg = this.arcAngleDeg;
        s.fillIdx = this.fillIdx;
        s.strokeWidth = this.strokeWidth; s.strokeDash = this.strokeDash;
        s.strokePatternIdx = this.strokePatternIdx; s.locked = this.locked;
        return s;
    }

    draw(ctx, patterns, qd) {
        const { x, y, width, height } = this.getBounds();
        const px = qd ? snap(x) : x, py = qd ? snap(y) : y;
        const pw = qd ? snap(width) : width, ph = qd ? snap(height) : height;
        if (pw === 0 || ph === 0) return;
        ctx.save();
        ctx.lineWidth = this.strokeWidth;
        ctx.setLineDash(STROKE_DASHES[this.strokeDash ?? 0].dash);
        const pat = patterns[this.fillIdx];
        if (pat) { ctx.fillStyle = pat; ctx.fill(this._makeFillPath(px, py, pw, ph)); }
        const strokePat = patterns[this.strokePatternIdx ?? 3];
        if (strokePat !== null) { ctx.strokeStyle = strokePat; ctx.stroke(this._makeStrokePath(px, py, pw, ph)); }
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

// ─── Shape transforms ─────────────────────────────────────────────────────────

export function applyTransform(shape, op) {
    const b  = shape.getSelectionBounds?.() ?? shape.getBounds();
    const cx = b.x + b.width  / 2;
    const cy = b.y + b.height / 2;
    const fn = _makeTransformFn(op, cx, cy);
    _applyTransformFn(shape, fn, op);
}

function _makeTransformFn(op, cx, cy) {
    if (op === 'flipH')      return (x, y) => ({ x: 2 * cx - x, y });
    if (op === 'flipV')      return (x, y) => ({ x, y: 2 * cy - y });
    if (op === 'rotate90CW') return (x, y) => ({ x: cx + (y - cy), y: cy - (x - cx) });
    /* rotate90CCW */        return (x, y) => ({ x: cx - (y - cy), y: cy + (x - cx) });
}

function _applyTransformFn(shape, fn, op = null) {
    if (shape.type === 'line') {
        const p1 = fn(shape.x1, shape.y1), p2 = fn(shape.x2, shape.y2);
        shape.x1 = p1.x; shape.y1 = p1.y; shape.x2 = p2.x; shape.y2 = p2.y;

    } else if (shape.type === 'bezier') {
        for (const p of shape.points) {
            const a = fn(p.x, p.y), c1 = fn(p.c1x, p.c1y), c2 = fn(p.c2x, p.c2y);
            p.x = a.x; p.y = a.y; p.c1x = c1.x; p.c1y = c1.y; p.c2x = c2.x; p.c2y = c2.y;
        }

    } else if (shape.type === 'group') {
        for (const child of shape.children) _applyTransformFn(child, fn, op);

    } else if (shape.type === 'text') {
        const p = fn(shape.x, shape.y);
        shape.x = p.x; shape.y = p.y;

    } else if (shape.type === 'arc') {
        // Transform the visible quadrant's bounding box, then remap quadrant and recompute
        // the full ellipse. Quadrant mapping per operation:
        //   flipH:       Q0↔Q3, Q1↔Q2  → 3-q
        //   flipV:       Q0↔Q1, Q2↔Q3  → q^1
        //   rotate90CW:  Q0→Q3→Q2→Q1→  → (q+3)%4
        //   rotate90CCW: Q0→Q1→Q2→Q3→  → (q+1)%4
        const sb = shape.getSelectionBounds();
        const corners = [
            fn(sb.x,             sb.y),
            fn(sb.x + sb.width,  sb.y),
            fn(sb.x,             sb.y + sb.height),
            fn(sb.x + sb.width,  sb.y + sb.height),
        ];
        const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
        const vx = Math.min(...xs), vy = Math.min(...ys);
        const vw = Math.max(...xs) - vx, vh = Math.max(...ys) - vy;
        const q = shape.quadrant;
        if (op === 'flipH')           shape.quadrant = 3 - q;
        else if (op === 'flipV')      shape.quadrant = q ^ 1;
        else if (op === 'rotate90CW') shape.quadrant = (q + 3) % 4;
        else                          shape.quadrant = (q + 1) % 4; // rotate90CCW
        const nq = shape.quadrant;
        shape.x = (nq === 0 || nq === 1) ? vx - vw : vx;
        shape.y = (nq === 1 || nq === 2) ? vy - vh : vy;
        shape.width = 2 * vw; shape.height = 2 * vh;
        delete shape.startAngleDeg;
        delete shape.arcAngleDeg;

    } else {
        // rect / ellipse / roundrect: transform corners → new axis-aligned bounding box
        const corners = [
            fn(shape.x,               shape.y),
            fn(shape.x + shape.width, shape.y),
            fn(shape.x,               shape.y + shape.height),
            fn(shape.x + shape.width, shape.y + shape.height),
        ];
        const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
        shape.x      = Math.min(...xs);
        shape.y      = Math.min(...ys);
        shape.width  = Math.max(...xs) - shape.x;
        shape.height = Math.max(...ys) - shape.y;
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