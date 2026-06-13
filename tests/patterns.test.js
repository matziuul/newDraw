import { describe, it, expect } from 'vitest';
import { QD_PATTERNS } from '../src/patterns.js';

describe('QD_PATTERNS', () => {
    it(`has ${37} entries`, () => {
        expect(QD_PATTERNS).toHaveLength(37);
    });

    it('first entry (ingen) has null rows', () => {
        expect(QD_PATTERNS[0].rows).toBeNull();
    });

    it('every entry has a non-empty name', () => {
        for (const p of QD_PATTERNS) {
            expect(typeof p.name).toBe('string');
            expect(p.name.length).toBeGreaterThan(0);
        }
    });

    it('all non-null row arrays have exactly 8 bytes', () => {
        for (const p of QD_PATTERNS) {
            if (p.rows !== null) expect(p.rows).toHaveLength(8);
        }
    });

    it('white pattern (vit) has all-zero bytes', () => {
        const vit = QD_PATTERNS.find(p => p.name === 'vit');
        expect(vit.rows.every(b => b === 0x00)).toBe(true);
    });

    it('black pattern (svart) has all-0xFF bytes', () => {
        const svart = QD_PATTERNS.find(p => p.name === 'svart');
        expect(svart.rows.every(b => b === 0xFF)).toBe(true);
    });

    it('grey pattern (grå) alternates 0xAA and 0x55', () => {
        const grå = QD_PATTERNS.find(p => p.name === 'grå');
        expect(grå.rows).toEqual([0xAA,0x55,0xAA,0x55,0xAA,0x55,0xAA,0x55]);
    });
});
