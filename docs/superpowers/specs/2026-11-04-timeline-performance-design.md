# Timeline scrolling performance

Preserve all existing timeline behavior while reducing work during scrolling and
dragging. Keep event filtering, command deduplication, historical heatmap
selection, prompt numbering, reasons, and live playback unchanged.

Use the existing absolute marker positions to render the visible range plus a
small pixel buffer. Retain active, hovered, and focused markers even outside the
range so accessibility and tooltip interaction are not interrupted. Keep the
full track width, slider range, and related-event overflow calculations based on
all events. No virtualization dependency is needed.

Accumulate wheel and drag input in refs and publish selection at most once per
animation frame. Preserve fractional drag progress, wheel sensitivity and delta
modes, fine scrubbing, click activation, and synchronous keyboard navigation.
Flush the final drag position on release or cancellation. Cancel pending input
on session changes, external navigation, live playback changes, and unmount.

Do not unmount the event drawer or change its search, collapse, selection, and
scroll state as part of this fix. Measure the timeline independently and leave
unrelated existing test failures separate from regressions.

Verify bounded marker counts and batched updates with deterministic tests, then
exercise navigation, hover retention, related-event reveal, live append, resize,
input cleanup, fine dragging, and historical playback. Run frontend tests,
typechecking, and a production build, recording any pre-existing failures.
