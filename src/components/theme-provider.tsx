"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "adaptive";

export const themeStorageKey = "curatube:theme";

export function getInitialTheme(): ThemePreference {
  if (typeof window === "undefined") return "adaptive";
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" || stored === "adaptive"
    ? stored
    : "adaptive";
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyThemePreference(theme: ThemePreference) {
  const dark = theme === "dark" || (theme === "adaptive" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => getInitialTheme());

  useEffect(() => {
    applyThemePreference(theme);

    if (theme !== "adaptive") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyThemePreference(theme);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  function setTheme(next: ThemePreference) {
    window.localStorage.setItem(themeStorageKey, next);
    setThemeState(next);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
