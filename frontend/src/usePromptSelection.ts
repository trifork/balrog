import { useCallback, useState } from "react";
import type { ActivityPrompt } from "./file-activity-model";

/** An untouched selection follows all prompts; explicit selections stay fixed. */
export function usePromptSelection(prompts: ActivityPrompt[]) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const isSelected = useCallback((key: string | undefined) => selected === null || (key !== undefined && selected.has(key)), [selected]);
  const select = useCallback((key: string, toggle: boolean) => {
    setSelected((previous) => {
      if (!toggle) return new Set([key]);
      const next = new Set(previous ?? prompts.map((prompt) => prompt.key));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [prompts]);
  return { isSelected, select };
}
