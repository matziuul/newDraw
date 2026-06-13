import { describe, it, expect } from 'vitest';
import {
    normalize, snap, offsetShape, applyMoveFromOrigin,
    getHandlePoints, hitTestHandle, HS,
    RectangleShape, EllipseShape, LineShape, BezierShape, GroupShape,
} from '../src/shapes.js';

describe('normalize', () => {
    it('leaves positive dimensions unchanged', () => {
        expect(normalize(10, 20, 50, 30)).toEqual({ x: 10, y: 20, width: 50, height: 30 });
    });

    it('flips negative width', () => {
        expect(normalize(60, 20, -50, 30)).toEqual({ x: 10, y: 20, width: 50, height: 30 });
    });

    it('flips negative height', () => {
        expect(normalize(10, 50, 50, -30)).toEqual({ x: 10, y: 20, width: 50, height: 30 });
    });

    it('flips both negative dimensions', () => {
        expect(normalize(60, 50, -50, -30)).toEqual({ x: 10, y: 20, width: 50, height: 30 });
    });
});

describe('snap', () => {
    it('rounds down below .5', () => { expect(snap(3.4)).toBe(3); });
    it('rounds up at .5',      () => { expect(snap(3.5)).toBe(4); });
    it('rounds up above .5',   () => { expect(snap(3.6)).toBe(4); });
    it('handles negatives',    () => { expect(snap(-3.5)).toBe(-3); });
});

describe('offsetShape', () => {
    it('offsets rectangle x/y', () => {
        const s = new RectangleShape(10, 20, 50, 30);
        offsetShape(s, 5, -3);
        expect(s.x).toBe(15);
        expect(s.y).toBe(17);
    });

    it('offsets line endpoints', () => {
        const s = new LineShape(0, 0, 100, 100);
        offsetShape(s, 10, 20);
        expect(s.x1).toBe(10); expect(s.y1).toBe(20);
        expect(s.x2).toBe(110); expect(s.y2).toBe(120);
    });
});

describe('getHandlePoints', () => {
    const b = { x: 10, y: 20, width: 100, height: 60 };

    it('returns 8 points', () => {
        expect(getHandlePoints(b)).toHaveLength(8);
    });

    it('nw is at top-left corner', () => {
        const nw = getHandlePoints(b).find(p => p.id === 'nw');
        expect(nw).toEqual({ id: 'nw', x: 10, y: 20 });
    });

    it('se is at bottom-right corner', () => {
        const se = getHandlePoints(b).find(p => p.id === 'se');
        expect(se).toEqual({ id: 'se', x: 110, y: 80 });
    });

    it('n is centered horizontally at top edge', () => {
        const n = getHandlePoints(b).find(p => p.id === 'n');
        expect(n).toEqual({ id: 'n', x: 60, y: 20 });
    });

    it('e is centered vertically at right edge', () => {
        const e = getHandlePoints(b).find(p => p.id === 'e');
        expect(e).toEqual({ id: 'e', x: 110, y: 50 });
    });
});

describe('hitTestHandle', () => {
    const bounds = { x: 100, y: 100, width: 200, height: 100 };

    it('hits nw corner exactly', () => {
        expect(hitTestHandle(100, 100, bounds)).toBe('nw');
    });

    it('hits se corner exactly', () => {
        expect(hitTestHandle(300, 200, bounds)).toBe('se');
    });

    it('hits within HS tolerance', () => {
        expect(hitTestHandle(100 + HS, 100, bounds)).toBe('nw');
    });

    it('returns null in the middle of the shape', () => {
        expect(hitTestHandle(200, 150, bounds)).toBeNull();
    });

    it('returns null one pixel outside tolerance', () => {
        expect(hitTestHandle(100 + HS + 1, 100 + HS + 1, bounds)).toBeNull();
    });
});

describe('RectangleShape', () => {
    it('getBounds with positive dimensions', () => {
        const s = new RectangleShape(10, 20, 100, 80);
        expect(s.getBounds()).toEqual({ x: 10, y: 20, width: 100, height: 80 });
    });

    it('getBounds normalizes negative dimensions', () => {
        const s = new RectangleShape(50, 50, -30, -20);
        expect(s.getBounds()).toEqual({ x: 20, y: 30, width: 30, height: 20 });
    });

    it('hitTest returns true inside', () => {
        const s = new RectangleShape(10, 10, 100, 80);
        expect(s.hitTest(50, 50)).toBe(true);
    });

    it('hitTest returns true on boundary', () => {
        const s = new RectangleShape(10, 10, 100, 80);
        expect(s.hitTest(10, 10)).toBe(true);
        expect(s.hitTest(110, 90)).toBe(true);
    });

    it('hitTest returns false outside', () => {
        const s = new RectangleShape(10, 10, 100, 80);
        expect(s.hitTest(5, 5)).toBe(false);
        expect(s.hitTest(111, 91)).toBe(false);
    });

    it('clone preserves all properties with same id', () => {
        const s = new RectangleShape(10, 20, 100, 80);
        s.fillIdx = 3; s.strokeWidth = 4;
        const c = s.clone();
        expect(c.id).toBe(s.id);
        expect(c.x).toBe(10); expect(c.y).toBe(20);
        expect(c.width).toBe(100); expect(c.height).toBe(80);
        expect(c.fillIdx).toBe(3); expect(c.strokeWidth).toBe(4);
    });

    it('clone is a distinct object', () => {
        const s = new RectangleShape(10, 20, 100, 80);
        const c = s.clone();
        c.x = 999;
        expect(s.x).toBe(10);
    });
});

describe('EllipseShape', () => {
    it('hitTest returns true at center', () => {
        const s = new EllipseShape(0, 0, 100, 60);
        expect(s.hitTest(50, 30)).toBe(true);
    });

    it('hitTest returns false at corner of bounding box', () => {
        const s = new EllipseShape(0, 0, 100, 60);
        expect(s.hitTest(1, 1)).toBe(false);
    });

    it('hitTest returns false for zero-size ellipse', () => {
        const s = new EllipseShape(50, 50, 0, 0);
        expect(s.hitTest(50, 50)).toBe(false);
    });

    it('clone preserves all properties', () => {
        const s = new EllipseShape(5, 10, 80, 60);
        s.fillIdx = 2;
        const c = s.clone();
        expect(c.id).toBe(s.id);
        expect(c.x).toBe(5); expect(c.y).toBe(10);
        expect(c.width).toBe(80); expect(c.height).toBe(60);
        expect(c.fillIdx).toBe(2);
    });
});

describe('LineShape', () => {
    it('getBounds computes correct bounding box', () => {
        const s = new LineShape(30, 10, 10, 50);
        expect(s.getBounds()).toEqual({ x: 10, y: 10, width: 20, height: 40 });
    });

    it('hitTest returns true close to the line', () => {
        const s = new LineShape(0, 0, 100, 0);
        expect(s.hitTest(50, 3)).toBe(true);
    });

    it('hitTest returns false far from the line', () => {
        const s = new LineShape(0, 0, 100, 0);
        expect(s.hitTest(50, 20)).toBe(false);
    });

    it('hitTest handles zero-length line', () => {
        const s = new LineShape(50, 50, 50, 50);
        expect(s.hitTest(50, 50)).toBe(true);
        expect(s.hitTest(60, 60)).toBe(false);
    });

    it('clone preserves all properties', () => {
        const s = new LineShape(0, 0, 100, 80);
        s.strokeWidth = 3;
        const c = s.clone();
        expect(c.id).toBe(s.id);
        expect(c.x1).toBe(0); expect(c.y1).toBe(0);
        expect(c.x2).toBe(100); expect(c.y2).toBe(80);
        expect(c.strokeWidth).toBe(3);
    });
});

// Helper: corner bezier point (no separate handles)
const pt = (x, y) => ({ x, y, c1x: x, c1y: y, c2x: x, c2y: y });

describe('BezierShape', () => {
    it('type is bezier', () => {
        expect(new BezierShape([]).type).toBe('bezier');
    });

    it('getBounds of empty bezier', () => {
        expect(new BezierShape([]).getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('getBounds with two corner points', () => {
        const s = new BezierShape([pt(10, 20), pt(110, 80)]);
        expect(s.getBounds()).toEqual({ x: 10, y: 20, width: 100, height: 60 });
    });

    it('getBounds includes control handles outside endpoints', () => {
        // c2 of first point goes above y=0
        const s = new BezierShape([
            { x: 0, y: 0, c1x: 0, c1y: 0, c2x: 50, c2y: -40 },
            pt(100, 0),
        ]);
        expect(s.getBounds().y).toBeLessThan(0);
    });

    it('getBounds with single point', () => {
        const s = new BezierShape([pt(30, 40)]);
        expect(s.getBounds()).toEqual({ x: 30, y: 40, width: 0, height: 0 });
    });

    it('clone preserves id, fillIdx, strokeWidth, locked', () => {
        const s = new BezierShape([pt(0, 0), pt(100, 100)]);
        s.fillIdx = 2; s.strokeWidth = 4; s.locked = true;
        const c = s.clone();
        expect(c.id).toBe(s.id);
        expect(c.fillIdx).toBe(2);
        expect(c.strokeWidth).toBe(4);
        expect(c.locked).toBe(true);
    });

    it('clone deep-copies points', () => {
        const s = new BezierShape([pt(0, 0), pt(100, 100)]);
        const c = s.clone();
        c.points[0].x = 999;
        expect(s.points[0].x).toBe(0);
    });

    it('clone has same point count', () => {
        const s = new BezierShape([pt(0,0), pt(50,50), pt(100,0)]);
        expect(s.clone().points).toHaveLength(3);
    });
});

describe('GroupShape', () => {
    it('type is group', () => {
        expect(new GroupShape([]).type).toBe('group');
    });

    it('getBounds of empty group', () => {
        expect(new GroupShape([]).getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('getBounds wraps all children', () => {
        const g = new GroupShape([
            new RectangleShape(10, 20, 50, 30),
            new RectangleShape(80, 60, 40, 20),
        ]);
        expect(g.getBounds()).toEqual({ x: 10, y: 20, width: 110, height: 60 });
    });

    it('getBounds with single child matches child bounds', () => {
        const child = new RectangleShape(5, 10, 90, 70);
        const g = new GroupShape([child]);
        expect(g.getBounds()).toEqual(child.getBounds());
    });

    it('hitTest delegates to children — hit', () => {
        const g = new GroupShape([new RectangleShape(0, 0, 100, 100)]);
        expect(g.hitTest(50, 50)).toBe(true);
    });

    it('hitTest delegates to children — miss', () => {
        const g = new GroupShape([new RectangleShape(0, 0, 100, 100)]);
        expect(g.hitTest(200, 200)).toBe(false);
    });

    it('hitTest returns false for empty group', () => {
        expect(new GroupShape([]).hitTest(0, 0)).toBe(false);
    });

    it('hitTest returns true if any child is hit', () => {
        const g = new GroupShape([
            new RectangleShape(0, 0, 50, 50),
            new RectangleShape(200, 200, 50, 50),
        ]);
        expect(g.hitTest(210, 210)).toBe(true);
    });

    it('clone preserves id and locked', () => {
        const g = new GroupShape([new RectangleShape(0, 0, 50, 50)]);
        g.locked = true;
        const c = g.clone();
        expect(c.id).toBe(g.id);
        expect(c.locked).toBe(true);
    });

    it('clone deep-copies children', () => {
        const child = new RectangleShape(0, 0, 100, 100);
        const g = new GroupShape([child]);
        const c = g.clone();
        c.children[0].x = 999;
        expect(child.x).toBe(0);
    });

    it('clone has same child count', () => {
        const g = new GroupShape([
            new RectangleShape(0,0,50,50), new RectangleShape(100,0,50,50),
        ]);
        expect(g.clone().children).toHaveLength(2);
    });
});

describe('applyMoveFromOrigin', () => {
    it('moves a rectangle by (dx, dy) from origin', () => {
        const s = new RectangleShape(10, 20, 100, 80);
        const origin = s.clone();
        applyMoveFromOrigin(s, origin, 30, -10);
        expect(s.x).toBe(40); expect(s.y).toBe(10);
    });

    it('does not change width/height of rectangle', () => {
        const s = new RectangleShape(0, 0, 200, 150);
        applyMoveFromOrigin(s, s.clone(), 50, 50);
        expect(s.width).toBe(200); expect(s.height).toBe(150);
    });

    it('moves both endpoints of a line', () => {
        const s = new LineShape(0, 0, 100, 100);
        applyMoveFromOrigin(s, s.clone(), 20, 5);
        expect(s.x1).toBe(20); expect(s.y1).toBe(5);
        expect(s.x2).toBe(120); expect(s.y2).toBe(105);
    });

    it('moves group children recursively', () => {
        const c1 = new RectangleShape(0, 0, 50, 50);
        const c2 = new RectangleShape(100, 0, 50, 50);
        const g = new GroupShape([c1, c2]);
        const origin = g.clone();
        applyMoveFromOrigin(g, origin, 20, 10);
        expect(g.children[0].x).toBe(20); expect(g.children[0].y).toBe(10);
        expect(g.children[1].x).toBe(120); expect(g.children[1].y).toBe(10);
    });

    it('zero delta leaves shape unchanged', () => {
        const s = new RectangleShape(50, 60, 100, 80);
        applyMoveFromOrigin(s, s.clone(), 0, 0);
        expect(s.x).toBe(50); expect(s.y).toBe(60);
    });

    it('moves bezier points and handles', () => {
        const p = { x: 10, y: 20, c1x: 5, c1y: 15, c2x: 15, c2y: 25 };
        const s = new BezierShape([{ ...p }]);
        const origin = s.clone();
        applyMoveFromOrigin(s, origin, 10, 10);
        expect(s.points[0].x).toBe(20);  expect(s.points[0].y).toBe(30);
        expect(s.points[0].c1x).toBe(15); expect(s.points[0].c1y).toBe(25);
        expect(s.points[0].c2x).toBe(25); expect(s.points[0].c2y).toBe(35);
    });
});