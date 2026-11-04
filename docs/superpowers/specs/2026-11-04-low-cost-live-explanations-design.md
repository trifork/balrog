# Low-cost live tool explanations

## Goal

Restore live per-call purposes without introducing model requests or reporting turns. Outcomes are retrospective-only and never displayed on the timeline. Implement on the existing branch; preserve passive recording by default.

## Design

The V2 plugin enables the feature only when `liveToolExplanations: true`. A tool transform adds a small optional `__balrogReason` string to compatible object input schemas. Its description asks for a brief purpose, not private reasoning. The wrapper strips this field, preserves the original schema's decoding, and calls the existing executor exactly once. Missing reasons do not reject tools or trigger reminders. Recorded purposes are bounded to 160 characters.

The wrapper records only `balrog.tool.intent` with `source: "agent"`. It never generates outcomes, reads results to create summaries, or emits `balrog.tool.outcome`, including on execution or decoding failures. Original results and thrown errors are returned unchanged. Recorder failures must not change tool behavior. Nested Code Mode execution sharing a call ID produces only one outer intent; separate parallel calls remain independent.

Unsupported or conflicting schemas remain unmodified. JSON Schema, Effect codecs, and projectable Standard Schema inputs are supported without mutating their originals. Transforms remain repeatable and follow the existing plugin lifecycle.

The analyzer retains retrospective outcomes and historical annotation compatibility in HTTP, WebSocket, and replay consumers. The timeline shows reasons and their provenance only: no outcome values, headings, placeholders, marker fields, or accessibility instructions, even for historical and retrospective outcomes. Retrospective assessment data remains available to the Reasons and Capabilities pages and `/retro`; those pages and their existing rendering remain unchanged. New retrospectives fill only missing reasons. Existing historical events keep their original interpretation during replay.

## Retrospective reason reuse

`/retro` reuses every existing non-empty recorded reason verbatim, including earlier retrospective reasons, and infers a reason only when the snapshot has none. It continues to assess capabilities and outcomes. Existing reasons are evidence, not instructions; critiques belong in the recommendations instead of rewritten reasons.

The assessment endpoint accepts omitted reasons when a call already has one and preserves that reason even if a client supplies a replacement. It writes no new reason field for reused reasons, preserving their original provenance on replay. A call without a recorded reason must include a non-empty inferred reason; an invalid batch is rejected before any writes. Existing historical events remain readable with their original interpretation. Outcomes stay retrospective-only and never return to timeline tooltips.

## Cost boundary

No session hooks, synthetic messages, pending-report queues, reporting tools, model calls, or instructions appended to results. Additional model tokens consist of the small schema field and any purpose the model emits. No percentage cost guarantee is made without provider usage measurements.

## Verification

Tests cover opt-in/default-off behavior, unchanged tools/results/errors, codec preservation, schema edge cases, repeat transforms, nested and parallel calls, failure isolation, bounded reasons, annotation precedence, reason provenance display, absence of all live outcomes, HTTP/WebSocket updates, retrospective outcome publication, and replay. Run focused tests first, then typechecking, the full test suite, and production build. Do not spend provider credits on an automatic benchmark.
