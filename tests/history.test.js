import { describe, it, expect, beforeEach } from 'vitest';
import { History } from '../src/history.js';
import { RectangleShape } from '../src/shapes.js';

function makeState(shapes = []) {
    return { shapes, selectedId: null };
}

describe('History', () => {
    let state, history;

    beforeEach(() => {
        state = makeState();
        history = new History(state);
    });

    it('undo returns false on empty stack', () => {
        expect(history.undo()).toBe(false);
    });

    it('redo returns false on empty stack', () => {
        expect(history.redo()).toBe(false);
    });

    it('undo restores previous shapes', () => {
        const snap = history.savePreOp();
        state.shapes.push(new RectangleShape(0, 0, 100, 100));
        history.commit(snap);

        history.undo();
        expect(state.shapes).toHaveLength(0);
    });

    it('redo re-applies the undone action', () => {
        const snap = history.savePreOp();
        state.shapes.push(new RectangleShape(0, 0, 100, 100));
        history.commit(snap);

        history.undo();
        history.redo();
        expect(state.shapes).toHaveLength(1);
    });

    it('commit clears the redo stack', () => {
        const snap1 = history.savePreOp();
        state.shapes.push(new RectangleShape(0, 0, 50, 50));
        history.commit(snap1);

        history.undo();

        const snap2 = history.savePreOp();
        state.shapes.push(new RectangleShape(10, 10, 50, 50));
        history.commit(snap2);

        expect(history.redo()).toBe(false);
    });

    it('undo sets selectedId to null', () => {
        const r = new RectangleShape(0, 0, 100, 100);
        const snap = history.savePreOp();
        state.shapes.push(r);
        history.commit(snap);
        state.selectedId = r.id;

        history.undo();
        expect(state.selectedId).toBeNull();
    });

    it('redo sets selectedId to null', () => {
        const snap = history.savePreOp();
        state.shapes.push(new RectangleShape(0, 0, 100, 100));
        history.commit(snap);

        history.undo();
        state.selectedId = 42;
        history.redo();
        expect(state.selectedId).toBeNull();
    });

    it('supports multiple undo levels', () => {
        const snap1 = history.savePreOp();
        state.shapes.push(new RectangleShape(0, 0, 50, 50));
        history.commit(snap1);

        const snap2 = history.savePreOp();
        state.shapes.push(new RectangleShape(100, 100, 50, 50));
        history.commit(snap2);

        expect(state.shapes).toHaveLength(2);
        history.undo();
        expect(state.shapes).toHaveLength(1);
        history.undo();
        expect(state.shapes).toHaveLength(0);
    });

    it('undo then redo then undo again works correctly', () => {
        const snap = history.savePreOp();
        state.shapes.push(new RectangleShape(0, 0, 100, 100));
        history.commit(snap);

        history.undo();
        expect(state.shapes).toHaveLength(0);
        history.redo();
        expect(state.shapes).toHaveLength(1);
        history.undo();
        expect(state.shapes).toHaveLength(0);
    });
});