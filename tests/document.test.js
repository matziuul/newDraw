// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { saveDocument, loadDocument } from '../src/document.js';
import {
    RectangleShape, EllipseShape, LineShape, BezierShape,
    ArcShape, RoundRectShape, GroupShape, TextShape,
} from '../src/shapes.js';

// jsdom does not implement URL.createObjectURL / revokeObjectURL; add stubs.
beforeAll(() => {
    if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:mock';
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
});

afterEach(() => {
    URL.createObjectURL = () => 'blob:mock';
    URL.revokeObjectURL = () => {};
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function enc(obj) {
    return new TextEncoder().encode(JSON.stringify(obj)).buffer;
}

function validDoc(shapes = [], overrides = {}) {
    return enc({ version: 1, canvasWidth: 800, canvasHeight: 600, shapes, ...overrides });
}

function mockSave() {
    let capturedBlob;
    URL.createObjectURL = (b) => { capturedBlob = b; return 'blob:mock'; };
    URL.revokeObjectURL = () => {};
    return { get blob() { return capturedBlob; } };
}

async function saveAndParse(shapes, width = 800, height = 600, filename) {
    const ctx = mockSave();
    if (filename !== undefined) saveDocument(shapes, width, height, filename);
    else saveDocument(shapes, width, height);
    return JSON.parse(await ctx.blob.text());
}

async function roundTrip(shapes, width = 800, height = 600) {
    const ctx = mockSave();
    saveDocument(shapes, width, height);
    const text = await ctx.blob.text();
    return loadDocument(new TextEncoder().encode(text).buffer);
}

// ── loadDocument — errors ─────────────────────────────────────────────────────

describe('loadDocument — errors', () => {
    it('throws on invalid JSON', () => {
        expect(() => loadDocument(new TextEncoder().encode('not json').buffer)).toThrow();
    });

    it('throws when version field is missing', () => {
        expect(() => loadDocument(enc({ shapes: [] }))).toThrow('Not a MacDraw document');
    });

    it('throws on unsupported version', () => {
        expect(() => loadDocument(enc({ version: 99, shapes: [] }))).toThrow('Unsupported version: 99');
    });

    it('throws on unknown shape type', () => {
        expect(() => loadDocument(validDoc([{ type: 'triangle', id: 1, locked: false }]))).toThrow('Unknown shape type: triangle');
    });
});

// ── loadDocument — document structure ─────────────────────────────────────────

describe('loadDocument — structure', () => {
    it('returns correct canvasWidth and canvasHeight', () => {
        const { canvasWidth, canvasHeight } = loadDocument(validDoc([], { canvasWidth: 1200, canvasHeight: 900 }));
        expect(canvasWidth).toBe(1200);
        expect(canvasHeight).toBe(900);
    });

    it('returns empty shapes for empty document', () => {
        expect(loadDocument(validDoc()).shapes).toHaveLength(0);
    });

    it('falls back to empty shapes when shapes key is absent', () => {
        expect(loadDocument(enc({ version: 1, canvasWidth: 800, canvasHeight: 600 })).shapes).toHaveLength(0);
    });

    it('returns multiple shapes in order', () => {
        const data = [
            { type: 'rectangle', id: 1, locked: false, x: 0, y: 0, width: 50, height: 50, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 },
            { type: 'ellipse',   id: 2, locked: false, x: 60, y: 0, width: 40, height: 40, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 },
        ];
        const { shapes } = loadDocument(validDoc(data));
        expect(shapes).toHaveLength(2);
        expect(shapes[0].type).toBe('rectangle');
        expect(shapes[1].type).toBe('ellipse');
    });
});

// ── loadDocument — deserialization per shape type ─────────────────────────────

describe('loadDocument — rectangle', () => {
    const data = { type: 'rectangle', id: 10, locked: false, x: 10, y: 20, width: 100, height: 50, fillIdx: 3, strokeWidth: 2, strokeDash: 1, strokePatternIdx: 2 };

    it('has correct type and coordinates', () => {
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.type).toBe('rectangle');
        expect(s.x).toBe(10); expect(s.y).toBe(20);
        expect(s.width).toBe(100); expect(s.height).toBe(50);
    });

    it('has correct style properties', () => {
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.fillIdx).toBe(3);
        expect(s.strokeWidth).toBe(2);
        expect(s.strokeDash).toBe(1);
        expect(s.strokePatternIdx).toBe(2);
    });

    it('restores the id from the document', () => {
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.id).toBe(10);
    });
});

describe('loadDocument — ellipse', () => {
    it('deserializes all fields', () => {
        const data = { type: 'ellipse', id: 20, locked: false, x: 5, y: 10, width: 80, height: 40, fillIdx: 1, strokeWidth: 3, strokeDash: 0, strokePatternIdx: 3 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.type).toBe('ellipse');
        expect(s.x).toBe(5); expect(s.width).toBe(80); expect(s.height).toBe(40);
        expect(s.fillIdx).toBe(1); expect(s.strokeWidth).toBe(3);
    });
});

describe('loadDocument — roundrect', () => {
    it('deserializes cornerRadius', () => {
        const data = { type: 'roundrect', id: 30, locked: false, x: 0, y: 0, width: 60, height: 40, cornerRadius: 15, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.type).toBe('roundrect');
        expect(s.cornerRadius).toBe(15);
    });

    it('defaults cornerRadius to 10 when absent', () => {
        const data = { type: 'roundrect', id: 31, locked: false, x: 0, y: 0, width: 60, height: 40, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.cornerRadius).toBe(10);
    });
});

describe('loadDocument — line', () => {
    it('deserializes endpoints and arrowMode', () => {
        const data = { type: 'line', id: 40, locked: false, x1: 10, y1: 20, x2: 110, y2: 80, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3, arrowMode: 2 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.type).toBe('line');
        expect(s.x1).toBe(10); expect(s.y1).toBe(20);
        expect(s.x2).toBe(110); expect(s.y2).toBe(80);
        expect(s.arrowMode).toBe(2);
    });

    it('defaults arrowMode to 0 when absent', () => {
        const data = { type: 'line', id: 41, locked: false, x1: 0, y1: 0, x2: 100, y2: 100, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.arrowMode).toBe(0);
    });
});

describe('loadDocument — bezier', () => {
    const pts = [
        { x: 0, y: 0, c1x: 0, c1y: 0, c2x: 10, c2y: -10 },
        { x: 100, y: 50, c1x: 80, c1y: 40, c2x: 100, c2y: 50 },
    ];
    const data = { type: 'bezier', id: 50, locked: false, points: pts, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3, arrowMode: 1 };

    it('deserializes points and handles', () => {
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.type).toBe('bezier');
        expect(s.points).toHaveLength(2);
        expect(s.points[0].c2x).toBe(10);
        expect(s.points[0].c2y).toBe(-10);
        expect(s.points[1].x).toBe(100);
    });

    it('deserializes arrowMode', () => {
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.arrowMode).toBe(1);
    });

    it('deep-copies points (not shared references)', () => {
        const { shapes: [s] } = loadDocument(validDoc([data]));
        s.points[0].x = 999;
        expect(pts[0].x).toBe(0);
    });
});

describe('loadDocument — arc', () => {
    it('deserializes quadrant', () => {
        const data = { type: 'arc', id: 60, locked: false, x: 20, y: 20, width: 80, height: 60, quadrant: 3, fillIdx: 2, strokeWidth: 1, strokeDash: 0, strokePatternIdx: 3 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.type).toBe('arc');
        expect(s.quadrant).toBe(3);
    });

    it('defaults quadrant to 1 when absent', () => {
        const data = { type: 'arc', id: 61, locked: false, x: 0, y: 0, width: 80, height: 60, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.quadrant).toBe(1);
    });
});

describe('loadDocument — group', () => {
    it('deserializes children', () => {
        const children = [
            { type: 'rectangle', id: 71, locked: false, x: 0, y: 0, width: 50, height: 50, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 },
            { type: 'ellipse',   id: 72, locked: false, x: 60, y: 0, width: 40, height: 40, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 },
        ];
        const data = { type: 'group', id: 70, locked: false, children };
        const { shapes: [g] } = loadDocument(validDoc([data]));
        expect(g.type).toBe('group');
        expect(g.children).toHaveLength(2);
        expect(g.children[0].type).toBe('rectangle');
        expect(g.children[1].type).toBe('ellipse');
    });

    it('deserializes nested groups', () => {
        const inner = { type: 'rectangle', id: 80, locked: false, x: 0, y: 0, width: 50, height: 50, fillIdx: 0, strokeWidth: 2, strokeDash: 0, strokePatternIdx: 3 };
        const data = { type: 'group', id: 81, locked: false, children: [{ type: 'group', id: 82, locked: false, children: [inner] }] };
        const { shapes: [g] } = loadDocument(validDoc([data]));
        expect(g.children[0].type).toBe('group');
        expect(g.children[0].children[0].type).toBe('rectangle');
    });
});

describe('loadDocument — text', () => {
    it('deserializes text content and font properties', () => {
        const data = { type: 'text', id: 90, locked: false, x: 50, y: 100, text: 'Hello', fontFamily: 'Times', fontSize: 24, fontStyle: 3, fillIdx: 0, strokeWidth: 0 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.type).toBe('text');
        expect(s.text).toBe('Hello');
        expect(s.fontFamily).toBe('Times');
        expect(s.fontSize).toBe(24);
        expect(s.fontStyle).toBe(3);
    });

    it('defaults text to empty string when absent', () => {
        const data = { type: 'text', id: 91, locked: false, x: 0, y: 0, fontFamily: 'Geneva', fontSize: 12, fontStyle: 0, fillIdx: 0, strokeWidth: 0 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.text).toBe('');
    });
});

// ── loadDocument — shared default values ──────────────────────────────────────

describe('loadDocument — shared defaults', () => {
    const base = { type: 'rectangle', id: 100, x: 0, y: 0, width: 50, height: 50 };

    it('locked defaults to false', () => {
        const { shapes: [s] } = loadDocument(validDoc([base]));
        expect(s.locked).toBe(false);
    });

    it('fillIdx defaults to 0', () => {
        const { shapes: [s] } = loadDocument(validDoc([base]));
        expect(s.fillIdx).toBe(0);
    });

    it('strokeWidth defaults to 2 for non-text shapes', () => {
        const { shapes: [s] } = loadDocument(validDoc([base]));
        expect(s.strokeWidth).toBe(2);
    });

    it('strokeWidth defaults to 0 for text', () => {
        const data = { type: 'text', id: 101, locked: false, x: 0, y: 0, text: 'hi', fontFamily: 'Geneva', fontSize: 12, fontStyle: 0, fillIdx: 0 };
        const { shapes: [s] } = loadDocument(validDoc([data]));
        expect(s.strokeWidth).toBe(0);
    });

    it('strokeDash defaults to 0', () => {
        const { shapes: [s] } = loadDocument(validDoc([base]));
        expect(s.strokeDash).toBe(0);
    });

    it('strokePatternIdx defaults to 3', () => {
        const { shapes: [s] } = loadDocument(validDoc([base]));
        expect(s.strokePatternIdx).toBe(3);
    });

    it('restores locked=true', () => {
        const { shapes: [s] } = loadDocument(validDoc([{ ...base, id: 102, locked: true }]));
        expect(s.locked).toBe(true);
    });
});

// ── saveDocument ──────────────────────────────────────────────────────────────

describe('saveDocument', () => {
    it('creates a blob containing JSON with version 1', async () => {
        const doc = await saveAndParse([]);
        expect(doc.version).toBe(1);
    });

    it('stores canvasWidth and canvasHeight in the blob', async () => {
        const doc = await saveAndParse([], 1024, 768);
        expect(doc.canvasWidth).toBe(1024);
        expect(doc.canvasHeight).toBe(768);
    });

    it('serializes shapes into the blob', async () => {
        const rect = new RectangleShape(10, 20, 100, 50);
        const doc = await saveAndParse([rect]);
        expect(doc.shapes).toHaveLength(1);
        expect(doc.shapes[0].type).toBe('rectangle');
        expect(doc.shapes[0].x).toBe(10);
    });

    it('uses "drawing.mcd" as the default download filename', () => {
        let downloadName;
        const origAppend = document.body.appendChild.bind(document.body);
        vi.spyOn(document.body, 'appendChild').mockImplementation(el => {
            if (el instanceof HTMLAnchorElement) downloadName = el.download;
            return origAppend(el);
        });
        mockSave();
        saveDocument([], 800, 600);
        vi.restoreAllMocks();
        expect(downloadName).toBe('drawing.mcd');
    });

    it('uses a custom filename when provided', () => {
        let downloadName;
        const origAppend = document.body.appendChild.bind(document.body);
        vi.spyOn(document.body, 'appendChild').mockImplementation(el => {
            if (el instanceof HTMLAnchorElement) downloadName = el.download;
            return origAppend(el);
        });
        mockSave();
        saveDocument([], 800, 600, 'my-drawing.mcd');
        vi.restoreAllMocks();
        expect(downloadName).toBe('my-drawing.mcd');
    });

    it('revokes the object URL after the click', () => {
        let revokedUrl;
        URL.createObjectURL = () => 'blob:test-url';
        URL.revokeObjectURL = (u) => { revokedUrl = u; };
        saveDocument([], 800, 600);
        expect(revokedUrl).toBe('blob:test-url');
    });

    it('serializes line arrowMode', async () => {
        const line = new LineShape(0, 0, 100, 100);
        line.arrowMode = 3;
        const doc = await saveAndParse([line]);
        expect(doc.shapes[0].arrowMode).toBe(3);
    });

    it('serializes group children recursively', async () => {
        const child = new RectangleShape(0, 0, 50, 50);
        const group = new GroupShape([child]);
        const doc = await saveAndParse([group]);
        expect(doc.shapes[0].type).toBe('group');
        expect(doc.shapes[0].children).toHaveLength(1);
        expect(doc.shapes[0].children[0].type).toBe('rectangle');
    });

    it('serializes bezier points and handles', async () => {
        const pts = [
            { x: 0, y: 0, c1x: 0, c1y: 0, c2x: 10, c2y: -10 },
            { x: 100, y: 0, c1x: 90, c1y: 5, c2x: 100, c2y: 0 },
        ];
        const doc = await saveAndParse([new BezierShape(pts)]);
        expect(doc.shapes[0].points[0].c2y).toBe(-10);
    });
});

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('round-trip', () => {
    it('preserves all rectangle properties', async () => {
        const orig = new RectangleShape(10, 20, 100, 50);
        orig.fillIdx = 3; orig.strokeWidth = 4; orig.strokeDash = 2; orig.strokePatternIdx = 1; orig.locked = true;
        const { shapes: [s] } = await roundTrip([orig]);
        expect(s.type).toBe('rectangle');
        expect(s.x).toBe(10); expect(s.y).toBe(20);
        expect(s.width).toBe(100); expect(s.height).toBe(50);
        expect(s.fillIdx).toBe(3); expect(s.strokeWidth).toBe(4);
        expect(s.strokeDash).toBe(2); expect(s.strokePatternIdx).toBe(1);
        expect(s.locked).toBe(true);
        expect(s.id).toBe(orig.id);
    });

    it('preserves roundrect cornerRadius', async () => {
        const orig = new RoundRectShape(0, 0, 80, 60);
        orig.cornerRadius = 20;
        const { shapes: [s] } = await roundTrip([orig]);
        expect(s.cornerRadius).toBe(20);
    });

    it('preserves line endpoints and arrowMode', async () => {
        const orig = new LineShape(10, 20, 110, 80);
        orig.arrowMode = 1;
        const { shapes: [s] } = await roundTrip([orig]);
        expect(s.x1).toBe(10); expect(s.y1).toBe(20);
        expect(s.x2).toBe(110); expect(s.y2).toBe(80);
        expect(s.arrowMode).toBe(1);
    });

    it('preserves bezier points including control handles', async () => {
        const pts = [
            { x: 0, y: 0, c1x: 0, c1y: 0, c2x: 10, c2y: -10 },
            { x: 100, y: 50, c1x: 80, c1y: 40, c2x: 100, c2y: 50 },
        ];
        const orig = new BezierShape(pts);
        const { shapes: [s] } = await roundTrip([orig]);
        expect(s.points).toHaveLength(2);
        expect(s.points[0].c2x).toBe(10); expect(s.points[0].c2y).toBe(-10);
        expect(s.points[1].x).toBe(100);
    });

    it('preserves arc quadrant', async () => {
        const orig = new ArcShape(0, 0, 100, 80);
        orig.quadrant = 2;
        const { shapes: [s] } = await roundTrip([orig]);
        expect(s.quadrant).toBe(2);
    });

    it('preserves group with children', async () => {
        const c1 = new RectangleShape(0, 0, 50, 50);
        const c2 = new EllipseShape(60, 0, 40, 40);
        const { shapes: [g] } = await roundTrip([new GroupShape([c1, c2])]);
        expect(g.type).toBe('group');
        expect(g.children[0].type).toBe('rectangle');
        expect(g.children[1].type).toBe('ellipse');
    });

    it('preserves text content and font', async () => {
        const orig = new TextShape(50, 100, 'Hello world', 'Times', 24, 3);
        const { shapes: [s] } = await roundTrip([orig]);
        expect(s.text).toBe('Hello world');
        expect(s.fontFamily).toBe('Times');
        expect(s.fontSize).toBe(24);
        expect(s.fontStyle).toBe(3);
    });

    it('preserves multiple shapes in order', async () => {
        const r = new RectangleShape(0, 0, 50, 50);
        const e = new EllipseShape(100, 0, 50, 50);
        const { shapes } = await roundTrip([r, e]);
        expect(shapes).toHaveLength(2);
        expect(shapes[0].type).toBe('rectangle');
        expect(shapes[1].type).toBe('ellipse');
    });

    it('preserves canvas dimensions', async () => {
        const { canvasWidth, canvasHeight } = await roundTrip([], 1440, 900);
        expect(canvasWidth).toBe(1440);
        expect(canvasHeight).toBe(900);
    });
});
