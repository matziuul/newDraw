// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    applyTransform, HS,
    ArcShape, RoundRectShape, BezierShape, LineShape, RectangleShape,
    hitTestBezierHandle, hitTestArcHandle,
} from '../src/shapes.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Corner bezier point: all handles coincide with the anchor. */
function corner(x, y) {
    return { x, y, c1x: x, c1y: y, c2x: x, c2y: y };
}

/** Smooth bezier point with distinct in/out handles. */
function smooth(x, y, c1x, c1y, c2x, c2y) {
    return { x, y, c1x, c1y, c2x, c2y };
}

// ─── RoundRectShape ───────────────────────────────────────────────────────────

describe('RoundRectShape', () => {
    it('type is roundrect', () => {
        expect(new RoundRectShape(0, 0, 100, 50).type).toBe('roundrect');
    });

    it('getBounds returns normalized positive dimensions', () => {
        const s = new RoundRectShape(10, 20, 80, 40);
        expect(s.getBounds()).toEqual({ x: 10, y: 20, width: 80, height: 40 });
    });

    it('getBounds normalizes negative dimensions', () => {
        const s = new RoundRectShape(90, 60, -80, -40);
        expect(s.getBounds()).toEqual({ x: 10, y: 20, width: 80, height: 40 });
    });

    it('hitTest returns true inside', () => {
        const s = new RoundRectShape(0, 0, 100, 50);
        expect(s.hitTest(50, 25)).toBe(true);
    });

    it('hitTest returns false outside', () => {
        const s = new RoundRectShape(0, 0, 100, 50);
        expect(s.hitTest(200, 25)).toBe(false);
    });

    it('clone preserves id, cornerRadius, and style', () => {
        const s = new RoundRectShape(0, 0, 100, 50);
        s.cornerRadius = 20;
        s.fillIdx = 2;
        s.strokeWidth = 4;
        const c = s.clone();
        expect(c.id).toBe(s.id);
        expect(c.cornerRadius).toBe(20);
        expect(c.fillIdx).toBe(2);
        expect(c.strokeWidth).toBe(4);
    });

    it('clone is a distinct object', () => {
        const s = new RoundRectShape(0, 0, 80, 40);
        const c = s.clone();
        c.x = 999;
        expect(s.x).toBe(0);
    });

    it('default cornerRadius is 10', () => {
        expect(new RoundRectShape(0, 0, 100, 50).cornerRadius).toBe(10);
    });
});

// ─── ArcShape ─────────────────────────────────────────────────────────────────

describe('ArcShape', () => {
    it('type is arc', () => {
        expect(new ArcShape(0, 0, 100, 80).type).toBe('arc');
    });

    it('default quadrant is 1 (bottom-right)', () => {
        expect(new ArcShape(0, 0, 100, 80).quadrant).toBe(1);
    });

    it('getBounds returns normalized full-ellipse bounding box', () => {
        const s = new ArcShape(10, 20, 100, 80);
        expect(s.getBounds()).toEqual({ x: 10, y: 20, width: 100, height: 80 });
    });

    it('getBounds normalizes negative dimensions', () => {
        const s = new ArcShape(110, 100, -100, -80);
        expect(s.getBounds()).toEqual({ x: 10, y: 20, width: 100, height: 80 });
    });

    it('getSelectionBounds Q0 (top-right quarter)', () => {
        // ellipse centred at (50, 40), rx=50, ry=40
        const s = new ArcShape(0, 0, 100, 80);
        s.quadrant = 0;
        expect(s.getSelectionBounds()).toEqual({ x: 50, y: 0, width: 50, height: 40 });
    });

    it('getSelectionBounds Q1 (bottom-right quarter)', () => {
        const s = new ArcShape(0, 0, 100, 80);
        s.quadrant = 1;
        expect(s.getSelectionBounds()).toEqual({ x: 50, y: 40, width: 50, height: 40 });
    });

    it('getSelectionBounds Q2 (bottom-left quarter)', () => {
        const s = new ArcShape(0, 0, 100, 80);
        s.quadrant = 2;
        expect(s.getSelectionBounds()).toEqual({ x: 0, y: 40, width: 50, height: 40 });
    });

    it('getSelectionBounds Q3 (top-left quarter)', () => {
        const s = new ArcShape(0, 0, 100, 80);
        s.quadrant = 3;
        expect(s.getSelectionBounds()).toEqual({ x: 0, y: 0, width: 50, height: 40 });
    });

    it('clone preserves quadrant and style', () => {
        const s = new ArcShape(10, 20, 100, 80);
        s.quadrant = 3;
        s.fillIdx = 5;
        s.strokeWidth = 3;
        const c = s.clone();
        expect(c.id).toBe(s.id);
        expect(c.quadrant).toBe(3);
        expect(c.fillIdx).toBe(5);
        expect(c.strokeWidth).toBe(3);
    });

    it('clone is a distinct object', () => {
        const s = new ArcShape(0, 0, 100, 80);
        const c = s.clone();
        c.quadrant = 2;
        expect(s.quadrant).toBe(1);
    });

    it('getArcHandlePositions Q1 — start at right edge, end at bottom edge', () => {
        // ellipse 200×100, centred at (100, 50)
        // Q1 startDeg=90 → cos(0)=1,sin(0)=0 → (200, 50)
        // Q1 endDeg=180  → cos(π/2)=0,sin(π/2)=1 → (100, 100)
        const s = new ArcShape(0, 0, 200, 100);
        const [p0, p1] = s.getArcHandlePositions();
        expect(p0.x).toBeCloseTo(200);
        expect(p0.y).toBeCloseTo(50);
        expect(p1.x).toBeCloseTo(100);
        expect(p1.y).toBeCloseTo(100);
    });
});

// ─── hitTestBezierHandle ──────────────────────────────────────────────────────

describe('hitTestBezierHandle', () => {
    const pt0 = corner(100, 100);
    const pt1 = smooth(200, 100, 180, 90, 220, 110);
    // s has a corner at 100,100 and a smooth point at 200,100 with handles

    it('hits anchor of corner point exactly', () => {
        const s = new BezierShape([pt0, pt1]);
        expect(hitTestBezierHandle(100, 100, s)).toEqual({ pointIdx: 0, role: 'anchor' });
    });

    it('hits anchor within HS tolerance', () => {
        const s = new BezierShape([pt0, pt1]);
        const result = hitTestBezierHandle(100 + HS - 1, 100, s);
        expect(result).toEqual({ pointIdx: 0, role: 'anchor' });
    });

    it('misses anchor just outside HS tolerance', () => {
        const s = new BezierShape([{ ...pt0 }]);
        // Far enough from both points to miss everything
        expect(hitTestBezierHandle(100 + HS + 1, 200, s)).toBeNull();
    });

    it('hits c2 handle of smooth point', () => {
        const s = new BezierShape([pt0, pt1]);
        expect(hitTestBezierHandle(220, 110, s)).toEqual({ pointIdx: 1, role: 'c2' });
    });

    it('hits c1 handle of smooth point', () => {
        const s = new BezierShape([pt0, pt1]);
        expect(hitTestBezierHandle(180, 90, s)).toEqual({ pointIdx: 1, role: 'c1' });
    });

    it('does not hit c2 handle on a corner point (handles coincide with anchor)', () => {
        // Corner point: clicking exactly on c2 hits anchor, not c2
        const s = new BezierShape([pt0, corner(300, 300)]);
        const result = hitTestBezierHandle(100, 100, s);
        expect(result?.role).toBe('anchor');
    });

    it('returns null when nothing is hit', () => {
        const s = new BezierShape([pt0, pt1]);
        expect(hitTestBezierHandle(0, 0, s)).toBeNull();
    });

    it('respects zoom — larger zoom means smaller hit area', () => {
        // At zoom=10, hs = 6/10 = 0.6. A click 1px off should miss.
        const s = new BezierShape([corner(100, 100), corner(200, 100)]);
        expect(hitTestBezierHandle(101, 100, s, 10)).toBeNull();
    });
});

// ─── hitTestArcHandle ─────────────────────────────────────────────────────────

describe('hitTestArcHandle', () => {
    // ArcShape 200×100, Q1 → handles at (200,50) and (100,100)
    function makeArc() {
        return new ArcShape(0, 0, 200, 100);
    }

    it('hits handle 0 exactly', () => {
        expect(hitTestArcHandle(200, 50, makeArc())).toBe(0);
    });

    it('hits handle 1 exactly', () => {
        expect(hitTestArcHandle(100, 100, makeArc())).toBe(1);
    });

    it('hits handle 0 within radius', () => {
        const r = (HS + 2) - 1; // 7px, within the 8px hit radius
        expect(hitTestArcHandle(200 + r, 50, makeArc())).toBe(0);
    });

    it('misses when outside radius', () => {
        const r = (HS + 2) + 1; // 9px, just outside
        expect(hitTestArcHandle(200 + r, 50, makeArc())).toBeNull();
    });

    it('returns null far from both handles', () => {
        expect(hitTestArcHandle(0, 0, makeArc())).toBeNull();
    });
});

// ─── applyTransform — LineShape ───────────────────────────────────────────────

describe('applyTransform — LineShape', () => {
    // Line from (10,30) to (90,50). getBounds: x=10,y=30,w=80,h=20. cx=50,cy=40.

    it('flipH mirrors x coordinates around the horizontal centre', () => {
        const s = new LineShape(10, 30, 90, 50);
        applyTransform(s, 'flipH');
        // flipH: x → 2*50-x = 100-x
        expect(s.x1).toBeCloseTo(90); expect(s.y1).toBeCloseTo(30);
        expect(s.x2).toBeCloseTo(10); expect(s.y2).toBeCloseTo(50);
    });

    it('flipV mirrors y coordinates around the vertical centre', () => {
        const s = new LineShape(10, 30, 90, 50);
        applyTransform(s, 'flipV');
        // flipV: y → 2*40-y = 80-y
        expect(s.x1).toBeCloseTo(10); expect(s.y1).toBeCloseTo(50);
        expect(s.x2).toBeCloseTo(90); expect(s.y2).toBeCloseTo(30);
    });

    it('rotate90CW rotates endpoints 90° clockwise around centre', () => {
        const s = new LineShape(10, 30, 90, 50);
        applyTransform(s, 'rotate90CW');
        // rotate90CW: (x,y) → (50+(y-40), 40-(x-50)) = (10+y, 90-x)
        expect(s.x1).toBeCloseTo(40); expect(s.y1).toBeCloseTo(80);
        expect(s.x2).toBeCloseTo(60); expect(s.y2).toBeCloseTo(0);
    });

    it('rotate90CCW rotates endpoints 90° counter-clockwise around centre', () => {
        const s = new LineShape(10, 30, 90, 50);
        applyTransform(s, 'rotate90CCW');
        // rotate90CCW: (x,y) → (50-(y-40), 40+(x-50)) = (90-y, x-10)
        expect(s.x1).toBeCloseTo(60); expect(s.y1).toBeCloseTo(0);
        expect(s.x2).toBeCloseTo(40); expect(s.y2).toBeCloseTo(80);
    });

    it('rotate90CW then rotate90CCW returns to original', () => {
        const s = new LineShape(10, 30, 90, 50);
        applyTransform(s, 'rotate90CW');
        applyTransform(s, 'rotate90CCW');
        expect(s.x1).toBeCloseTo(10); expect(s.y1).toBeCloseTo(30);
        expect(s.x2).toBeCloseTo(90); expect(s.y2).toBeCloseTo(50);
    });
});

// ─── applyTransform — RectangleShape ──────────────────────────────────────────

describe('applyTransform — RectangleShape', () => {
    it('rotate90CW swaps width and height while preserving centre', () => {
        // Rect at (10,20,80,40). Centre: cx=50, cy=40.
        const s = new RectangleShape(10, 20, 80, 40);
        applyTransform(s, 'rotate90CW');
        const b = s.getBounds();
        // Width and height swap
        expect(b.width).toBeCloseTo(40);
        expect(b.height).toBeCloseTo(80);
        // Centre stays at (50, 40)
        expect(b.x + b.width / 2).toBeCloseTo(50);
        expect(b.y + b.height / 2).toBeCloseTo(40);
    });

    it('flipH leaves a symmetric rectangle unchanged', () => {
        const s = new RectangleShape(0, 0, 100, 60);
        const before = s.getBounds();
        applyTransform(s, 'flipH');
        expect(s.getBounds()).toEqual(before);
    });

    it('applying flipH twice is identity', () => {
        const s = new RectangleShape(10, 20, 80, 40);
        const before = s.getBounds();
        applyTransform(s, 'flipH');
        applyTransform(s, 'flipH');
        const after = s.getBounds();
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
        expect(after.width).toBeCloseTo(before.width);
        expect(after.height).toBeCloseTo(before.height);
    });
});

// ─── applyTransform — BezierShape ─────────────────────────────────────────────

describe('applyTransform — BezierShape', () => {
    it('flipH transforms all anchor and handle x coordinates', () => {
        // Two corner points on y=0, x=0 and x=100. Centre: cx=50.
        const s = new BezierShape([corner(0, 0), corner(100, 0)]);
        applyTransform(s, 'flipH');
        // flipH: x → 2*50-x = 100-x
        expect(s.points[0].x).toBeCloseTo(100);
        expect(s.points[1].x).toBeCloseTo(0);
    });

    it('flipH transforms handle positions as well as anchors', () => {
        const s = new BezierShape([
            smooth(0, 0, 0, 0, 20, -10),
            smooth(100, 0, 80, 10, 100, 0),
        ]);
        applyTransform(s, 'flipH'); // cx=50
        // c2 of pt0 was at (20,-10) → x: 100-20=80, y unchanged=-10
        expect(s.points[0].c2x).toBeCloseTo(80);
        expect(s.points[0].c2y).toBeCloseTo(-10);
    });

    it('rotate90CW preserves centre of bounding box', () => {
        const s = new BezierShape([corner(0, 0), corner(100, 0), corner(100, 60)]);
        const before = s.getBounds();
        const cx = before.x + before.width / 2;
        const cy = before.y + before.height / 2;
        applyTransform(s, 'rotate90CW');
        const after = s.getBounds();
        expect(after.x + after.width / 2).toBeCloseTo(cx);
        expect(after.y + after.height / 2).toBeCloseTo(cy);
    });
});

// ─── applyTransform — ArcShape (quadrant remapping) ───────────────────────────

describe('applyTransform — ArcShape quadrant remapping', () => {
    function arc(q) {
        const s = new ArcShape(0, 0, 200, 100);
        s.quadrant = q;
        return s;
    }

    it('flipH: Q0 → Q3', () => { const s = arc(0); applyTransform(s, 'flipH'); expect(s.quadrant).toBe(3); });
    it('flipH: Q1 → Q2', () => { const s = arc(1); applyTransform(s, 'flipH'); expect(s.quadrant).toBe(2); });
    it('flipH: Q2 → Q1', () => { const s = arc(2); applyTransform(s, 'flipH'); expect(s.quadrant).toBe(1); });
    it('flipH: Q3 → Q0', () => { const s = arc(3); applyTransform(s, 'flipH'); expect(s.quadrant).toBe(0); });

    it('flipV: Q0 → Q1', () => { const s = arc(0); applyTransform(s, 'flipV'); expect(s.quadrant).toBe(1); });
    it('flipV: Q1 → Q0', () => { const s = arc(1); applyTransform(s, 'flipV'); expect(s.quadrant).toBe(0); });
    it('flipV: Q2 → Q3', () => { const s = arc(2); applyTransform(s, 'flipV'); expect(s.quadrant).toBe(3); });
    it('flipV: Q3 → Q2', () => { const s = arc(3); applyTransform(s, 'flipV'); expect(s.quadrant).toBe(2); });

    it('rotate90CW: Q0 → Q3', () => { const s = arc(0); applyTransform(s, 'rotate90CW'); expect(s.quadrant).toBe(3); });
    it('rotate90CW: Q1 → Q0', () => { const s = arc(1); applyTransform(s, 'rotate90CW'); expect(s.quadrant).toBe(0); });
    it('rotate90CW: Q2 → Q1', () => { const s = arc(2); applyTransform(s, 'rotate90CW'); expect(s.quadrant).toBe(1); });
    it('rotate90CW: Q3 → Q2', () => { const s = arc(3); applyTransform(s, 'rotate90CW'); expect(s.quadrant).toBe(2); });

    it('rotate90CCW: Q0 → Q1', () => { const s = arc(0); applyTransform(s, 'rotate90CCW'); expect(s.quadrant).toBe(1); });
    it('rotate90CCW: Q1 → Q2', () => { const s = arc(1); applyTransform(s, 'rotate90CCW'); expect(s.quadrant).toBe(2); });
    it('rotate90CCW: Q2 → Q3', () => { const s = arc(2); applyTransform(s, 'rotate90CCW'); expect(s.quadrant).toBe(3); });
    it('rotate90CCW: Q3 → Q0', () => { const s = arc(3); applyTransform(s, 'rotate90CCW'); expect(s.quadrant).toBe(0); });

    it('four rotate90CW brings arc back to original quadrant', () => {
        const s = arc(2);
        applyTransform(s, 'rotate90CW');
        applyTransform(s, 'rotate90CW');
        applyTransform(s, 'rotate90CW');
        applyTransform(s, 'rotate90CW');
        expect(s.quadrant).toBe(2);
    });

    it('clears startAngleDeg and arcAngleDeg when transforming an angle-span arc', () => {
        const s = new ArcShape(0, 0, 200, 100);
        s.startAngleDeg = 30;
        s.arcAngleDeg = 120;
        applyTransform(s, 'flipH');
        expect(s.startAngleDeg).toBeUndefined();
        expect(s.arcAngleDeg).toBeUndefined();
    });
});

// ─── BezierShape.hitTest (needs jsdom for getScratchCtx) ──────────────────────

describe('BezierShape.hitTest', () => {
    it('returns false for fewer than 2 points', () => {
        const s = new BezierShape([corner(50, 50)]);
        expect(s.hitTest(50, 50)).toBe(false);
    });

    it('returns false for empty bezier', () => {
        expect(new BezierShape([]).hitTest(0, 0)).toBe(false);
    });
});

// ─── ArcShape.hitTest (needs jsdom) ───────────────────────────────────────────

describe('ArcShape.hitTest', () => {
    it('returns false for zero-size arc', () => {
        expect(new ArcShape(0, 0, 0, 0).hitTest(0, 0)).toBe(false);
    });
});
