import type { HTMLAttributes, ReactNode } from "react";

import { deskRailSurfaceClass } from "@/components/desk-chrome";
import { ScrollArea } from "@/components/ui/scroll-area";
import UtilityDrawer from "@/components/UtilityDrawer";
import { cn } from "@/lib/utils";

type DrawerConfig = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export interface DeskPageShellProps extends HTMLAttributes<HTMLElement> {
  drawer?: DrawerConfig | null;
  showDesktopSidebar?: boolean;
  desktopSidebarMode?: "scroll" | "fill";
  sidebar?: ReactNode;
  showInlineContextRail?: boolean;
  inlineContextRail?: ReactNode;
  mainClassName?: string;
  children: ReactNode;
}

export default function DeskPageShell({
  drawer,
  showDesktopSidebar = false,
  desktopSidebarMode = "scroll",
  sidebar,
  showInlineContextRail = false,
  inlineContextRail,
  className,
  mainClassName,
  children,
  style,
  ...props
}: DeskPageShellProps) {
  const layoutColumns = [
    showDesktopSidebar && sidebar
      ? "minmax(0, var(--chrome-utility-rail-width))"
      : null,
    "minmax(0, 1fr)",
    showInlineContextRail && inlineContextRail
      ? "minmax(0, var(--chrome-context-rail-width))"
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {drawer ? (
        <UtilityDrawer
          open={drawer.open}
          title={drawer.title}
          description={drawer.description}
          onClose={drawer.onClose}
          footer={drawer.footer}
          className={drawer.className}
        >
          {drawer.content}
        </UtilityDrawer>
      ) : null}

      <section
        className={cn("grid min-w-0 items-start gap-4", className)}
        style={{ gridTemplateColumns: layoutColumns, ...style }}
        {...props}
      >
        {showDesktopSidebar && sidebar ? (
          <div className="sticky top-[var(--chrome-sticky-offset)] min-h-0 min-w-0 self-start">
            <div className={cn(deskRailSurfaceClass, "h-[var(--chrome-rail-height)] overflow-hidden")}>
              {desktopSidebarMode === "fill" ? (
                <div className="flex h-full flex-col p-4">{sidebar}</div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="p-4">{sidebar}</div>
                </ScrollArea>
              )}
            </div>
          </div>
        ) : null}

        <div className={cn("min-w-0", mainClassName)}>{children}</div>

        {showInlineContextRail && inlineContextRail ? (
          <div className="sticky top-[var(--chrome-sticky-offset)] min-h-0 min-w-0 self-start">
            <div className={cn(deskRailSurfaceClass, "h-[var(--chrome-rail-height)] overflow-hidden p-4")}>
              {inlineContextRail}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
