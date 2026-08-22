"use client";

import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { buttonTap } from "@/lib/motion";

type TabItem<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  layoutId: string;
  className?: string;
  itemClassName?: string;
};

export function SegmentedTabs<T extends string>({
  items,
  value,
  onValueChange,
  ariaLabel,
  layoutId,
  className,
  itemClassName,
}: Props<T>) {
  const reduce = useReducedMotion();

  function focusTab(next: number) {
    const target = items[next];
    if (!target) return;
    onValueChange(target.value);
    requestAnimationFrame(() =>
      document.getElementById(`${layoutId}-${target.value}`)?.focus(),
    );
  }

  return (
    <LayoutGroup id={layoutId}>
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          "radius-control inline-flex items-center border border-border bg-card p-1 shadow-soft",
          className,
        )}
      >
        {items.map((item, index) => {
          const active = item.value === value;
          return (
            <motion.button
              data-motion-button
              key={item.value}
              id={`${layoutId}-${item.value}`}
              type="button"
              aria-pressed={active}
              tabIndex={0}
              onClick={() => onValueChange(item.value)}
              whileTap={reduce ? undefined : buttonTap}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  focusTab((index + 1) % items.length);
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  focusTab((index - 1 + items.length) % items.length);
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  focusTab(0);
                }
                if (event.key === "End") {
                  event.preventDefault();
                  focusTab(items.length - 1);
                }
              }}
              className={cn(
                "radius-control relative min-h-10 cursor-pointer px-5 py-2.5 text-sm capitalize outline-none transition-colors duration-100 ease-out focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                itemClassName,
                active
                  ? "font-semibold text-selection-foreground"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {active && (
                <motion.div
                  layoutId="tab-panel"
                  initial={false}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 420, damping: 32 }
                  }
                  className="radius-control absolute inset-0 border border-selection-hover bg-selection shadow-soft"
                />
              )}
              <span className="relative z-10">{item.label}</span>
            </motion.button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
