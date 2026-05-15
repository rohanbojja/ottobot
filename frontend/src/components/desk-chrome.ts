import { cn } from "@/lib/utils";

export const deskShellClass = cn(
  "desk-shell",
  "relative isolate overflow-hidden",
  "rounded-[var(--chrome-shell-radius)] border border-[color:var(--chrome-shell-border)]",
  "bg-[color:var(--chrome-canvas)] shadow-[var(--chrome-shell-shadow)]",
  "supports-[backdrop-filter]:backdrop-blur-[20px] supports-[backdrop-filter]:backdrop-saturate-[115%]",
  "after:pointer-events-none after:absolute after:inset-px after:rounded-[calc(var(--chrome-shell-radius)-1px)] after:border after:border-white/[0.04]",
);

export const deskHeaderClass = cn(
  "desk-header",
  "relative overflow-hidden",
  "border-b border-[color:var(--chrome-hairline)]",
  "bg-[color:var(--chrome-header-bg)] [box-shadow:inset_0_1px_0_rgba(255,255,255,0.04)]",
  "supports-[backdrop-filter]:backdrop-blur-[18px] supports-[backdrop-filter]:backdrop-saturate-[112%]",
);

export const deskPillSurfaceClass = cn(
  "desk-pill-surface",
  "relative inline-flex items-center overflow-hidden rounded-[var(--chrome-pill-radius)]",
  "border border-[color:var(--chrome-pill-border)]",
  "bg-[color:var(--chrome-pill-bg)] shadow-[var(--chrome-pill-shadow)]",
  "supports-[backdrop-filter]:backdrop-blur-[10px] supports-[backdrop-filter]:backdrop-saturate-[108%]",
);

export const deskControlPillClass = cn(
  deskPillSurfaceClass,
  "h-9 min-h-9 justify-center gap-1.5 px-3 text-[0.78rem] font-medium leading-none whitespace-nowrap",
  "transition-[background-color,border-color,box-shadow,color] duration-[180ms] hover:border-white/[0.12] hover:text-foreground",
  "data-[active=true]:border-white/[0.12] data-[active=true]:bg-[color:var(--chrome-pill-bg-active)]",
);

export const deskIconControlPillClass = cn(
  deskControlPillClass,
  "w-9 min-w-9 px-0",
);

export const deskTabListClass = cn(deskPillSurfaceClass, "grid h-11 w-full p-1");

export const deskTabTriggerClass = cn(
  "relative inline-flex h-full min-h-0 items-center justify-center overflow-hidden rounded-[var(--chrome-pill-radius)] border border-transparent",
  "px-3 py-0 text-[0.76rem] font-medium leading-none tracking-normal text-muted-foreground",
  "transition-[background-color,border-color,box-shadow,color] duration-[180ms] hover:border-white/[0.08] hover:text-foreground",
  "data-[state=active]:border-white/[0.12] data-[state=active]:bg-[color:var(--chrome-pill-bg-active)] data-[state=active]:text-foreground",
  "data-[state=active]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.08),0_8px_16px_rgba(0,0,0,0.1)]",
);

export const deskRailHeaderClass = cn(
  "border-b border-[color:var(--chrome-hairline)]",
  "bg-[color:var(--chrome-rail-surface)]",
  "supports-[backdrop-filter]:backdrop-blur-[16px] supports-[backdrop-filter]:backdrop-saturate-[108%]",
);

export const deskRailFooterClass = cn(
  "border-t border-[color:var(--chrome-hairline)]",
  "bg-[color:var(--chrome-rail-surface)]",
  "supports-[backdrop-filter]:backdrop-blur-[16px] supports-[backdrop-filter]:backdrop-saturate-[108%]",
);

export const deskGlassSurfaceClass = cn(
  "desk-glass-surface",
  "relative isolate overflow-hidden",
  "rounded-[var(--chrome-inner-radius)] border border-[color:var(--chrome-panel-border)]",
  "bg-[color:var(--chrome-panel-bg)] shadow-[var(--chrome-panel-shadow)]",
  "supports-[backdrop-filter]:backdrop-blur-[16px] supports-[backdrop-filter]:backdrop-saturate-[110%]",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.06)]",
);

export const deskRailSurfaceClass = cn(
  "desk-rail-surface",
  "relative isolate overflow-hidden",
  "rounded-[var(--chrome-inner-radius)] border border-[color:var(--chrome-rail-border)]",
  "bg-[color:var(--chrome-rail-surface)] shadow-[var(--chrome-panel-shadow)]",
  "supports-[backdrop-filter]:backdrop-blur-[16px] supports-[backdrop-filter]:backdrop-saturate-[110%]",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.06)]",
);

export const deskSolidSurfaceClass = cn(
  "desk-solid-surface",
  "relative overflow-hidden",
  "rounded-[var(--chrome-inner-radius)] border border-[color:var(--chrome-solid-border)]",
  "bg-[color:var(--chrome-solid-bg)] shadow-[var(--chrome-solid-shadow)]",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.05)]",
);

export const toneBadgeClasses = {
  positive:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  negative: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  neutral: "border-slate-500/30 bg-slate-500/10 text-slate-300",
} as const;

export type Tone = keyof typeof toneBadgeClasses;

export function getToneBadgeClass(tone: Tone | null | undefined): string {
  return toneBadgeClasses[tone ?? "neutral"] ?? toneBadgeClasses.neutral;
}
