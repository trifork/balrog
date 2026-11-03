# Split workspace

## Layout

Use a fixed-height application shell with the existing compact header, a flexible middle workspace, and an empty 32px bottom bar. The bottom bar spans the full viewport width beneath both workspace columns. The shell uses the dynamic viewport height so the page itself does not scroll.

Split the middle workspace into equal-width left and right columns with a subtle vertical border down the center. Session events, search, filters, errors, and feed controls remain in the left column. The right column is empty. The event column scrolls independently without moving the header, divider, or bottom bar.

Keep the existing compact spacing and dark styling. Use equal columns at every viewport width rather than replacing the right column with an overlay.

## Collapse behavior

The empty right pane starts expanded. A compact icon button in the header collapses and reopens it. Collapsing the pane hides it entirely and gives the event column the full workspace width. Keep event components mounted when toggling so their state is preserved.

Give the toggle an accessible action label, `aria-expanded`, and `aria-controls` pointing to the empty right pane. Keep it keyboard accessible and visibly distinguish the expanded state. No persistence or additional pane content is required.

## Scope and verification

Use local React state in `App.tsx`, add a panel icon to `Icon.tsx`, and extend `styles.css`. Do not change viewer data, session URLs, transport, or event filtering. No dependencies or commits are needed.

Do not add, modify, or run tests, as requested. Verify with TypeScript checking, a production build, and diff inspection.
