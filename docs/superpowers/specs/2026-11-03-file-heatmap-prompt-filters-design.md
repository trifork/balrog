# File heatmap prompt filters

## Approved behavior

The main heading is `File heatmap` and the browser title is `Balrog — File heatmap`.
Keep the existing per-prompt heatmap columns visible. The file inspector initially
aggregates all prompts in the selected session, or all sessions when that tab is
selected. Selecting a candle filters the inspector and related events to that
prompt. Selecting it again or choosing `All prompts` restores the aggregate.
New activity updates the current scope without silently selecting the latest prompt.

Each prompt candle is a stacked change histogram: green creations, blue edits
(including writes), and red deletions. Segment proportions count successful,
unreverted file-change operations, not reads, failed attempts, or pending actions.
Height represents change volume relative to the other prompts. Zero-change prompts
remain selectable with a neutral candle. Show a color legend, explicit filtering
instructions, selected outlines, and accessible counts and percentages.

Timeline prompt markers reuse the heatmap's first-seen activity identities and
numbers, not independently inferred event tags. Late snapshots and undo updates do
not create new boundaries. Preserve the full prompt context while describing filtered
timeline events so an old tool completion cannot become a new prompt marker.
Previous/next prompt navigation centers the timeline handle, with sufficient edge
space to center the first and last events too. Existing drag behavior and live
approvals remain independent.

## Verification

Cover aggregation across prompts and sessions, stable selection across live and undo
updates, candle toggle/reset and related-event scope, neutral read-only candles,
percentage calculations, consistent prompt markers, centering at both edges, header
copy, keyboard access, and existing approval behavior. Run frontend and server
tests, typecheck, production build, and diff checks. Leave existing `logs/` untouched.
