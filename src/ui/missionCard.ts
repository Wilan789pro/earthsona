import type { ExperienceId, RegionDef } from "../data/types";
import { astronautSvg, voiceBar, wireVoiceBars, type BuddyVoice } from "./astronaut";
import { $, announce, esc } from "./dom";
import { MISSIONS, STEPS, type Progress, type StepIndex } from "./missions";

/**
 * The mission card at the top of the right panel: the astronaut, the seven steps of the current world's
 * mission and one clear action per step. The child controls the pace: Back / Next always work, steps can be
 * done in any order, and nothing plays or speaks until a button is pressed.
 */
export interface MissionHost {
  experience: () => ExperienceId;
  region: () => RegionDef;
  hasData: () => boolean;
  progress: () => Progress;
  save: () => void;
  voice: BuddyVoice;
  enter: (anim: "dive" | "land" | "clouds") => void;
  showData: () => void;
  listen: () => Promise<void>;
  compare: () => void;
  impact: () => void;
  badgeEarned: (exp: ExperienceId) => void;
}

const ENTER_LABEL = { dive: "🚀 Dive into the ocean", land: "🛬 Land in the forest", clouds: "☁️ Fly through the clouds" };

export class MissionCard {
  constructor(private host: MissionHost) {
    $("mc-back").onclick = () => this.go(-1);
    $("mc-next").onclick = () => this.go(1);
    $("mc-buddy").innerHTML = astronautSvg({ pose: "wave", size: "64" });
  }

  private get mp() {
    return this.host.progress()[this.host.experience()];
  }

  /** Mark a step done for a world (default: the current world) and refresh. */
  markDone(step: StepIndex, exp: ExperienceId = this.host.experience()): void {
    const mp = this.host.progress()[exp];
    if (mp.done[step]) return;
    mp.done[step] = true;
    this.host.save();
    if (exp === this.host.experience()) this.renderSteps();
  }

  setStep(step: number): void {
    this.mp.step = Math.max(0, Math.min(STEPS.length - 1, step));
    this.host.save();
    this.render();
  }

  private go(d: 1 | -1) {
    this.setStep(this.mp.step + d);
    $("mc-step-title").focus();
  }

  render(): void {
    const exp = this.host.experience();
    const m = MISSIONS[exp];
    const step = this.mp.step as StepIndex;
    const r = this.host.region();
    $("mc-kicker").textContent = `${m.icon} Mission${this.mp.badge ? ` · ${m.badgeIcon} badge earned` : ""}`;
    $("mc-title").textContent = m.title;
    $("mc-stepof").textContent = `Step ${step + 1} of ${STEPS.length} · 📍 ${r.short ?? r.name}`;
    $("mc-step-title").textContent = STEPS[step];
    $("mc-step-title").tabIndex = -1;
    this.renderSteps();
    $("mc-line").innerHTML = voiceBar("mission", esc(m.lines[step]));
    wireVoiceBars($("mc-line"), this.host.voice);
    ($("mc-back") as HTMLButtonElement).disabled = step === 0;
    ($("mc-next") as HTMLButtonElement).disabled = step === STEPS.length - 1;
    this.renderBody(step);
  }

  private renderSteps() {
    const mp = this.mp;
    const ol = $("mc-steps");
    ol.innerHTML = STEPS.map(
      (s, i) =>
        `<li><button class="mc-dot ${mp.done[i] ? "done" : ""}" data-step="${i}" ${i === mp.step ? 'aria-current="step"' : ""} title="${esc(s)}"><span aria-hidden="true">${mp.done[i] ? "✓" : i + 1}</span><span class="sr-only">Step ${i + 1}: ${esc(s)}${mp.done[i] ? " (done)" : ""}</span></button></li>`,
    ).join("");
    ol.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) => (b.onclick = () => this.setStep(+b.dataset.step!)));
  }

  private renderBody(step: StepIndex) {
    const exp = this.host.experience();
    const m = MISSIONS[exp];
    const body = $("mc-body");
    const btn = (id: string, label: string, primary = true) => `<button class="btn ${primary ? "primary" : ""} mc-action" id="${id}">${label}</button>`;
    switch (step) {
      case 0:
        body.innerHTML = btn("mc-do", ENTER_LABEL[m.enterAnim]);
        $("mc-do").onclick = () => (this.host.enter(m.enterAnim), this.markDone(0));
        break;
      case 1:
        body.innerHTML = this.host.hasData()
          ? btn("mc-do", "📊 Show me the measurements")
          : `<p class="small">There is no real data downloaded for this place yet, so there are no measurements to show. Pick another place on the left.</p>`;
        document.getElementById("mc-do")?.addEventListener("click", () => (this.host.showData(), this.markDone(1)));
        break;
      case 2:
        body.innerHTML =
          btn("mc-do", `▶ ${esc(m.listenLabel)}`) +
          `<p class="small">${this.host.hasData() ? { ocean: "When the pitch changes, it represents a change in the measured ocean temperature.", forest: "When the pitch changes, it represents a change in how green the land was measured to be.", pulse: "Pitch follows the temperature, beats follow the rain and brightness follows the sunshine." }[exp] : "No measurements here yet, so you will hear the nature sounds only."}</p>`;
        $("mc-do").onclick = async () => {
          await this.host.listen();
          this.markDone(2);
        };
        break;
      case 3:
        body.innerHTML = this.host.hasData() ? btn("mc-do", "✦ Compare two real times") + `<p class="small">Listen to A and to B. Both are real measurements.</p>` : `<p class="small">Comparing needs real measurements. Pick a place with data.</p>`;
        document.getElementById("mc-do")?.addEventListener("click", () => this.host.compare());
        break;
      case 4:
        body.innerHTML = btn("mc-do", "🔍 Open the Earth Impact Explorer");
        $("mc-do").onclick = () => (this.host.impact(), this.markDone(4));
        break;
      case 5: {
        const c = m.challenge;
        body.innerHTML = `<p class="mc-q">${esc(c.q)}</p><div class="choices">${c.options.map((o, i) => `<button class="choice" data-c="${i}">${esc(o.t)}</button>`).join("")}</div><p class="feedback" id="mc-feedback" aria-live="polite"></p>`;
        body.querySelectorAll<HTMLButtonElement>("[data-c]").forEach((b) => (b.onclick = () => {
          const o = c.options[+b.dataset.c!];
          b.classList.add(o.ok ? "right" : "wrong");
          $("mc-feedback").textContent = `${o.ok ? "✅" : "🤔"} ${o.why}`;
          if (o.ok) {
            this.markDone(5);
            body.querySelectorAll<HTMLButtonElement>("[data-c]").forEach((x) => (x.disabled = true));
          }
        }));
        break;
      }
      case 6: {
        const mp = this.mp;
        body.innerHTML =
          `<ul class="actions">${m.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` +
          (mp.badge ? `<p class="badge-won"><span aria-hidden="true">${m.badgeIcon}</span> You earned the <strong>${esc(m.badge)}</strong> badge!</p>` + btn("mc-more", "🗺️ Choose another mission", false) : btn("mc-do", `🏅 Collect my ${esc(m.badge)} badge`));
        document.getElementById("mc-do")?.addEventListener("click", () => {
          mp.badge = true;
          this.markDone(6);
          this.host.save();
          this.render();
          announce(`You earned the ${m.badge} badge!`);
          this.host.badgeEarned(exp);
        });
        document.getElementById("mc-more")?.addEventListener("click", () => this.host.badgeEarned(exp));
        break;
      }
    }
  }
}
