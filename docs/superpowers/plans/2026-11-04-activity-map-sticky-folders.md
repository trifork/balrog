# Activity Map Sticky Folders Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement this plan inline. Do not delegate, add tests, run verification, or commit changes.

**Goal:** Keep the visible file tree's ancestor folders stacked below the prompt headings during scrolling.

**Architecture:** Measure original table rows and each folder's descendant range in a dedicated hook. Translate existing folder cells into their sticky positions, clipped below their ancestors and bounded by their subtrees. Keep measurements separate from scroll-time position updates.

**Tech Stack:** React, TypeScript, DOM measurements, existing CSS.

---

### Task 1: Folder positioning

**Files:**
- Create: `frontend/src/useStickyHeatmapFolders.ts`
- Modify: `frontend/src/FileHeatmap.tsx`

- [x] Memoize the grouped tree with `useMemo(() => groupWorkspacePaths(prompts, paths).map(group => ({ ...group, rows: fileActivityRows(group.paths, group.workspace, collapsed) })), [prompts, paths, collapsed])`.
- [x] Measure rows within each workspace independently. Use a depth stack to close folder ranges at the next sibling or ancestor row. Cache natural row positions, folder heights, parents, and subtree ends.
- [x] On scroll, calculate `offset = Math.min(Math.max(0, targetTop - (folder.top - viewport.scrollTop)), Math.max(0, folder.bottom - folder.height - folder.top))`. Set `--folder-offset` on the existing folder row. Compute `targetTop` from the measured prompt headings and the positioned parent folder.
- [x] Set `--folder-clip` to the positive overlap with the header/parent boundary, preventing exiting descendants from painting over their ancestors.
- [x] Rebuild measurements when groups change and when the viewport or table resizes. Remove listeners and disconnect observers on cleanup.
- [x] Expose the prompt-header height plus a target row's ancestor heights for keyboard reveal, replacing the existing header-only inset.

### Task 2: Styling

**Files:**
- Modify: `frontend/src/file-activity.css`

- [x] Translate folder cells with `transform: translateY(var(--folder-offset, 0px))` and clip with `clip-path: inset(var(--folder-clip, 0px) 0 0)`.
- [x] Give folder prompt cells an opaque panel background and a positioned layer, keeping folder labels above them and prompt headings above both.
- [x] Retain existing horizontal file-column pinning, indentation, row dimensions, and selected-column styling.
