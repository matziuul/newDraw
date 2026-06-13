import { describe, it, expect } from 'vitest';
import { FONTS, FONT_SIZES, STYLE_DEFS, fontCss } from '../src/text-defs.js';

describe('FONTS', () => {
    it('has 13 entries', () => {
        expect(FONTS).toHaveLength(13);
    });

    it('every entry has a non-empty name and css string', () => {
        for (const f of FONTS) {
            expect(typeof f.name).toBe('string');
            expect(f.name.length).toBeGreaterThan(0);
            expect(typeof f.css).toBe('string');
            expect(f.css.length).toBeGreaterThan(0);
        }
    });

    it('font names are unique', () => {
        const names = FONTS.map(f => f.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('includes Geneva', () => {
        expect(FONTS.some(f => f.name === 'Geneva')).toBe(true);
    });

    it('includes Chicago', () => {
        expect(FONTS.some(f => f.name === 'Chicago')).toBe(true);
    });

    it('includes Times', () => {
        expect(FONTS.some(f => f.name === 'Times')).toBe(true);
    });
});

describe('FONT_SIZES', () => {
    it('has 8 entries', () => {
        expect(FONT_SIZES).toHaveLength(8);
    });

    it('all sizes are positive integers', () => {
        for (const s of FONT_SIZES) {
            expect(typeof s).toBe('number');
            expect(s).toBeGreaterThan(0);
            expect(Number.isInteger(s)).toBe(true);
        }
    });

    it('sizes are in ascending order', () => {
        for (let i = 1; i < FONT_SIZES.length; i++) {
            expect(FONT_SIZES[i]).toBeGreaterThan(FONT_SIZES[i - 1]);
        }
    });

    it('contains 9 (smallest) and 48 (largest)', () => {
        expect(FONT_SIZES[0]).toBe(9);
        expect(FONT_SIZES[FONT_SIZES.length - 1]).toBe(48);
    });

    it('contains 12 and 14', () => {
        expect(FONT_SIZES).toContain(12);
        expect(FONT_SIZES).toContain(14);
    });
});

describe('STYLE_DEFS', () => {
    it('has 6 entries', () => {
        expect(STYLE_DEFS).toHaveLength(6);
    });

    it('first entry is Plain Text with id 0', () => {
        expect(STYLE_DEFS[0]).toMatchObject({ id: 0, name: 'Plain Text' });
    });

    it('Bold has id 1 (bit 0)', () => {
        expect(STYLE_DEFS.find(s => s.name === 'Bold')?.id).toBe(1);
    });

    it('Italic has id 2 (bit 1)', () => {
        expect(STYLE_DEFS.find(s => s.name === 'Italic')?.id).toBe(2);
    });

    it('Underline has id 4 (bit 2)', () => {
        expect(STYLE_DEFS.find(s => s.name === 'Underline')?.id).toBe(4);
    });

    it('Outline has id 8 (bit 3)', () => {
        expect(STYLE_DEFS.find(s => s.name === 'Outline')?.id).toBe(8);
    });

    it('Shadow has id 16 (bit 4)', () => {
        expect(STYLE_DEFS.find(s => s.name === 'Shadow')?.id).toBe(16);
    });

    it('style ids are unique', () => {
        const ids = STYLE_DEFS.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('style bits can be OR-combined without collision', () => {
        // bold | italic | underline | outline | shadow = 1|2|4|8|16 = 31, no overlap
        const bits = STYLE_DEFS.filter(s => s.id > 0).map(s => s.id);
        let combined = 0;
        for (const b of bits) {
            expect(combined & b).toBe(0); // no bit already set
            combined |= b;
        }
    });

    it('Plain Text has ⌘T shortcut', () => {
        expect(STYLE_DEFS[0].kbd).toBe('⌘T');
    });

    it('Outline and Shadow have no keyboard shortcut', () => {
        expect(STYLE_DEFS.find(s => s.name === 'Outline')?.kbd).toBeNull();
        expect(STYLE_DEFS.find(s => s.name === 'Shadow')?.kbd).toBeNull();
    });
});

describe('fontCss', () => {
    it('returns the css string for a known font name', () => {
        const css = fontCss('Geneva');
        expect(css).toContain('Geneva');
    });

    it('Geneva css contains Tahoma as fallback', () => {
        expect(fontCss('Geneva')).toContain('Tahoma');
    });

    it('Times css contains Times New Roman', () => {
        expect(fontCss('Times')).toContain('Times New Roman');
    });

    it('returns a fallback for an unknown font', () => {
        const css = fontCss('Nonexistent');
        expect(css).toContain('Nonexistent');
        expect(css).toContain('sans-serif');
    });

    it('is consistent — same name always returns same result', () => {
        expect(fontCss('Helvetica')).toBe(fontCss('Helvetica'));
    });
});
