import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        cloud: "rgb(var(--color-cloud) / <alpha-value>)",
        moss: "rgb(var(--color-moss) / <alpha-value>)",
        rust: "rgb(var(--color-rust) / <alpha-value>)",
        invert: "rgb(var(--color-invert) / <alpha-value>)",
        "invert-hover": "rgb(var(--color-invert-hover) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        "line-strong": "rgb(var(--color-line-strong) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        faint: "rgb(var(--color-faint) / <alpha-value>)",
        placeholder: "rgb(var(--color-placeholder) / <alpha-value>)",
        soft: "rgb(var(--color-soft) / <alpha-value>)",
        body: "rgb(var(--color-body) / <alpha-value>)",
        track: "rgb(var(--color-track) / <alpha-value>)",
        rowline: "rgb(var(--color-rowline) / <alpha-value>)",
        mark: "rgb(var(--color-mark) / <alpha-value>)"
      }
    }
  },
  plugins: []
};

export default config;
