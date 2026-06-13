// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TextShape, offsetShape } from '../src/shapes.js';

// jsdom doesn't implement canvas; provide a minimal stub so getScratchCtx() works.
// measureText returns width proportional to string length (7px per char).
beforeAll(() => {
    const fakeCtx = {
        measureText: (s) => ({ width: s.length * 7 }),
        font: '',
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeCtx);
});

describe('TextShape — constructor', () => {
    it('type is text', () => {
        expect(new TextShape(0, 0, 'hi').type).toBe('text');
    });

    it('stores x, y, text', () => {
        const t = new TextShape(10, 20, 'hello');
        expect(t.x).toBe(10); expect(t.y).toBe(20);
        expect(t.text).toBe('hello');
    });

    it('defaults: Geneva, 12px, plain', () => {
        const t = new TextShape(0, 0, '');
        expect(t.fontFamily).toBe('Geneva');
        expect(t.fontSize).toBe(12);
        expect(t.fontStyle).toBe(0);
    });

    it('accepts custom font properties', () => {
        const t = new TextShape(0, 0, 'hi', 'Times', 24, 3);
        expect(t.fontFamily).toBe('Times');
        expect(t.fontSize).toBe(24);
        expect(t.fontStyle).toBe(3);
    });

    it('starts unlocked', () => {
        expect(new TextShape(0, 0, '').locked).toBe(false);
    });

    it('has a unique id', () => {
        const a = new TextShape(0, 0, '');
        const b = new TextShape(0, 0, '');
        expect(a.id).not.toBe(b.id);
    });
});

describe('TextShape — _cssFont', () => {
    it('plain produces font string without bold/italic', () => {
        const t = new TextShape(0, 0, '', 'Geneva', 12, 0);
        const f = t._cssFont();
        expect(f).not.toMatch(/bold/);
        expect(f).not.toMatch(/italic/);
        expect(f).toContain('12px');
    });

    it('bold (bit 1) adds "bold"', () => {
        const t = new TextShape(0, 0, '', 'Geneva', 14, 1);
        expect(t._cssFont()).toContain('bold');
    });

    it('italic (bit 2) adds "italic"', () => {
        const t = new TextShape(0, 0, '', 'Geneva', 14, 2);
        expect(t._cssFont()).toContain('italic');
    });

    it('bold + italic (bits 1|2) includes both', () => {
        const t = new TextShape(0, 0, '', 'Geneva', 14, 3);
        const f = t._cssFont();
        expect(f).toContain('bold');
        expect(f).toContain('italic');
    });

    it('underline (bit 4) does not affect font string', () => {
        const t = new TextShape(0, 0, '', 'Geneva', 12, 4);
        const f = t._cssFont();
        expect(f).not.toMatch(/bold/);
        expect(f).not.toMatch(/italic/);
    });

    it('includes fontSize in px', () => {
        const t = new TextShape(0, 0, '', 'Geneva', 36, 0);
        expect(t._cssFont()).toContain('36px');
    });

    it('includes the font-family css string', () => {
        const t = new TextShape(0, 0, '', 'Times', 12, 0);
        expect(t._cssFont()).toContain('Times');
    });
});

describe('TextShape — _lineHeight', () => {
    it('is ceil(fontSize × 1.25)', () => {
        const t = new TextShape(0, 0, '', 'Geneva', 12, 0);
        expect(t._lineHeight()).toBe(Math.ceil(12 * 1.25));
    });

    it('scales with different font sizes', () => {
        expect(new TextShape(0, 0, '', 'Geneva', 9,  0)._lineHeight()).toBe(Math.ceil(9  * 1.25));
        expect(new TextShape(0, 0, '', 'Geneva', 48, 0)._lineHeight()).toBe(Math.ceil(48 * 1.25));
    });
});

describe('TextShape — getBounds', () => {
    it('x and y match shape position', () => {
        const t = new TextShape(100, 200, 'hello');
        const b = t.getBounds();
        expect(b.x).toBe(100); expect(b.y).toBe(200);
    });

    it('width is at least 20 for empty text', () => {
        expect(new TextShape(0, 0, '').getBounds().width).toBeGreaterThanOrEqual(20);
    });

    it('height equals one lineHeight for single-line text', () => {
        const t = new TextShape(0, 0, 'hello');
        expect(t.getBounds().height).toBe(t._lineHeight());
    });

    it('height is 2× lineHeight for two-line text', () => {
        const t = new TextShape(0, 0, 'line1\nline2');
        expect(t.getBounds().height).toBe(t._lineHeight() * 2);
    });

    it('height is 3× lineHeight for three-line text', () => {
        const t = new TextShape(0, 0, 'a\nb\nc');
        expect(t.getBounds().height).toBe(t._lineHeight() * 3);
    });

    it('longer text produces greater width', () => {
        const short = new TextShape(0, 0, 'hi');
        const long  = new TextShape(0, 0, 'a much longer string here');
        expect(long.getBounds().width).toBeGreaterThan(short.getBounds().width);
    });
});

describe('TextShape — hitTest', () => {
    it('returns true when point is inside bounds', () => {
        const t = new TextShape(10, 10, 'hello'); // width=35 (5*7), height=lineHeight
        expect(t.hitTest(10, 10)).toBe(true);
    });

    it('returns false above the shape', () => {
        const t = new TextShape(10, 10, 'hello');
        expect(t.hitTest(15, 9)).toBe(false);
    });

    it('returns false to the left of the shape', () => {
        const t = new TextShape(50, 50, 'hi');
        expect(t.hitTest(49, 55)).toBe(false);
    });

    it('returns false beyond the right edge', () => {
        // width = max(2*7, 20) = 20; right edge at x=20, so x=21 misses
        const t = new TextShape(0, 0, 'hi');
        expect(t.hitTest(21, 5)).toBe(false);
    });
});

describe('TextShape — clone', () => {
    it('preserves id, x, y, text', () => {
        const t = new TextShape(10, 20, 'hello');
        const c = t.clone();
        expect(c.id).toBe(t.id);
        expect(c.x).toBe(10); expect(c.y).toBe(20);
        expect(c.text).toBe('hello');
    });

    it('preserves font properties', () => {
        const t = new TextShape(0, 0, '', 'Times', 24, 3);
        const c = t.clone();
        expect(c.fontFamily).toBe('Times');
        expect(c.fontSize).toBe(24);
        expect(c.fontStyle).toBe(3);
    });

    it('preserves locked flag', () => {
        const t = new TextShape(0, 0, '');
        t.locked = true;
        expect(t.clone().locked).toBe(true);
    });

    it('is a distinct object — mutation does not affect original', () => {
        const t = new TextShape(0, 0, 'hello');
        const c = t.clone();
        c.text = 'world';
        c.x = 999;
        expect(t.text).toBe('hello');
        expect(t.x).toBe(0);
    });
});

describe('offsetShape — TextShape', () => {
    it('adds dx and dy to x and y', () => {
        const t = new TextShape(10, 20, 'hi');
        offsetShape(t, 5, -3);
        expect(t.x).toBe(15); expect(t.y).toBe(17);
    });

    it('does not change text or font properties', () => {
        const t = new TextShape(0, 0, 'hello', 'Times', 24, 1);
        offsetShape(t, 100, 100);
        expect(t.text).toBe('hello');
        expect(t.fontFamily).toBe('Times');
        expect(t.fontSize).toBe(24);
        expect(t.fontStyle).toBe(1);
    });
});
