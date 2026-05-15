import type { ReactNode } from "react";

import {
  deskRailFooterClass,
  deskRailHeaderClass,
  deskRailSurfaceClass,
} from "@/components/desk-chrome";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface UtilityDrawerProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export default function UtilityDrawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}: UtilityDrawerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <SheetContent
        side="left"
        className={cn(
          deskRailSurfaceClass,
          "!top-[calc(var(--chrome-header-height)+0.5rem)] !bottom-4 !left-4 !h-[calc(100dvh-var(--chrome-header-height)-1rem)] w-[min(var(--chrome-utility-rail-width),calc(100vw-2rem))] gap-0 rounded-[var(--chrome-shell-radius)] p-0 text-foreground sm:max-w-none",
          className,
        )}
      >
        <SheetHeader className={cn(deskRailHeaderClass, "px-4 py-3 text-left")}>
          <SheetTitle className="text-sm font-semibold tracking-normal text-foreground">
            {title}
          </SheetTitle>
          {description ? (
            <SheetDescription className="text-xs leading-5 text-muted-foreground">
              {description}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-3 p-4">{children}</div>
        </ScrollArea>

        {footer ? (
          <div className={cn(deskRailFooterClass, "px-4 py-3")}>
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
