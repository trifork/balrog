import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { FileActivityRow } from "./file-activity-model";

interface FolderPosition {
  row: HTMLTableRowElement;
  depth: number;
  top: number;
  height: number;
  bottom: number;
  parent?: FolderPosition;
  position: number;
  offset: number;
  clip: number;
}

export function useStickyHeatmapFolders(viewportRef: RefObject<HTMLDivElement | null>, tableRef: RefObject<HTMLTableElement | null>, groups: readonly { rows: readonly FileActivityRow[] }[]) {
  const measurements = useRef({ headerHeight: 0, ancestors: new Map<HTMLTableRowElement, FolderPosition[]>() });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const table = tableRef.current;
    if (!viewport || !table) return;
    let folders: FolderPosition[] = [];

    const position = () => {
      const scrollTop = viewport.scrollTop;
      const headerHeight = measurements.current.headerHeight;
      for (const folder of folders) {
        const naturalTop = folder.top - scrollTop;
        const target = Math.max(headerHeight, folder.parent ? folder.parent.position + folder.parent.height : headerHeight);
        const offset = Math.min(Math.max(0, target - naturalTop), Math.max(0, folder.bottom - folder.height - folder.top));
        folder.position = naturalTop + offset;
        const clip = Math.min(folder.height, Math.max(0, target - folder.position));
        if (offset !== folder.offset) folder.row.style.setProperty("--folder-offset", `${offset}px`);
        if (clip !== folder.clip) folder.row.style.setProperty("--folder-clip", `${clip}px`);
        folder.offset = offset;
        folder.clip = clip;
      }
    };

    const measure = () => {
      const origin = viewport.getBoundingClientRect().top - viewport.scrollTop;
      const ancestors = new Map<HTMLTableRowElement, FolderPosition[]>();
      folders = [];
      groups.forEach((group, groupIndex) => {
        const body = table.tBodies[groupIndex];
        if (!body) return;
        const stack: FolderPosition[] = [];
        let bottom = 0;
        group.rows.forEach((row, index) => {
          const element = body.rows[index + 1];
          if (!element) return;
          const rect = element.getBoundingClientRect();
          const top = rect.top - origin;
          bottom = rect.bottom - origin;
          while (stack.length && stack[stack.length - 1].depth >= row.depth) stack.pop()!.bottom = top;
          ancestors.set(element, [...stack]);
          if (row.kind !== "folder") return;
          const folder: FolderPosition = {
            row: element, depth: row.depth, top, height: rect.height, bottom,
            parent: stack.at(-1), position: top - viewport.scrollTop, offset: NaN, clip: NaN,
          };
          folders.push(folder);
          stack.push(folder);
        });
        for (const folder of stack) folder.bottom = bottom;
      });
      measurements.current = {
        headerHeight: table.querySelector(".heatmap-scope[data-prompt-headings]")?.getBoundingClientRect().height ?? 0,
        ancestors,
      };
      position();
    };

    measure();
    viewport.addEventListener("scroll", position, { passive: true });
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(table);
    return () => {
      viewport.removeEventListener("scroll", position);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      for (const folder of folders) {
        folder.row.style.removeProperty("--folder-offset");
        folder.row.style.removeProperty("--folder-clip");
      }
      measurements.current = { headerHeight: 0, ancestors: new Map() };
    };
  }, [viewportRef, tableRef, groups]);

  return useCallback((element: HTMLElement) => {
    const row = element.closest("tr");
    const ancestors = row ? measurements.current.ancestors.get(row) : undefined;
    return measurements.current.headerHeight + (ancestors?.reduce((height, folder) => height + folder.height, 0) ?? 0);
  }, []);
}
