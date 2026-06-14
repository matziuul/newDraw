export class History {
    constructor(state) {
        this.state = state;
        this.undoStack = [];
        this.redoStack = [];
    }

    savePreOp() { return this.state.shapes.map(s => s.clone()); }

    commit(preOpSnapshot) {
        this.undoStack.push(preOpSnapshot);
        this.redoStack = [];
    }

    undo() {
        if (!this.undoStack.length) return false;
        this.redoStack.push(this.savePreOp());
        this.state.shapes = this.undoStack.pop();
        this.state.selectedId = null;
        return true;
    }

    redo() {
        if (!this.redoStack.length) return false;
        this.undoStack.push(this.savePreOp());
        this.state.shapes = this.redoStack.pop();
        this.state.selectedId = null;
        return true;
    }

    reset() {
        this.undoStack = [];
        this.redoStack = [];
    }
}