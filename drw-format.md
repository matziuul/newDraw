# MacDraw 1.9 `.drw` File Format

Reverse-engineered from binary analysis of test files and the working importer in `src/import.js`.  
All test files were created with **MacDraw 1.9** (header magic `DRWG`, app tag `MD`, format version `0x0006`).

Differences from MacDraw II (version 2.x) are **not known** — MacDraw II files likely share the `DRWG` magic but would carry a different version number and may add shape types (native bezier curves, etc.).

All multi-byte integers are **big-endian** unless noted otherwise.  
Coordinates are **72 dpi page points** (`Fixed16.16` unless otherwise stated).  
Canvas pixels = points × 96/72 = points × 4/3.

---

## 1. File Structure Overview

```
Offset      Size    Description
──────────────────────────────────────────────────────
0x0000      512     File header
0x0200        4     Section marker
0x0204      var     Shape records (to end of file)
```

---

## 2. File Header (0x0000 – 0x01FF)

The header is always exactly **512 bytes**. Most fields are unknown or zeroed.

```
Offset  Size  Type    Value / Notes
──────────────────────────────────────────────────────────────────
0x0000    4   chars   Magic: 44 52 57 47  "DRWG"
0x0004    2   chars   Application tag: 4D 44  "MD" (MacDraw)
0x0006    2   uint16  Version: 00 06  (MacDraw 1.9 — all observed files)
0x000C    2   uint16  00 48 (0x48 = 72; possibly H-DPI stored here)
0x000E    1   uint8   00
0x000F    1   uint8   48 (72 dpi — vertical resolution)
  ...
0x00A6    2   int16   Canvas HEIGHT in points (72 dpi)
0x00A8    2   int16   Canvas WIDTH  in points (72 dpi)
  ...
0x0100 – 0x01FF  128  Zeroed / unknown
```

### Canvas size example (`Guided Tour Examples.drw`)
```
0x00A6: 02 D0  →  720 pts  =  10.00 inches  (height)
0x00A8: 06 C0  →  1728 pts =  24.00 inches  (width)
```

To convert to canvas pixels at 96 dpi:
```
canvas_px = pts * 96 / 72   (= pts * 4/3)
```

---

## 3. Section Marker (0x0200 – 0x0203)

```
0x0200: 04 00 00 00
```

Always 4 bytes. The first byte is `0x04`; the remainder are zero.  
Shape records begin immediately at **0x0204**.

---

## 4. Shape Records

### 4.1 Record Header (4 bytes, at every record start)

Every shape record begins with this 4-byte header:

```
Offset  Size  Description
+00      1    pen_width_raw   strokeWidth = max(1, pen_width_raw - 1)  [px]
+01      1    stroke_pattern  index into the pattern palette (0 = solid black)
+02      1    fill_variant    draw/fill mode (see §4.2)
+03      1    class / flags   meaning depends on shape type (see §4.3)
```

Followed immediately by **four Fixed16.16 bounding-box values** (16 bytes):

```
+04..+07   Fixed16.16 BE   top   (y1, or y of top-left)
+08..+11   Fixed16.16 BE   left  (x1, or x of top-left)
+12..+15   Fixed16.16 BE   bottom or y2
+16..+19   Fixed16.16 BE   right  or x2
```

**Fixed16.16** encoding:
```
int16  at offset   → integer part  (signed)
uint16 at offset+2 → fractional part / 65536
value = int_part + frac_part / 65536
```

### 4.2 Fill Variant (byte +02)

| Value | Meaning     |
|-------|-------------|
| 0x01  | Transparent (outline only) |
| 0x02  | White fill  |
| 0x03  | Black fill  |
| 0x05  | Grey fill   |

### 4.3 Shape-Type Pre-block

The **4 bytes immediately before** a record header carry the shape type:

```
[shape_type] [00] [00] [00]   ← 4 bytes before the record's +00
```

| Type byte | Shape           |
|-----------|-----------------|
| 0x02      | Line (normal)   |
| 0x03      | Line (reversed endpoints) |
| 0x04      | Rectangle       |
| 0x05      | Round-rect      |
| 0x06      | Ellipse         |
| 0x07      | Arc             |
| 0x08      | Freehand stroke |
| 0x09      | Polygon / bezier |
| 0x0A      | Group (typed inline group) |

---

## 5. Shape-Type Details

### 5.1 Line (pre-block type 0x02 or 0x03)

Bbox fields store the two endpoints directly:

```
+04..+07   Fixed16.16   y1  (top)
+08..+11   Fixed16.16   x1  (left)
+12..+15   Fixed16.16   y2  (bottom — used as second endpoint)
+16..+19   Fixed16.16   x2  (right  — used as second endpoint)
```

`+03` (flags) encodes arrowheads: `0x00` = none, `0x01` = tail arrow, `0x02` = head arrow, `0x03` = both.

**Example** (`Guided Tour Examples.drw`, offset 0x0204):
```
0204: 02 03 03 00   pen=1px  pat=3  fill=black  flags=none
0208: 00 92 00 00   y1 = 146.0 pts
020C: 05 79 00 00   x1 = 1401.0 pts
0210: 00 E3 FF F9   y2 ≈ 228.0 pts
0214: 05 A4 FF E3   x2 ≈ 1445.0 pts
```

### 5.2 Rectangle (pre-block type 0x04)

```
+03   class byte:
        0x00 = standard rectangle
        0x01 = square (equal sides)
        0x02 = roundrect, corner oval diameter =  9 pts (1/8")
        0x03 = roundrect, corner oval diameter = 18 pts (3/16")
        0x04 = roundrect, corner oval diameter = 27 pts (1/4")
        0x05 = roundrect, corner oval diameter = 36 pts (5/16")
        0x06 = roundrect, corner oval diameter = 45 pts (3/8")

+04..+07   Fixed16.16   top  (y of top-left corner)
+08..+11   Fixed16.16   left (x of top-left corner)
+12..+15   Fixed16.16   bottom  (absolute y of bottom edge)
+16..+19   Fixed16.16   right   (absolute x of right edge)
```

Width  = right − left,  Height = bottom − top.

**Example** (`Guided Tour Examples.drw`, pre-block at 0x0230, record at 0x0234):
```
Pre:  0A 00 00 00   → shape type = 0x0a? (actually rect uses 0x04 — see note below)
0234: 02 01 01 00   pen=1px  pat=1  fill=transparent  class=standard
0238: 00 A4 00 00   top  = 164.0 pts  (2.28 in)
023C: 04 F2 00 12   left = 1266.0 pts (17.58 in)
0240: 00 C8 00 00   bot  = 200.0 pts
0244: 05 3A 00 00   right= 1338.0 pts
=> 72 × 36 pt rectangle
```

### 5.3 Ellipse (pre-block type 0x06)

Same layout as rectangle; bbox is the enclosing rectangle.

### 5.4 Arc (pre-block type 0x07)

```
+00..+19   same bbox as rectangle (full oval bounding box — may extend off-canvas)
+20..+23   uint16 start_angle  (degrees, clockwise from 12 o'clock)
+24..+27   uint16 arc_angle    (sweep angle in degrees)
```

### 5.5 Polygon / Bezier (pre-block type 0x09)

```
+08..+09   uint16 BE   point_count   (n)
+10..+27   (18 bytes)  unknown / padding
+28..      n × 8 bytes  point array:
              each point: Fixed16.16 y, Fixed16.16 x
```

### 5.6 Freehand Stroke (pre-block type 0x08)

The **record header** (+00/+01) carries pen width and pattern as usual.  
The rest of the 36-byte header:

```
+00        pen_width_raw   strokeWidth = max(1, val-1)
+01        stroke_pattern
+02..+03   record type marker (02 03 or similar)
+04..+27   bbox and unknown fields (bbox is not used for rendering)
+28..+31   Fixed16.16 BE   start_y  (y of first point)
+32..+35   Fixed16.16 BE   start_x  (x of first point)
+36..      raw signed-byte delta pairs, until (00 00) terminator:
              byte[i]   = dh  (signed, horizontal delta in points)
              byte[i+1] = dv  (signed, vertical delta in points)
```

**Example** (`16by20sine.drw`, offset 0x0204):
```
0204: 02 03 01 00   pen=1px  pat=3  fill=transparent
...
0220: 00 D8 00 00   start_y = 216.0 pts
0224: 00 48 00 00   start_x =  72.0 pts
0228: 06 FC         delta[0]: dh=+6  dv=-4
022A: 06 FC         delta[1]: dh=+6  dv=-4
022C: 06 FB         delta[2]: dh=+6  dv=-5
...
0320: 00 00         terminator
```

---

## 6. Group Records

### 6.1 Bounding-Box Group (pre-block type 0x04 or 0x11)

A record whose bounding box exactly encloses 2 or more other records is treated as a group container. Children are all records whose bboxes fit entirely within the group bbox.

These appear as ordinary shape records but with type `0x04` or `0x11` in their header byte +02.

### 6.2 Typed Inline Group (shape type code 0x0A in pre-block)

A more compact group encoding where children are stored inline (not as separate top-level records). Identified by the byte `0x0A` appearing 4 bytes before the record header.

```
[0x0A 00 00 00]   ← pre-block (4 bytes)
[Record header — 4 bytes]
  +02: type — commonly 0x11
  +03: 0x00
+04..+19   Fixed16.16 bbox (top, left, bottom, right)
+20..+21   uint16 BE   child_count
+22..+35   unknown metadata (14 bytes)
+36..      child_count × 24-byte child blocks:
              each child: [4-byte pre-block] [20-byte record header + bbox]
[8-byte terminator block after last child]
```

Each child record inside a typed group is 24 bytes total:
- bytes 0–3: pre-block (child shape type code at byte 0)
- bytes 4–23: the 20-byte record header (same layout as §4.1)

---

## 7. Text Records

Text objects use a different mechanism — they are **not** standard shape records. The importer scans the full file for `02 03` marker sequences and identifies text by record sub-type.

### 7.1 Inner Text Record (`02 03 01 01`)

```
+00..+01   02 03   marker
+02        0x01    sub-type
+03        0x01    sub-flags
+04..+05   00 00   unknown
+06        length hint  (number of characters, approximate)
+07..+08   int16 BE   y  (top of text box in pts)
+09..+10   int16 BE   x  (left of text box in pts)
+11..+14   int16 BE   bottom, then right  (completing bbox)
+15..      Pascal/C string  (ASCII, terminated by 0x01 or 0x00)
```

**Example** (`Guided Tour Examples.drw`, "Shelves" at 0x0879):
```
0879: 02 03 01 01   marker + sub-type
087D: 00 00 07      unknown / length
0880: 00 C1         y    = 193 pts  (2.68 in from top)
0882: 01 92         x    = 402 pts  (5.58 in from left)
0884: 00 D1         bot  = 209 pts
0886: 01 C9         right= 457 pts
0888: 53 68 65 6C 76 65 73   "Shelves"
088F: 01             string terminator
```

### 7.2 Wrapper Text Record (`02 03 02 00`)

Some text objects have an outer wrapper that embeds an inner record (§7.1) plus metadata. The wrapper also contains the canonical text position.

```
+00..+01   02 03    marker
+02        0x02     sub-type (wrapper)
+03        0x00     flags
+04..+07   4 bytes  internal ID / timestamp  (e.g. 07 AC 59 BC)
+08        00       separator
+09..      inner record (02 03 01 01, see §7.1)
  ...
[the inner record's bbox bytes overlap the wrapper at +16..+23]
+16..+17   int16 BE   y  (same as inner +07)
+18..+19   int16 BE   x  (same as inner +09)
+20..+23   int16 BE   bottom, right
+24..      text string (same as inner +15)
```

When both a wrapper and an inner record exist for the same string, they encode the same coordinates. The inner record is used by the importer (it wins in pass 0).

### 7.3 Outer Wrapper with Geometry (`02 03 02 00`, no inner record)

Some `02 03 02 00` records store geometric bbox data (not text). The importer skips these when `top ≥ 5 pts AND left ≥ 5 pts AND 0 < width < 5000 AND 0 < height < 5000`. Text-bearing wrappers that lack a valid geometry bbox at +4..+19 are processed for text at +24.

---

## 8. Coordinate System

| Unit | Definition |
|------|-----------|
| Point (pt) | 1/72 inch — native Mac screen unit |
| Canvas pixel (px) | 1/96 inch — web canvas unit |
| Scale factor | px = pt × 96/72 = pt × 4/3 |

All Fixed16.16 values in shape records are in **points at 72 dpi**.

---

## 9. Pattern Palette Index (stroke_pattern byte +01)

Index 0 is solid black. Higher indices select from MacDraw's built-in pattern palette (hatching, dots, grey densities). The exact mapping is application-defined but consistent across all shapes in a file.

---

## 10. Known Shape-Type Code Summary

| Pre-block byte | Fill variants seen | Notes |
|---|---|---|
| 0x02 | 0x01–0x03 | Line — normal |
| 0x03 | 0x01–0x03 | Line — endpoints stored reversed |
| 0x04 | 0x01–0x03 | Rectangle / rounded-rect (class byte) |
| 0x05 | 0x01–0x03 | Rounded-rect (alternate encoding) |
| 0x06 | 0x01–0x03 | Ellipse |
| 0x07 | 0x01–0x03 | Arc |
| 0x08 | — | Freehand pencil stroke (delta-encoded) |
| 0x09 | — | Polygon / straight-segment bezier |
| 0x0A | — | Typed inline group |
| 0x11 | — | Group (bbox-container type) |

---

## 11. File Layout Example (Guided Tour Examples.drw)

```
0000: 44 52 57 47 4D 44 00 06   "DRWGMD" + version 6
...
00A6: 02 D0                     canvas height = 720 pts (10 in)
00A8: 06 C0                     canvas width = 1728 pts (24 in)
...
0200: 04 00 00 00               section marker
0204: 02 03 03 00 ...           record 0: line
021C: 02 03 02 03 ...           record 1: line (variant)
0234: 02 03 01 00 ...           record 2: rectangle (transparent)
...
0870: 02 03 02 00 07 AC 59 BC   text wrapper: "Shelves"
0879: 02 03 01 01 ...           text inner record: "Shelves"
...
```
