# Activity map sticky folder nesting

## Behavior

Keep the current folder's ancestor rows stacked beneath the Activity map's
existing prompt headings while scrolling vertically. Preserve indentation,
folder counts, expanded state, and working collapse controls. Update the stack
when scrolling between sibling folders, root-level files, and workspace groups;
folders must stop sticking once their descendants leave the viewport.

Keep the Activity map title and prompt headings visible as they are today.
Retain horizontal scrolling and the existing narrow-viewport rule that unpins
the file column when there is insufficient room for prompt columns. Do not add
a separate breadcrumb or change selection, filtering, or recorded activity.

## Implementation boundaries

Use the existing rendered folder tree and workspace groups in `FileHeatmap.tsx`.
Constrain each sticky folder to its visible descendant range rather than using
unbounded CSS sticky offsets, which would leave unrelated ancestors stacked.
Reuse the original folder buttons, avoiding duplicate interactive controls.

Measure the prompt heading height and folder boundaries from the rendered
table. Recalculate after scrolling, resizing, collapse/expand, filtering, and
live updates. Clean up observers and listeners on unmount. Keyboard cell reveal
must account for the sticky ancestor stack so focused cells remain visible.
Keep the current panel palette and row sizing in `file-activity.css`.

## Execution constraints

Do not add tests or run verification, as requested by the user. Keep existing
tests and unrelated working changes untouched.
