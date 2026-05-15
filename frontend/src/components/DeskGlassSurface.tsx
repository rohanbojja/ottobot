import type { HTMLAttributes } from "react";

import { deskGlassSurfaceClass } from "@/components/desk-chrome";
import { cn } from "@/lib/utils";

export default function DeskGlassSurface({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(deskGlassSurfaceClass, className)} {...props} />;
}
