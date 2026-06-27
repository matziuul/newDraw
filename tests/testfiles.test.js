import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { importMacFile } from '../src/import.js';

const TESTFILES = join(dirname(fileURLToPath(import.meta.url)), '..', 'testfiles');

function load(filename) {
    const buf = readFileSync(join(TESTFILES, filename));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('testfiles', () => {

    it('arc.drw', () => {
        const { shapes } = importMacFile(load('arc.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('arc');
        expect(shapes[0].fillIdx).toBe(0);
        expect(shapes[0].strokeWidth).toBe(1);
    });

    it('arc.pict', () => {
        const { shapes } = importMacFile(load('arc.pict'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('arc');
        expect(shapes[0].fillIdx).toBe(0);
        expect(shapes[0].strokeWidth).toBe(1);
    });

    it('circletrans.drw', () => {
        const { shapes } = importMacFile(load('circletrans.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('ellipse');
        expect(shapes[0].width).toBe(shapes[0].height);
        expect(shapes[0].fillIdx).toBe(0);
        expect(shapes[0].strokeWidth).toBe(1);
    });

    it('circletrans.pict', () => {
        const { shapes } = importMacFile(load('circletrans.pict'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('ellipse');
        expect(shapes[0].width).toBe(shapes[0].height);
        expect(shapes[0].fillIdx).toBe(0);
        expect(shapes[0].strokeWidth).toBe(1);
    });

    it('ellipstrans.drw', () => {
        const { shapes } = importMacFile(load('ellipstrans.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('ellipse');
        expect(shapes[0].fillIdx).toBe(0);
        expect(shapes[0].strokeWidth).toBe(1);
    });

    it('ellipstrans.pict', () => {
        const { shapes } = importMacFile(load('ellipstrans.pict'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('ellipse');
        expect(shapes[0].fillIdx).toBe(0);
        expect(shapes[0].strokeWidth).toBe(1);
    });

    // freehand strokes are approximated as a single BezierShape via Catmull-Rom fitting
    it('freehand.drw', () => {
        const { shapes } = importMacFile(load('freehand.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('bezier');
    });

    // PICT polygon opcode → single BezierShape
    it('freehand.pict', () => {
        const { shapes } = importMacFile(load('freehand.pict'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('bezier');
    });

    // shape type 0x09 parsed as straight BezierShape (control handles not yet decoded)
    it('hardbezier.drw', () => {
        const { shapes } = importMacFile(load('hardbezier.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('bezier');
    });

    it('linehoriz.drw', () => {
        const { shapes } = importMacFile(load('linehoriz.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('line');
        expect(shapes[0].y1).toBe(shapes[0].y2);
    });

    it('linehoriz.pict', () => {
        const { shapes } = importMacFile(load('linehoriz.pict'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('line');
        expect(shapes[0].y1).toBe(shapes[0].y2);
    });

    it('lineleftright.drw', () => {
        const { shapes } = importMacFile(load('lineleftright.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('line');
        expect(shapes[0].x2).toBeGreaterThan(shapes[0].x1);
        expect(shapes[0].y2).toBeGreaterThan(shapes[0].y1);
    });

    it('lineleftright.pict', () => {
        const { shapes } = importMacFile(load('lineleftright.pict'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('line');
        expect(shapes[0].x2).toBeGreaterThan(shapes[0].x1);
        expect(shapes[0].y2).toBeGreaterThan(shapes[0].y1);
    });

    it('linerightleft.drw', () => {
        const { shapes } = importMacFile(load('linerightleft.drw'));
        expect(shapes).toHaveLength(1);
        expect(shapes[0].type).toBe('line');
        expect(shapes[0].x1).toBeGreaterThan(shapes[0].x2);
        expect(shapes[0].y2).toBeGreaterThan(shapes[0].y1);
    });

});
