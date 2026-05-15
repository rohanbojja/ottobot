import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface StatusBadgeProps {
  tone?: "positive" | "warning" | "negative" | "info" | "neutral";
  children: ReactNode;
}

const toneClasses = {
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  negative: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  neutral: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

export default function StatusBadge({
  tone = "neutral",
  children,
}: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn("w-fit", toneClasses[tone])}>
      {children}
    </Badge>
  );
}
