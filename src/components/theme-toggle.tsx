"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";
import type { ThemePreference } from "./theme-provider";

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "adaptive", label: "Adaptive", icon: Monitor }
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeMenuOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [open]);

  const activeOption = options.find((option) => option.value === theme) ?? options[2];
  const ActiveIcon = activeOption.icon;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Theme: ${activeOption.label}`}
        title={`Theme: ${activeOption.label}`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line-strong bg-surface text-ink transition hover:bg-cloud sm:h-9 sm:w-9"
      >
        <ActiveIcon size={18} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {options.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(option.value);
                  setOpen(false);
                }}
                className={`flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-semibold transition ${
                  active ? "bg-invert text-white" : "text-soft hover:bg-cloud"
                }`}
              >
                <Icon size={16} />
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
