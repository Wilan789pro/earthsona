import { $, esc } from "./dom";

/** Optional guided listening: Discover → Learn → Listen → Explore → Understand. Skippable at any step. */
export interface GuideStep {
  title: string;
  body: string;
  action: string;
  run: () => void;
}

export class Guide {
  private i = 0;

  constructor(private steps: GuideStep[], private onSkip: () => void) {
    $("guide-prev").addEventListener("click", () => this.go(this.i - 1));
    $("guide-next").addEventListener("click", () => (this.i < this.steps.length - 1 ? this.go(this.i + 1) : this.onSkip()));
    $("guide-do").addEventListener("click", () => this.steps[this.i].run());
    $("guide-skip").addEventListener("click", () => this.onSkip());
    this.render();
  }

  go(i: number): void {
    this.i = Math.max(0, Math.min(this.steps.length - 1, i));
    this.render();
  }

  private render(): void {
    const ol = $("guide-steps");
    ol.innerHTML = "";
    this.steps.forEach((s, k) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.textContent = `${k + 1}. ${s.title}`;
      if (k === this.i) b.setAttribute("aria-current", "step");
      b.addEventListener("click", () => this.go(k));
      li.appendChild(b);
      ol.appendChild(li);
    });
    const s = this.steps[this.i];
    $("guide-body").innerHTML = `<h3>${this.i + 1} · ${esc(s.title)}</h3><p>${s.body}</p>`;
    $("guide-do").textContent = s.action;
    $<HTMLButtonElement>("guide-prev").disabled = this.i === 0;
    $("guide-next").textContent = this.i === this.steps.length - 1 ? "Finish" : "Next";
  }
}
