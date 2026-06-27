import { describe, it, expect, beforeAll } from 'vitest';
import { importMacFile } from '../src/import.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFile(name) {
    const buf = readFileSync(resolve(__dirname, '..', 'testfiles', name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ── Unknown format ─────────────────────────────────────────────────────────────
// No test file exists for this case — minimal synthetic buffer only.

describe('importMacFile — unknown format', () => {
    const unknownBuf = new Uint8Array([0xDE,0xAD,0xBE,0xEF,0,0,0,0,0,0,0,0,0,0]).buffer;

    it('throws for a buffer with no recognized signature', () => {
        expect(() => importMacFile(unknownBuf)).toThrow('Unrecognized format');
    });

    it('error message mentions PICT and MacDraw II', () => {
        expect(() => importMacFile(unknownBuf)).toThrow(/PICT.*MacDraw/);
    });
});

// ── linehoriz.drw ─────────────────────────────────────────────────────────────

describe('linehoriz.drw — horizontal line', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('linehoriz.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a line', () => expect(result.shapes[0].type).toBe('line'));
    it('is horizontal (y1 === y2)', () => {
        const s = result.shapes[0];
        expect(s.y1).toBe(s.y2);
    });
    it('goes left to right', () => {
        const s = result.shapes[0];
        expect(s.x2).toBeGreaterThan(s.x1);
    });
    it('has endpoints (96,48) → (192,48)', () => {
        const s = result.shapes[0];
        expect(s.x1).toBe(96); expect(s.y1).toBe(48);
        expect(s.x2).toBe(192); expect(s.y2).toBe(48);
    });
});

// ── linehoriz.pict ────────────────────────────────────────────────────────────
// MacDraw II file with an embedded PICT at the 512-byte mark.

describe('linehoriz.pict — horizontal line in embedded PICT', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('linehoriz.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a line', () => expect(result.shapes[0].type).toBe('line'));
    it('is horizontal (y1 === y2)', () => {
        const s = result.shapes[0];
        expect(s.y1).toBe(s.y2);
    });
    it('has endpoints (96,48) → (192,48)', () => {
        const s = result.shapes[0];
        expect(s.x1).toBe(96); expect(s.y1).toBe(48);
        expect(s.x2).toBe(192); expect(s.y2).toBe(48);
    });
});

// ── linehoriz drw/pict coordinate agreement ───────────────────────────────────

describe('linehoriz — drw and pict produce identical coordinates', () => {
    it('line start matches', () => {
        const drw  = importMacFile(loadFile('linehoriz.drw')).shapes[0];
        const pict = importMacFile(loadFile('linehoriz.pict')).shapes[0];
        expect(pict.x1).toBe(drw.x1);
        expect(pict.y1).toBe(drw.y1);
    });
    it('line end matches', () => {
        const drw  = importMacFile(loadFile('linehoriz.drw')).shapes[0];
        const pict = importMacFile(loadFile('linehoriz.pict')).shapes[0];
        expect(pict.x2).toBe(drw.x2);
        expect(pict.y2).toBe(drw.y2);
    });
});

// ── lineleftright.drw ────────────────────────────────────────────────────────

describe('lineleftright.drw — diagonal line top-left to bottom-right', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('lineleftright.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a line', () => expect(result.shapes[0].type).toBe('line'));
    it('goes top-left to bottom-right', () => {
        const s = result.shapes[0];
        expect(s.x2).toBeGreaterThan(s.x1);
        expect(s.y2).toBeGreaterThan(s.y1);
    });
    it('has endpoints (48,48) → (144,144)', () => {
        const s = result.shapes[0];
        expect(s.x1).toBe(48); expect(s.y1).toBe(48);
        expect(s.x2).toBe(144); expect(s.y2).toBe(144);
    });
});

// ── lineleftright.pict ───────────────────────────────────────────────────────

describe('lineleftright.pict — diagonal line in embedded PICT', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('lineleftright.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a line', () => expect(result.shapes[0].type).toBe('line'));
    it('has endpoints (48,48) → (144,144)', () => {
        const s = result.shapes[0];
        expect(s.x1).toBe(48); expect(s.y1).toBe(48);
        expect(s.x2).toBe(144); expect(s.y2).toBe(144);
    });
});

// ── lineleftright drw/pict coordinate agreement ──────────────────────────────

describe('lineleftright — drw and pict produce identical coordinates', () => {
    it('line start matches', () => {
        const drw  = importMacFile(loadFile('lineleftright.drw')).shapes[0];
        const pict = importMacFile(loadFile('lineleftright.pict')).shapes[0];
        expect(pict.x1).toBe(drw.x1);
        expect(pict.y1).toBe(drw.y1);
    });
    it('line end matches', () => {
        const drw  = importMacFile(loadFile('lineleftright.drw')).shapes[0];
        const pict = importMacFile(loadFile('lineleftright.pict')).shapes[0];
        expect(pict.x2).toBe(drw.x2);
        expect(pict.y2).toBe(drw.y2);
    });
});

// ── linerightleft.drw ────────────────────────────────────────────────────────

describe('linerightleft.drw — diagonal line top-right to bottom-left', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('linerightleft.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a line', () => expect(result.shapes[0].type).toBe('line'));
    it('goes top-right to bottom-left', () => {
        const s = result.shapes[0];
        expect(s.x2).toBeLessThan(s.x1);
        expect(s.y2).toBeGreaterThan(s.y1);
    });
    it('has endpoints (192,48) → (96,144)', () => {
        const s = result.shapes[0];
        expect(s.x1).toBe(192); expect(s.y1).toBe(48);
        expect(s.x2).toBe(96); expect(s.y2).toBe(144);
    });
});

// ── circletrans.drw ──────────────────────────────────────────────────────────

describe('circletrans.drw — transparent circle', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('circletrans.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is an ellipse', () => expect(result.shapes[0].type).toBe('ellipse'));
    it('is a circle (width === height)', () => {
        const s = result.shapes[0];
        expect(s.width).toBe(s.height);
    });
    it('has no fill (transparent)', () => expect(result.shapes[0].fillIdx).toBe(0));
    it('has bounds (96,96) 97×97', () => {
        const s = result.shapes[0];
        expect(s.x).toBe(96); expect(s.y).toBe(96);
        expect(s.width).toBe(97); expect(s.height).toBe(97);
    });
});

// ── circletrans.pict ─────────────────────────────────────────────────────────

describe('circletrans.pict — transparent circle in embedded PICT', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('circletrans.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is an ellipse', () => expect(result.shapes[0].type).toBe('ellipse'));
    it('has no fill (transparent)', () => expect(result.shapes[0].fillIdx).toBe(0));
    it('has bounds (96,96) 97×97', () => {
        const s = result.shapes[0];
        expect(s.x).toBe(96); expect(s.y).toBe(96);
        expect(s.width).toBe(97); expect(s.height).toBe(97);
    });
});

// ── circletrans drw/pict coordinate agreement ────────────────────────────────

describe('circletrans — drw and pict produce identical coordinates', () => {
    it('position matches', () => {
        const drw  = importMacFile(loadFile('circletrans.drw')).shapes[0];
        const pict = importMacFile(loadFile('circletrans.pict')).shapes[0];
        expect(pict.x).toBe(drw.x);
        expect(pict.y).toBe(drw.y);
    });
    it('size matches', () => {
        const drw  = importMacFile(loadFile('circletrans.drw')).shapes[0];
        const pict = importMacFile(loadFile('circletrans.pict')).shapes[0];
        expect(pict.width).toBe(drw.width);
        expect(pict.height).toBe(drw.height);
    });
});

// ── ellipstrans.drw / ellipstrans.pict ───────────────────────────────────────
// Identical binary to circletrans — verifies both names parse consistently.

describe('ellipstrans.drw — same binary as circletrans.drw', () => {
    it('produces 1 transparent ellipse (96,96) 97×97', () => {
        const result = importMacFile(loadFile('ellipstrans.drw'));
        expect(result.format).toBe('MacDraw II');
        const s = result.shapes[0];
        expect(s.type).toBe('ellipse');
        expect(s.fillIdx).toBe(0);
        expect(s.width).toBe(97); expect(s.height).toBe(97);
    });
});

describe('ellipstrans.pict — same binary as circletrans.pict', () => {
    it('produces 1 transparent ellipse in PICT format', () => {
        const result = importMacFile(loadFile('ellipstrans.pict'));
        expect(result.format).toBe('PICT');
        expect(result.shapes[0].type).toBe('ellipse');
        expect(result.shapes[0].fillIdx).toBe(0);
    });
});

// ── arc.drw ──────────────────────────────────────────────────────────────────

describe('arc.drw — quarter arc', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('arc.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is an arc', () => expect(result.shapes[0].type).toBe('arc'));
    it('is in quadrant 0 (top-right)', () => expect(result.shapes[0].quadrant).toBe(0));
    it('has bounds (0,96) 193×193', () => {
        const s = result.shapes[0];
        expect(s.x).toBe(0); expect(s.y).toBe(96);
        expect(s.width).toBe(193); expect(s.height).toBe(193);
    });
});

// ── arc.pict ─────────────────────────────────────────────────────────────────

describe('arc.pict — quarter arc in embedded PICT', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('arc.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is an arc', () => expect(result.shapes[0].type).toBe('arc'));
    it('is in quadrant 0 (top-right)', () => expect(result.shapes[0].quadrant).toBe(0));
    it('has bounds (0,96) 193×193', () => {
        const s = result.shapes[0];
        expect(s.x).toBe(0); expect(s.y).toBe(96);
        expect(s.width).toBe(193); expect(s.height).toBe(193);
    });
});

// ── arc drw/pict coordinate agreement ───────────────────────────────────────

describe('arc — drw and pict produce identical coordinates', () => {
    it('position matches', () => {
        const drw  = importMacFile(loadFile('arc.drw')).shapes[0];
        const pict = importMacFile(loadFile('arc.pict')).shapes[0];
        expect(pict.x).toBe(drw.x);
        expect(pict.y).toBe(drw.y);
    });
    it('size matches', () => {
        const drw  = importMacFile(loadFile('arc.drw')).shapes[0];
        const pict = importMacFile(loadFile('arc.pict')).shapes[0];
        expect(pict.width).toBe(drw.width);
        expect(pict.height).toBe(drw.height);
    });
});

// ── freehand.pict ─────────────────────────────────────────────────────────────
// Freehand polygon stored as a PICT polygon opcode; readPoly converts to BezierShape.

describe('freehand.pict — freehand polygon as bezier', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('freehand.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces 1 bezier shape', () => expect(result.shapes).toHaveLength(1));
    it('shape is a bezier', () => expect(result.shapes[0].type).toBe('bezier'));
    it('bezier has 85 points (84 segments + closing)', () => {
        expect(result.shapes[0].points).toHaveLength(85);
    });
});

// ── freehand.drw — freehand stroke approximated as bezier ────────────────────

describe('freehand.drw — freehand stroke converted to BezierShape', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('freehand.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a bezier', () => expect(result.shapes[0].type).toBe('bezier'));
    it('has multiple points (Catmull-Rom approximation)', () => {
        expect(result.shapes[0].points.length).toBeGreaterThan(1);
    });
    it('has strokeWidth 1 (original pen width)', () => {
        expect(result.shapes[0].strokeWidth).toBe(1);
    });
});

// ── roundrectgreythickgrey.drw ────────────────────────────────────────────────

describe('roundrectgreythickgrey.drw — grey-filled, thick, grey-stroked rounded rect', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('roundrectgreythickgrey.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a roundrect', () => expect(result.shapes[0].type).toBe('roundrect'));
    it('has grey fill (index 5)', () => expect(result.shapes[0].fillIdx).toBe(5));
    it('has grey stroke pattern (index 4, mörk)', () => expect(result.shapes[0].strokePatternIdx).toBe(4));
    it('has thick stroke (4pt)', () => expect(result.shapes[0].strokeWidth).toBe(4));
    it('has bounds (96,96) 192×96', () => {
        const s = result.shapes[0];
        expect(s.x).toBe(96); expect(s.y).toBe(96);
        expect(s.width).toBe(192); expect(s.height).toBe(96);
    });
});

// ── roundrectgreythickgrey.pict ──────────────────────────────────────────────

describe('roundrectgreythickgrey.pict — grey-filled, thick, grey-stroked rounded rect in PICT', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('roundrectgreythickgrey.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a roundrect', () => expect(result.shapes[0].type).toBe('roundrect'));
    it('has grey fill (index 5)', () => expect(result.shapes[0].fillIdx).toBe(5));
    it('has grey stroke pattern (index 4, mörk)', () => expect(result.shapes[0].strokePatternIdx).toBe(4));
    it('has thick stroke (4pt)', () => expect(result.shapes[0].strokeWidth).toBe(4));
    it('has corner radius 13', () => expect(result.shapes[0].cornerRadius).toBe(13));
    it('has bounds (96,96) 192×96', () => {
        const s = result.shapes[0];
        expect(s.x).toBe(96); expect(s.y).toBe(96);
        expect(s.width).toBe(192); expect(s.height).toBe(96);
    });
});

// ── roundrectgreythickgrey drw/pict agreement ────────────────────────────────

describe('roundrectgreythickgrey — drw and pict agree', () => {
    let drw, pict;
    beforeAll(() => {
        drw  = importMacFile(loadFile('roundrectgreythickgrey.drw')).shapes[0];
        pict = importMacFile(loadFile('roundrectgreythickgrey.pict')).shapes[0];
    });
    it('strokeWidth matches',      () => expect(pict.strokeWidth).toBe(drw.strokeWidth));
    it('strokePatternIdx matches', () => expect(pict.strokePatternIdx).toBe(drw.strokePatternIdx));
    it('fillIdx matches',          () => expect(pict.fillIdx).toBe(drw.fillIdx));
    it('x matches',                () => expect(pict.x).toBe(drw.x));
    it('y matches',                () => expect(pict.y).toBe(drw.y));
    it('width matches',            () => expect(pict.width).toBe(drw.width));
    it('height matches',           () => expect(pict.height).toBe(drw.height));
    it('cornerRadius matches',     () => expect(pict.cornerRadius).toBe(drw.cornerRadius));
});

// ── 2whitecircles.drw ────────────────────────────────────────────────────────
// Two white-filled circles. Previously imported as rectangles because the DRW
// type byte 0x02 (white fill) hit the rectangle fallback in the switch instead
// of using shapeTypeCode 0x06 (ellipse).

describe('2whitecircles.drw — two white-filled circles', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('2whitecircles.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 2 shapes', () => expect(result.shapes).toHaveLength(2));
    it('both shapes are ellipses (not rectangles)', () => {
        expect(result.shapes.every(s => s.type === 'ellipse')).toBe(true);
    });
    it('both have white fill (index 1)', () => {
        expect(result.shapes.every(s => s.fillIdx === 1)).toBe(true);
    });
    it('both are 97×97', () => {
        expect(result.shapes.every(s => s.width === 97 && s.height === 97)).toBe(true);
    });
    it('first circle at (96,96)', () => {
        expect(result.shapes[0].x).toBe(96); expect(result.shapes[0].y).toBe(96);
    });
    it('second circle at (288,96)', () => {
        expect(result.shapes[1].x).toBe(288); expect(result.shapes[1].y).toBe(96);
    });
});

// ── 2whitecircles.pict ───────────────────────────────────────────────────────

describe('2whitecircles.pict — two white-filled circles in PICT', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('2whitecircles.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 2 shapes', () => expect(result.shapes).toHaveLength(2));
    it('both shapes are ellipses', () => {
        expect(result.shapes.every(s => s.type === 'ellipse')).toBe(true);
    });
    it('both have white fill (index 1)', () => {
        expect(result.shapes.every(s => s.fillIdx === 1)).toBe(true);
    });
    it('both are 97×97', () => {
        expect(result.shapes.every(s => s.width === 97 && s.height === 97)).toBe(true);
    });
    it('first circle at (96,96)', () => {
        expect(result.shapes[0].x).toBe(96); expect(result.shapes[0].y).toBe(96);
    });
    it('second circle at (288,96)', () => {
        expect(result.shapes[1].x).toBe(288); expect(result.shapes[1].y).toBe(96);
    });
});

// ── 2whitecircles drw/pict agreement ─────────────────────────────────────────

describe('2whitecircles — drw and pict produce identical positions and sizes', () => {
    it('first circle matches', () => {
        const drw  = importMacFile(loadFile('2whitecircles.drw')).shapes[0];
        const pict = importMacFile(loadFile('2whitecircles.pict')).shapes[0];
        expect(pict.x).toBe(drw.x); expect(pict.y).toBe(drw.y);
        expect(pict.width).toBe(drw.width); expect(pict.height).toBe(drw.height);
    });
    it('second circle matches', () => {
        const drw  = importMacFile(loadFile('2whitecircles.drw')).shapes[1];
        const pict = importMacFile(loadFile('2whitecircles.pict')).shapes[1];
        expect(pict.x).toBe(drw.x); expect(pict.y).toBe(drw.y);
        expect(pict.width).toBe(drw.width); expect(pict.height).toBe(drw.height);
    });
});

// ── 2whitecirclesgrouped.drw ─────────────────────────────────────────────────
// Same two white circles as 2whitecircles.drw, but saved as a group.
// The group record has shapeTypeCode=0x0a and inline children; a false positive
// in the group metadata bytes blocks the scanner from finding child 1, so the
// group is parsed directly from the byte range using the embedded child count.

describe('2whitecirclesgrouped.drw — two white circles in a group', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('2whitecirclesgrouped.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 top-level shape', () => expect(result.shapes).toHaveLength(1));
    it('top-level shape is a group', () => expect(result.shapes[0].type).toBe('group'));
    it('group contains exactly 2 children', () => expect(result.shapes[0].children).toHaveLength(2));
    it('both children are ellipses', () => {
        expect(result.shapes[0].children.every(c => c.type === 'ellipse')).toBe(true);
    });
    it('both children have white fill (index 1)', () => {
        expect(result.shapes[0].children.every(c => c.fillIdx === 1)).toBe(true);
    });
    it('both children are 97×97', () => {
        expect(result.shapes[0].children.every(c => c.width === 97 && c.height === 97)).toBe(true);
    });
    it('first child at (96,96)', () => {
        const c = result.shapes[0].children[0];
        expect(c.x).toBe(96); expect(c.y).toBe(96);
    });
    it('second child at (288,96)', () => {
        const c = result.shapes[0].children[1];
        expect(c.x).toBe(288); expect(c.y).toBe(96);
    });
    it('group children match ungrouped positions and sizes', () => {
        const grouped  = importMacFile(loadFile('2whitecirclesgrouped.drw')).shapes[0].children;
        const flat     = importMacFile(loadFile('2whitecircles.drw')).shapes;
        for (let i = 0; i < 2; i++) {
            expect(grouped[i].x).toBe(flat[i].x);
            expect(grouped[i].y).toBe(flat[i].y);
            expect(grouped[i].width).toBe(flat[i].width);
            expect(grouped[i].height).toBe(flat[i].height);
        }
    });
});

// ── 4circlesgrouped.drw ──────────────────────────────────────────────────────
// Four circles with different fills (transparent/white/grey/black) in one group.
// Verifies that the typed-group parser handles all fill variants correctly:
// fill types 0x01/0x02/0x05/0x03 must all produce ellipses, not fall through
// to arc/rectangle/roundrect in the type-byte switch.

describe('4circlesgrouped.drw — four circles with different fills in a group', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('4circlesgrouped.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 top-level shape', () => expect(result.shapes).toHaveLength(1));
    it('top-level shape is a group', () => expect(result.shapes[0].type).toBe('group'));
    it('group contains exactly 4 children', () => expect(result.shapes[0].children).toHaveLength(4));
    it('all children are ellipses', () => {
        expect(result.shapes[0].children.every(c => c.type === 'ellipse')).toBe(true);
    });
    it('all children are 97×97', () => {
        expect(result.shapes[0].children.every(c => c.width === 97 && c.height === 97)).toBe(true);
    });

    const fills  = [0, 1, 5, 3];  // transparent, white, grey, black
    const xPos   = [96, 288, 480, 672];

    it('fill indices are transparent/white/grey/black', () => {
        result.shapes[0].children.forEach((c, i) => expect(c.fillIdx).toBe(fills[i]));
    });
    it('x-positions follow column grid', () => {
        result.shapes[0].children.forEach((c, i) => expect(c.x).toBe(xPos[i]));
    });
    it('all children at y=96', () => {
        expect(result.shapes[0].children.every(c => c.y === 96)).toBe(true);
    });
});

// ── 3circlegroupsof4.drw ─────────────────────────────────────────────────────
// Three groups, each containing 4 ellipses. Groups are separated by 8-byte
// terminator records that sit only 8 bytes before the next group header.
// The global 24-byte-gap scanner rule blocks the 2nd and 3rd group headers,
// so the typed-group pass scans raw bytes for 0x0a markers instead.

describe('3circlegroupsof4.drw — three groups of four circles', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('3circlegroupsof4.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 3 top-level shapes', () => expect(result.shapes).toHaveLength(3));
    it('all top-level shapes are groups', () => {
        expect(result.shapes.every(s => s.type === 'group')).toBe(true);
    });
    it('each group contains exactly 4 children', () => {
        expect(result.shapes.every(s => s.children.length === 4)).toBe(true);
    });
    it('all children are ellipses', () => {
        const all = result.shapes.flatMap(s => s.children);
        expect(all.every(c => c.type === 'ellipse')).toBe(true);
    });
    it('all children are 25×25', () => {
        const all = result.shapes.flatMap(s => s.children);
        expect(all.every(c => c.width === 25 && c.height === 25)).toBe(true);
    });
    it('group 0 children all have fillIdx 17', () => {
        expect(result.shapes[0].children.every(c => c.fillIdx === 17)).toBe(true);
    });
    it('group 1 children all have fillIdx 4', () => {
        expect(result.shapes[1].children.every(c => c.fillIdx === 4)).toBe(true);
    });
    it('group 2 children all have fillIdx 15', () => {
        expect(result.shapes[2].children.every(c => c.fillIdx === 15)).toBe(true);
    });
});

// ── ManualExamplenostrings.drw ───────────────────────────────────────────────
let manualResult;
describe('ManualExamplenostrings.drw — text coordinates', () => {
    beforeAll(() => { manualResult = importMacFile(loadFile('ManualExamplenostrings.drw')); });
    it('imports successfully', () => { expect(manualResult.shapes.length).toBeGreaterThan(0); });
    it('contains 4 text shapes', () => {
        const texts = manualResult.shapes.filter(s => s.type === 'text');
        expect(texts.length).toBe(4);
    });
    it('"662-2700" at x=240, y=104', () => {
        const t = manualResult.shapes.find(s => s.type === 'text' && s.text === '662-2700');
        expect(t).toBeDefined();
        expect(t.x).toBe(240);
        expect(t.y).toBe(104);
    });
    it('"Ryan\'s Express" at x=252, y=68', () => {
        const t = manualResult.shapes.find(s => s.type === 'text' && s.text.startsWith("Ryan's Express"));
        expect(t).toBeDefined();
        expect(t.x).toBe(252);
        expect(t.y).toBe(68);
    });
    it('"Balloon Bouquets" at x=252, y≈145.3', () => {
        const t = manualResult.shapes.find(s => s.type === 'text' && s.text.startsWith('Balloon Bouquets'));
        expect(t).toBeDefined();
        expect(t.x).toBe(252);
        expect(t.y).toBeCloseTo(145.33, 1);
    });
    it('"This example" at x≈102.7, y≈253.3', () => {
        const t = manualResult.shapes.find(s => s.type === 'text' && s.text.startsWith('This example'));
        expect(t).toBeDefined();
        expect(t.x).toBeCloseTo(102.67, 1);
        expect(t.y).toBeCloseTo(253.33, 1);
    });
});

// ── 3circlegroupsof4.pict ────────────────────────────────────────────────────
// PICT does not encode grouping; all 12 ellipses are emitted flat.

describe('3circlegroupsof4.pict — twelve circles flat (PICT has no groups)', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('3circlegroupsof4.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 12 shapes', () => expect(result.shapes).toHaveLength(12));
    it('all shapes are ellipses', () => {
        expect(result.shapes.every(s => s.type === 'ellipse')).toBe(true);
    });
});

// ── hardbezier.drw ───────────────────────────────────────────────────────────
// Bezier with actual curvature; parsed as straight-segment BezierShape (handles ignored).

describe('hardbezier.drw — curved bezier imported as straight BezierShape', () => {
    it('detects MacDraw II format and produces 1 bezier shape', () => {
        const result = importMacFile(loadFile('hardbezier.drw'));
        expect(result.format).toBe('MacDraw II');
        expect(result.shapes).toHaveLength(1);
        expect(result.shapes[0].type).toBe('bezier');
        expect(result.shapes[0].points).toHaveLength(4);
    });
});

// ── 16rect.drw ───────────────────────────────────────────────────────────────
// 4×4 grid: columns = stroke widths 1–4, rows = fills transparent/white/grey/black

describe('16rect.drw — 4×4 rectangle grid', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('16rect.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 16 shapes', () => expect(result.shapes).toHaveLength(16));
    it('all shapes are rectangles', () => {
        expect(result.shapes.every(s => s.type === 'rectangle')).toBe(true);
    });
    it('all shapes are 97×97', () => {
        expect(result.shapes.every(s => s.width === 97 && s.height === 97)).toBe(true);
    });

    // Column x-positions (stroke width cols 1–4)
    const xCols = [96, 288, 480, 672];
    // Row y-positions
    const yRows = [48, 192, 336, 480];
    // Row fill indices: transparent, white, grey, black
    const fills = [0, 1, 5, 3];
    // Column stroke widths from DRW (bytes[o+0]-1)
    const strokeWidths = [1, 2, 3, 4];

    it('x-positions follow column grid', () => {
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                expect(result.shapes[row * 4 + col].x).toBe(xCols[col]);
            }
        }
    });
    it('y-positions follow row grid', () => {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                expect(result.shapes[row * 4 + col].y).toBe(yRows[row]);
            }
        }
    });
    it('fill indices follow row pattern (transparent/white/grey/black)', () => {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                expect(result.shapes[row * 4 + col].fillIdx).toBe(fills[row]);
            }
        }
    });
    it('stroke widths follow column pattern (1/2/3/4)', () => {
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                expect(result.shapes[row * 4 + col].strokeWidth).toBe(strokeWidths[col]);
            }
        }
    });
    it('all shapes use black stroke pattern (index 3)', () => {
        expect(result.shapes.every(s => s.strokePatternIdx === 3)).toBe(true);
    });
});

// ── 16rect.pict ──────────────────────────────────────────────────────────────
// Same 4×4 grid via PICT; fill+frame pairs merge into single shapes.
// PICT penW values: 1, 2, 4, 6 (MacDraw pen size table, not sequential).

describe('16rect.pict — 4×4 rectangle grid', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('16rect.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 16 shapes (fill+frame pairs merged)', () => expect(result.shapes).toHaveLength(16));
    it('all shapes are rectangles', () => {
        expect(result.shapes.every(s => s.type === 'rectangle')).toBe(true);
    });
    it('all shapes are 97×97', () => {
        expect(result.shapes.every(s => s.width === 97 && s.height === 97)).toBe(true);
    });

    const xCols = [96, 288, 480, 672];
    const yRows = [48, 192, 336, 480];
    const fills = [0, 1, 5, 3];
    // PICT penW values from MacDraw's pen size table
    const strokeWidths = [1, 2, 4, 6];

    it('x-positions follow column grid', () => {
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                expect(result.shapes[row * 4 + col].x).toBe(xCols[col]);
            }
        }
    });
    it('y-positions follow row grid', () => {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                expect(result.shapes[row * 4 + col].y).toBe(yRows[row]);
            }
        }
    });
    it('fill indices follow row pattern (transparent/white/grey/black)', () => {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                expect(result.shapes[row * 4 + col].fillIdx).toBe(fills[row]);
            }
        }
    });
    it('stroke widths follow column pattern (1/2/4/6)', () => {
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                expect(result.shapes[row * 4 + col].strokeWidth).toBe(strokeWidths[col]);
            }
        }
    });
    it('row 0 (frame-only, 4 shapes) has black stroke (pattern index 3 = svart)', () => {
        for (let col = 0; col < 4; col++) {
            expect(result.shapes[col].strokePatternIdx).toBe(3);
        }
    });
    it('rows 1–3 (fill+frame, 12 shapes) have black stroke (pattern index 3 = svart, no PnPat opcode in file)', () => {
        for (let row = 1; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                expect(result.shapes[row * 4 + col].strokePatternIdx).toBe(3);
            }
        }
    });
});

// ── straightbezier.drw ────────────────────────────────────────────────────────

const BEZIER_PTS = [
    { x: 96, y: 192 }, { x: 192, y: 192 }, { x: 192, y: 96 },
    { x: 288, y: 96 }, { x: 288, y: 192 }, { x: 384, y: 288 },
    { x: 480, y: 288 }, { x: 576, y: 192 }, { x: 576, y: 96 },
];

describe('straightbezier.drw — polygon as straight bezier', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('straightbezier.drw')); });

    it('detects MacDraw II format', () => expect(result.format).toBe('MacDraw II'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a bezier', () => expect(result.shapes[0].type).toBe('bezier'));
    it('has 9 points', () => expect(result.shapes[0].points).toHaveLength(9));
    it('first point is (96,192)', () => {
        const p = result.shapes[0].points[0];
        expect(p.x).toBe(96); expect(p.y).toBe(192);
    });
    it('last point is (576,96)', () => {
        const p = result.shapes[0].points[8];
        expect(p.x).toBe(576); expect(p.y).toBe(96);
    });
    it('all points have straight control handles (c1=c2=anchor)', () => {
        for (const p of result.shapes[0].points) {
            expect(p.c1x).toBe(p.x); expect(p.c1y).toBe(p.y);
            expect(p.c2x).toBe(p.x); expect(p.c2y).toBe(p.y);
        }
    });
    it('point coordinates match expected polyline', () => {
        for (let i = 0; i < BEZIER_PTS.length; i++) {
            expect(result.shapes[0].points[i].x).toBe(BEZIER_PTS[i].x);
            expect(result.shapes[0].points[i].y).toBe(BEZIER_PTS[i].y);
        }
    });
    it('has strokeWidth 1', () => expect(result.shapes[0].strokeWidth).toBe(1));
});

// ── straightbezier.pict ───────────────────────────────────────────────────────

describe('straightbezier.pict — connected lines merged to straight bezier', () => {
    let result;
    beforeAll(() => { result = importMacFile(loadFile('straightbezier.pict')); });

    it('detects PICT format', () => expect(result.format).toBe('PICT'));
    it('produces exactly 1 shape', () => expect(result.shapes).toHaveLength(1));
    it('is a bezier', () => expect(result.shapes[0].type).toBe('bezier'));
    it('has 9 points', () => expect(result.shapes[0].points).toHaveLength(9));
    it('first point is (96,192)', () => {
        const p = result.shapes[0].points[0];
        expect(p.x).toBe(96); expect(p.y).toBe(192);
    });
    it('last point is (576,96)', () => {
        const p = result.shapes[0].points[8];
        expect(p.x).toBe(576); expect(p.y).toBe(96);
    });
    it('all points have straight control handles (c1=c2=anchor)', () => {
        for (const p of result.shapes[0].points) {
            expect(p.c1x).toBe(p.x); expect(p.c1y).toBe(p.y);
            expect(p.c2x).toBe(p.x); expect(p.c2y).toBe(p.y);
        }
    });
    it('point coordinates match expected polyline', () => {
        for (let i = 0; i < BEZIER_PTS.length; i++) {
            expect(result.shapes[0].points[i].x).toBe(BEZIER_PTS[i].x);
            expect(result.shapes[0].points[i].y).toBe(BEZIER_PTS[i].y);
        }
    });
    it('has strokeWidth 1', () => expect(result.shapes[0].strokeWidth).toBe(1));
});
