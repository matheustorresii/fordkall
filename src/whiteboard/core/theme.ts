export type Theme = "dark" | "light";
const KEY = "11a3.theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  applyTheme(t);
}

// default stroke color per theme (so new drawings are visible on the canvas)
export const STROKE_DARK = "#e8ecd9";
export const STROKE_LIGHT = "#1b1e12";
