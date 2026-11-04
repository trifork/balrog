# Per-cell file change colors

## Behavior

Color each file/prompt cell by its confirmed, unreverted recorded changes:
green for creations, blue for edits and writes, and red for deletions. Cells
with multiple change types show proportional segments using the candle palette.
Read-only activity and cells without confirmed changes use a neutral gray scale.
The Reads filter always uses the neutral scale.

Keep the existing operation counts and fixed intensity buckets (0, 1, 2–3,
4–7, 8+). Failed, pending, and reverted actions do not contribute change colors;
their existing markers remain visible. Successful reverted operations still
contribute intensity in All activity, as before.

Selection, hover, keyboard navigation, prompt filtering, live updates, and
historical playback retain their current behavior. Selection lightens cells
without replacing their change colors. The legend and accessible descriptions
explain both change types and intensity.

## Implementation boundaries

Reuse `changeBreakdown` on each cell's mode-matching touches rather than adding
another interpretation of recorded activity. Keep rendering and styling in
`FileHeatmap.tsx` and `file-activity.css`. No recorder, server, or protocol changes
are needed. Update the heatmap section of `README.md` to describe the colors.

## Verification

Cover creations, edits, writes, deletions, mixed changes, read-only and empty
cells, all activity modes, pending and failed attempts, undo/redo snapshots,
and historical playback. Verify that counts, heat buckets, markers, and selection
remain intact. Run frontend tests, TypeScript checking, and the production build.
