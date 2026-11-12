export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function announce(msg: string): void {
  const el = $("sr-status");
  el.textContent = "";
  requestAnimationFrame(() => (el.textContent = msg));
}

let noticeTimer: number | undefined;
export function notice(msg: string): void {
  const el = $("notice");
  el.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-wifi-off"/></svg><span>${esc(msg)}</span>`;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (el.textContent = ""), 10000);
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Per-viewer convenience storage; the app works when storage is blocked. */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`earthsona.${key}`);
    return v === null ? fallback : { ...fallback, ...JSON.parse(v) };
  } catch {
    return fallback;
  }
}
export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`earthsona.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Accessible tabs with roving tabindex (WAI-ARIA tabs pattern). */
export function setupTabs(list: HTMLElement, onChange?: (id: string) => void): (id: string) => void {
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (id: string, focus = false) => {
    for (const t of tabs) {
      const on = t.id === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")!).hidden = !on;
      if (on && focus) t.focus();
    }
    onChange?.(id);
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t.id));
    t.addEventListener("keydown", (e) => {
      let j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = tabs.length - 1;
      if (j >= 0) {
        e.preventDefault();
        e.stopPropagation();
        select(tabs[j].id, true);
      }
    });
  });
  return (id: string) => select(id);
}
