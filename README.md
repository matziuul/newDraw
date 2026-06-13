# MacDraw

A MacDraw II–style vector drawing application that runs in the browser. Vanilla JavaScript ES modules, Canvas 2D API, no framework or build step.

## Running

Open `app.html` directly in a browser, or serve it with any static file server:

```
npx serve .
```

## Drawing tools

The toolbar on the left contains six tools. **Single-click** a draw tool to use it once — the tool automatically returns to Select after you finish drawing the shape. **Double-click** a draw tool to lock it (a blue outline appears on the button) so it stays active for multiple shapes. Click another tool or press S to return to Select.

| Button | Tool | Key | Behavior |
|---|---|---|---|
| ⌖ | Select | S | Move, resize, click-select, rubber-band select |
| ▭ | Rectangle | R | Drag to draw; auto-returns to Select unless locked |
| ◯ | Ellipse | E | Drag to draw; auto-returns to Select unless locked |
| ／ | Line | L | Drag to draw; auto-returns to Select unless locked |
| ✒ | Bézier | B | Click to place anchor points, drag to pull handles; press Enter or double-click canvas to finish; auto-returns to Select unless locked |
| A | Text | T | Click to place a text box; double-click an existing text shape to edit it |

## Keyboard shortcuts

### Tools
| Key | Action |
|---|---|
| S | Select tool |
| R | Rectangle tool |
| E | Ellipse tool |
| L | Line tool |
| B | Bézier tool |
| T | Text tool |

### Edit
| Shortcut | Action |
|---|---|
| ⌘Z | Undo |
| ⇧⌘Z | Redo |
| ⌘C | Copy |
| ⌘V | Paste |
| ⌘D | Duplicate |
| Delete / Backspace | Delete selected shape(s) |
| Escape | Cancel current draft / deselect |
| Enter | Finish Bézier curve |

### Arrange
| Shortcut | Action |
|---|---|
| ⌘G | Group selection |
| ⇧⌘G | Ungroup |
| ⌘] | Bring to Front |
| ⌘[ | Send to Back |
| ⌘⌥] | Bring Forward |
| ⌘⌥[ | Send Backward |
| ⌘L | Lock |
| ⇧⌘L | Unlock |

### Text (while a text shape is selected or text overlay is open)
| Shortcut | Action |
|---|---|
| ⌘T | Plain Text |
| ⌘B | Bold |
| ⌘I | Italic |
| ⌘U | Underline |

## Menus

### File
- **Open…** (⌘O) — import a PICT or MacDraw II `.drw` file
- **Print…** (⌘P) — print the canvas

### Edit
Standard clipboard and history operations. Items are disabled when no selection exists.

### Arrange
- **Group / Ungroup** — combine or split shapes
- **Layer order** — Bring to Front, Bring Forward, Send Backward, Send to Back
- **Transforms** — Flip Horizontal, Flip Vertical, Rotate 90° CW/CCW
- **Lock / Unlock** — prevent a shape from being moved or resized (shown with greyed handles)

### Text
- **Font** — submenu with 13 fonts: Chicago, Geneva, Monaco, New York, Times, Helvetica, Palatino, Bookman, Avant Garde, Courier, Zapf Chancery, Symbol, Zapf Dingbats
- **Size** — 9, 10, 12, 14, 18, 24, 36, 48 pt
- **Styles** — Plain Text, Bold, Italic, Underline, Outline, Shadow (bitmask-combined)

Font, size, and style show checkmarks next to the current active value. Changes apply immediately to the selected text shape and update the text overlay if one is open.

## Selection

- **Click** a shape to select it
- **Click empty area** to deselect
- **Drag empty area** for rubber-band selection (dashed blue rectangle); selects all shapes whose bounding boxes intersect it
- **Multi-selection** shows dashed blue outlines around each shape
- **Double-click** a text shape (with Select tool active) to open it for editing

### Resize handles
Selected non-group, non-text shapes show 8 white square handles at corners and edge midpoints. Locked shapes show grey handles and cannot be resized or moved. Group and text shapes show only a dashed selection outline (no resize handles).

## Pattern fills and stroke widths

The toolbar panel shows:
- **37 QuickDraw fill patterns** — including transparent (no fill), white, black, and 34 intermediate patterns. Click a swatch to set the fill for new shapes or the currently selected shape.
- **6 stroke widths** — 1, 2, 3, 4, 6, 8 px. Click a swatch to set the stroke width.

The active pattern and stroke width are reflected back when you select a shape.

## Bézier curves

Click to place anchor points. While placing each point you can drag immediately after the click to pull out symmetric control handles (the outgoing handle goes with the mouse; the incoming handle mirrors it). After finishing (Enter or double-click), the selected bezier shows editable handles:

- **Square handles** = anchor points (drag to move point and both handles together)
- **Round handles** = control points (drag one side; the opposite handle mirrors it)

## Text tool

Click anywhere on the canvas to open a `contenteditable` overlay at that position. Type normally; press Escape to cancel without saving. Clicking elsewhere on the canvas commits the text and starts a new text box at the clicked position. The overlay matches the current font, size, and style settings exactly. Multi-line text is supported (Enter key).

To edit existing text, double-click it with the Select tool, or click it with the Text tool.

## File import

**File → Open…** accepts:
- **PICT** (v1 and v2, with or without 512-byte QuickDraw header) — imports lines, rectangles, rounded rectangles, ovals, and polygons (rendered as line sequences); bitmaps and regions are skipped
- **MacDraw II `.drw`** — imports lines, rectangles, rounded rectangles, and ovals; fill and pen patterns are approximated against the built-in palette

## Grid and rulers

Horizontal and vertical pixel rulers run along the top and left edges. The status bar at the bottom shows the cursor position and the size of the selected shape. Units can be switched between pixels and millimetres via the View menu (or the grid controls panel).

A grid can be toggled on/off and snap-to-grid enabled via the grid controls. Grid size is configurable in pixels or millimetres.

## Architecture

| File | Responsibility |
|---|---|
| `app.html` | Single-page app shell: canvas, toolbar, rulers, menus, CSS |
| `src/main.js` | Wires all modules together; owns the file import event handler |
| `src/state.js` | `AppState` — all mutable application state |
| `src/shapes.js` | Shape classes: `RectangleShape`, `EllipseShape`, `LineShape`, `BezierShape`, `GroupShape`, `TextShape`; geometry helpers (`normalize`, `snap`, `offsetShape`, `applyMoveFromOrigin`, `hitTestHandle`) |
| `src/renderer.js` | Canvas rendering: shapes, selection handles, bézier draft, rubber-band, grid |
| `src/tool-controller.js` | Mouse and keyboard event handling for all tools; text overlay lifecycle |
| `src/toolbar.js` | Tool buttons (single/double-click sticky logic), fill pattern swatches, stroke swatches |
| `src/menus.js` | Menu bar construction and action dispatch (File, Edit, Arrange, Text) |
| `src/history.js` | Undo/redo via deep-clone snapshots (`savePreOp` / `commit`) |
| `src/patterns.js` | 37 QuickDraw 8×8 bit patterns; `buildPattern` creates `CanvasPattern` objects |
| `src/text-defs.js` | Font list, font size list, style definitions, `fontCss()` helper |
| `src/ruler.js` | Pixel/mm rulers with mouse-position tick |
| `src/grid-controls.js` | Grid toggle, snap toggle, grid size inputs |
| `src/print.js` | Off-screen canvas print rendering |
| `src/import.js` | PICT v1/v2 parser and MacDraw II `.drw` parser |

## Testing

Tests use [Vitest](https://vitest.dev/) and run in Node.js (with jsdom for DOM-dependent tests).

```
npm test
```

Test files are in `tests/`:
- `patterns.test.js` — QuickDraw pattern palette
- `shapes.test.js` — all shape classes, geometry helpers
- `text-defs.test.js` — font/size/style definitions, `fontCss`
- `text-shape.test.js` — `TextShape` (jsdom environment for canvas stub)
- `history.test.js` — undo/redo behaviour
