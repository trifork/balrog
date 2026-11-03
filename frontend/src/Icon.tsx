import { Activity, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Eye, FileMinus2, FilePenLine, FilePlus2, Flame, Folder, Hammer, Layers, MessageSquareText, PanelRight, Pause, Pencil, Radio, Search, ShieldCheck, SkipForward, SquareTerminal, StepBack, StepForward, TriangleAlert, Undo2, Wrench, X } from "lucide-react";

const icons = {
  flame: Flame,
  activity: Activity,
  layers: Layers,
  tool: Wrench,
  hammer: Hammer,
  fileEdit: FilePenLine,
  filePlus: FilePlus2,
  fileMinus: FileMinus2,
  search: Search,
  terminal: SquareTerminal,
  shield: ShieldCheck,
  warning: TriangleAlert,
  panel: PanelRight,
  prompt: MessageSquareText,
  previousPrompt: StepBack,
  nextPrompt: StepForward,
  pause: Pause,
  live: Radio,
  folder: Folder,
  down: ChevronDown,
  right: ChevronRight,
  left: ChevronLeft,
  arrow: ArrowRight,
  follow: SkipForward,
  clock: Clock,
  read: Eye,
  edit: Pencil,
  check: Check,
  undo: Undo2,
  close: X,
};

export function Icon({ name, className = "size-[18px]" }: { name: keyof typeof icons; className?: string }) {
  const Glyph = icons[name];
  return <Glyph className={`shrink-0 ${className}`} strokeWidth={1.7} aria-hidden="true" focusable="false" />;
}
