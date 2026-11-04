# Timeline related-event overflow indicators

When a selected file activity cell highlights timeline commands, show an amber
indicator at either timeline edge if related commands lie outside that edge.
Match the existing amber related-command borders. Include the number of hidden
related commands and an accessible directional label.

Update the indicators on scrolling, resizing, layout changes, live updates,
and file selection changes. Hide them when no related commands are offscreen.
Clicking an indicator scrolls the nearest hidden related command into view
without changing playback or the selected file activity cell.

Use the existing highlighted event IDs and timeline marker positions. Do not
change timeline event filtering, event linkage, or unrelated in-progress work.
Do not add tests or run verification, as requested by the user.
