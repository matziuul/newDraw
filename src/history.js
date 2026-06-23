/** Manages undo/redo history for the drawing canvas using a snapshot-based approach. */
export class History {
    /**
     * @param {object} state - Shared application state containing the shapes array and selectedId.
     */
    constructor(state) {
        this.state = state;
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Captures a deep clone of all current shapes, to be used as a pre-operation snapshot.
     * Call this before mutating shapes, then pass the result to {@link commit}.
     * @returns {object[]} Array of cloned shapes representing the current canvas state.
     */
    savePreOp() { return this.state.shapes.map(s => s.clone()); }

    /**
     * Records a pre-operation snapshot on the undo stack and clears the redo stack.
     * Should be called immediately after a user operation completes.
     * @param {object[]} preOpSnapshot - Snapshot returned by {@link savePreOp} taken before the operation.
     */
    commit(preOpSnapshot) {
        this.undoStack.push(preOpSnapshot);
        this.redoStack = [];
    }

    /**
     * Reverts the canvas to the most recent snapshot on the undo stack.
     * @returns {boolean} True if an undo was performed, false if the stack was empty.
     */
    undo() {
        if (!this.undoStack.length) return false;
        this.redoStack.push(this.savePreOp());
        this.state.shapes = this.undoStack.pop();
        this.state.selectedId = null;
        return true;
    }

    /**
     * Re-applies the most recently undone operation.
     * @returns {boolean} True if a redo was performed, false if the stack was empty.
     */
    redo() {
        if (!this.redoStack.length) return false;
        this.undoStack.push(this.savePreOp());
        this.state.shapes = this.redoStack.pop();
        this.state.selectedId = null;
        return true;
    }

    /** Clears both the undo and redo stacks, e.g. after loading a new document. */
    reset() {
        this.undoStack = [];
        this.redoStack = [];
    }
}