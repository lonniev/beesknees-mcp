- **The focused hive is drawn in WebGL.** Bees are painted sprites, seen from
  above, that fly between cells along the shaft they actually used rather than
  appearing in the next one; pollen trails a bee carrying it home; a dig throws
  comb and a seal caps the cell in wax; the wall glows red once anyone is
  within three rings of the queen; flowers sway, and fade to lavender once
  emptied. The SVG board stays underneath as the first paint and the fallback —
  no WebGL, or a context lost to memory pressure, and the game carries on
  exactly as before. Thumbnails stay SVG, so a phone holds one WebGL context.
  PixiJS loads only when a board mounts; the pages of prose pay nothing for it.
- **One painted bee for the whole site.** The foragers drifting over the page
  are the same bee as the racers on the board, from the same painter — the 🐝
  glyph was a different insect on every platform.
