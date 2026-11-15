import type { Luna, Mood } from "./luna";
import { announce } from "./dom";

/**
 * Luna's short guided tour: five spotlights (globe, missions, sound player, graph, Earth Sound Lab), one short
 * line each. Optional: Skip / Esc at any time, never blocks the app, replayable with the "Tour" button.
 * Shown automatically once, after the intro film and the welcome.
 */
export interface TourStep {
  target: string;
  title: string;
  text: string;
  mood: Mood;
}

export const TOUR_STEPS: TourStep[] = [
  { target: "#bubble", title: "Hello, explorer!", text: "Welcome to EARTHSONA! I'm Luna, and I'll be your guide. Together, we'll explore our planet, discover its secrets and listen to the changes happening all around us!", mood: "happy" },
  { target: "#space", title: "Our Earth", text: "Over here, you can explore Earth! Drag it to turn it, and tap a dot to visit a place.", mood: "happy" },
  { target: "#experience-list", title: "Three missions", text: "These are our three missions. Each one lets you discover a different part of our planet.", mood: "curious" },
  { target: ".graph-box", title: "Real measurements", text: "Here, you can see the scientific measurements. Each dot is a real measurement from space.", mood: "thoughtful" },
  { target: ".player-box", title: "Data becomes music", text: "Press play, and the measurements turn into music. Higher numbers make higher notes!", mood: "happy" },
  { target: "#btn-lab", title: "Earth Sound Lab", text: "And this is our Earth Sound Lab, where you can experiment with different conditions!", mood: "surprised" },
];
export const TOUR_LINES = TOUR_STEPS.map((s) => s.text);
const SEEN_KEY = "earthsona:tourSeen";

export class Tour {
  private i = -1;
  private root: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private onResize = () => this.place();
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.end(true);
    } else if (e.key === "Tab" && this.root) {
      // keep keyboard focus inside the tour card while it is open
      const items = [...this.root.querySelectorAll<HTMLElement>("button")];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    }
  };

  constructor(private luna: Luna) {}

  get open(): boolean {
    return this.i >= 0;
  }

  static seen(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.open) return;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.root = document.createElement("div");
    this.root.className = "tour";
    this.root.innerHTML = `
      <div class="tour-spot" aria-hidden="true"></div>
      <div class="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-text">
        <p class="tour-count small" id="tour-count"></p>
        <h2 class="tour-title" id="tour-title"></h2>
        <p class="tour-text" id="tour-text"></p>
        <div class="tour-btns">
          <button class="pill quiet small" id="tour-skip">Skip tour</button>
          <span class="tour-nav">
            <button class="pill small" id="tour-back">◀ Back</button>
            <button class="pill primary" id="tour-next">Next ▶</button>
          </span>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.root.querySelector<HTMLButtonElement>("#tour-skip")!.onclick = () => this.end(true);
    this.root.querySelector<HTMLButtonElement>("#tour-next")!.onclick = () => this.next();
    this.root.querySelector<HTMLButtonElement>("#tour-back")!.onclick = () => this.back();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onKey, true);
    this.i = -1;
    this.next();
  }

  private back(): void {
    if (this.i <= 0) return;
    this.i -= 2;
    this.next();
  }

  private next(): void {
    this.i++;
    if (this.i >= TOUR_STEPS.length) return this.end(false);
    this.root!.querySelector<HTMLButtonElement>("#tour-back")!.hidden = this.i === 0;
    const s = TOUR_STEPS[this.i];
    const el = document.querySelector<HTMLElement>(s.target);
    el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    this.root!.querySelector("#tour-count")!.textContent = `${this.i + 1} of ${TOUR_STEPS.length}`;
    this.root!.querySelector("#tour-title")!.textContent = s.title;
    this.root!.querySelector("#tour-text")!.textContent = s.text;
    this.root!.querySelector("#tour-next")!.textContent = this.i === TOUR_STEPS.length - 1 ? "Let's explore! ✓" : "Next ▶";
    document.querySelectorAll(".tour-target").forEach((x) => x.classList.remove("tour-target"));
    el?.classList.add("tour-target");
    this.luna.say(s.text, { mood: s.mood });
    announce(`Tour step ${this.i + 1} of ${TOUR_STEPS.length}: ${s.title}. ${s.text}`);
    // place after the scroll has moved the page
    this.place();
    window.setTimeout(() => this.place(), 450);
    this.root!.querySelector<HTMLButtonElement>("#tour-next")!.focus();
  }

  /** Spotlight around the current target and the card next to it (below if there is room, else above). */
  private place(): void {
    if (!this.root || this.i < 0) return;
    const el = document.querySelector<HTMLElement>(TOUR_STEPS[this.i].target);
    const spot = this.root.querySelector<HTMLElement>(".tour-spot")!;
    const card = this.root.querySelector<HTMLElement>(".tour-card")!;
    if (!el) {
      spot.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 8;
    spot.style.display = "";
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const cw = Math.min(360, innerWidth - 24);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight || 170;
    let top = r.bottom + 16;
    if (top + ch > innerHeight - 8) top = r.top - ch - 16;
    // phones and big targets (the globe): the card sits at the bottom of the screen
    if (innerWidth < 700 || top < 8) top = innerHeight - ch - 12;
    top = Math.min(Math.max(8, top), Math.max(8, innerHeight - ch - 8));
    const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12);
    Object.assign(card.style, { top: `${top}px`, left: `${left}px` });
  }

  end(skipped: boolean): void {
    if (!this.open) return;
    this.i = -1;
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode: the tour may show again next time */
    }
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("keydown", this.onKey, true);
    document.querySelectorAll(".tour-target").forEach((x) => x.classList.remove("tour-target"));
    this.root?.remove();
    this.root = null;
    // the spotlights scrolled panels to their targets: put everything back where the explorer starts
    document.querySelectorAll<HTMLElement>(".side").forEach((el) => (el.scrollTop = 0));
    window.scrollTo({ top: 0 });
    this.luna.say(skipped ? "Okay! You can see the tour again with the Tour button." : "Have fun exploring! Pick a world and press play.", { mood: "happy" });
    announce(skipped ? "Tour skipped." : "Tour finished.");
    this.returnFocus?.focus?.();
  }
}
