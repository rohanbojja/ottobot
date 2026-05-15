import {
  deskTabListClass,
  deskTabTriggerClass,
} from "@/components/desk-chrome";
import { cn } from "@/lib/utils";

export interface TopDeskTabItem<T extends string> {
  id: T;
  label: string;
  shortcutLabel?: string;
}

export interface TopDeskTabsProps<T extends string> {
  items: TopDeskTabItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  className?: string;
}

export default function TopDeskTabs<T extends string>({
  items,
  activeId,
  onSelect,
  className,
}: TopDeskTabsProps<T>) {
  const columnCount = Math.max(1, items.length);

  return (
    <div className={cn("w-full max-w-xl", className)}>
      <div
        role="tablist"
        aria-label="Primary sections"
        className={cn(deskTabListClass, "select-none")}
        data-tauri-drag-region="false"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = item.id === activeId;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-state={active ? "active" : "inactive"}
              data-tauri-drag-region="false"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              aria-keyshortcuts={item.shortcutLabel?.replace("Cmd", "Meta")}
              title={
                item.shortcutLabel
                  ? `${item.label} (${item.shortcutLabel})`
                  : item.label
              }
              className={cn(deskTabTriggerClass, "select-none")}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
