# Per-cell Heatmap Change Colors Implementation Plan

> **For agentic workers:** Use executing-plans to apply these changes inline. The user explicitly requested no tests or verification.

**Goal:** Distinguish confirmed file changes from read-only activity in each heatmap cell.

**Architecture:** Reuse `changeBreakdown` on mode-matching touches. Render proportional change colors as a CSS gradient beneath the existing selection overlay, with intensity controlled by the unchanged operation-count buckets.

**Tech Stack:** React, TypeScript, CSS.

---

### Task 1: Render change-aware cells

**File:** `frontend/src/FileHeatmap.tsx`

- [x] Define the change categories alongside the existing empty-touch constant:

```ts
const changeKinds = [
  ["created", "creation"],
  ["edited", "edit"],
  ["deleted", "deletion"],
] as const;
```

- [x] Calculate each cell's segments after filtering touches by activity mode:

```ts
const cellChanges = changeBreakdown(attempts);
let offset = 0;
const segments = changeKinds.filter(([kind]) => cellChanges[kind] > 0).map(([kind, label]) => {
  const count = cellChanges[kind];
  const start = offset;
  offset += count / cellChanges.total * 100;
  const color = `color-mix(in srgb, var(--change-${kind}) var(--heat-strength), var(--heat-0))`;
  return {
    kind,
    label: `${count} ${label}${count === 1 ? "" : "s"}`,
    fill: `${color} ${start}%, ${color} ${offset}%`,
  };
});
```

- [x] Apply a `--cell-changes` linear gradient from segment fills when nonempty; expose a single kind or `mixed` as `data-change`. Append the segment labels to the accessible operation count. Keep the existing status markers and event handlers unchanged.
- [x] Update the shared legend and table caption to explain cell colors, amber reads, mixed-change proportions, and count intensity.

### Task 2: Style change colors and intensity

**File:** `frontend/src/file-activity.css`

- [x] Replace the orange heat palette with gray values `#202123`, `#35373b`, `#56595e`, `#81868d`, `#b8bec7`.
- [x] Add shared palette variables `--change-created: #8acba4`, `--change-edited: #8eafe0`, and `--change-deleted: #e68d8d`; use these for the existing candle and change-key colors.
- [x] Add the neutral legend swatch and permit its legend to wrap.
- [x] Use `background-color` for heat buckets instead of the background shorthand, assigning `--heat-strength` to `0%`, `35%`, `55%`, `78%`, and `100%` respectively.
- [x] Add these background-image layers:

```css
.heatmap-cell {
  background-image: var(--cell-changes, none);
}
.heatmap td[data-selected] .heatmap-cell {
  background-image: linear-gradient(#ffffff1f, #ffffff1f),
    var(--cell-changes, linear-gradient(transparent, transparent));
}
```

- [x] Change the darkest text on highest-intensity cells from brown to `#191d23`.

### Task 3: Describe the new encoding

**File:** `README.md`

- [x] Describe green creations, blue edits and writes, red deletions, proportional mixed cells, amber successful reads, and gray inactive cells. State that Reads mode uses amber and intensity still counts operations.
- [x] Do not add tests or run tests, typechecking, builds, review agents, or verification commands, per the user's instruction. Leave implementation changes uncommitted.

### Approved refinement: Distinct read activity

- [x] Add `--activity-read: #d8b274` and use it for the Read legend swatch.
- [x] Mark a cell as `data-change="read"` only when it has successful reads and no confirmed change segments in the active mode.
- [x] Set read cells' `--cell-changes` to a solid gradient of amber mixed with `--heat-0` using the existing `--heat-strength`, preserving operation-count intensity and selection overlays.
- [x] Give inactive cells a separate dark-gray legend swatch and update the caption, README, and design spec to match.
