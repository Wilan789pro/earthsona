import type { ExperienceId } from "../data/types";
import { EXPERIENCES, getExperience, getRegion } from "../data/regions";
import { astronautSvg, shipSvg, voiceBar, wireVoiceBars, type BuddyVoice } from "./astronaut";
import { $, announce, esc } from "./dom";
import { GAME, MISSIONS, STEPS, badgeCount, type Progress } from "./missions";

/**
 * Story scenes shown in one full-screen dialog:
 *   message  (Scene 1: the mysterious message)   welcome (Scene 2: welcome aboard)
 *   missions (Scene 4: choose your mission)       game    (Scene 9: what would you do?)
 *   finale   (Scene 10: mission complete, certificate, discussion prompts)
 * Scene 3 (explore the Earth) is the real globe; scenes 5–8 run inside the app (mission card, player, Lab,
 * Earth Impact Explorer). Every scene can be skipped or closed; nothing speaks unless "Hear it" is pressed.
 */
export type SceneId = "message" | "welcome" | "missions" | "game" | "finale";

export interface StoryHost {
  progress: () => Progress;
  save: () => void;
  voice: BuddyVoice;
  /** Called when the child leaves the opening (Scene 2 → Scene 3). */
  explore: () => void;
  chooseMission: (exp: ExperienceId) => void;
}

const BASE = import.meta.env.BASE_URL;
const earthImg = `${BASE}textures/blue-marble.jpg`;

export class Story {
  private dlg = $<HTMLDialogElement>("dlg-story");
  private stage = $("story-stage");
  private gameIndex = 0;

  constructor(private host: StoryHost) {
    this.dlg.addEventListener("close", () => this.host.voice.stop());
  }

  get isOpen(): boolean {
    return this.dlg.open;
  }

  open(scene: SceneId): void {
    this.host.voice.stop();
    this.dlg.dataset.scene = scene;
    const html = { message: this.message, welcome: this.welcome, missions: this.missions, game: this.game, finale: this.finale }[scene].call(this);
    this.stage.innerHTML = html;
    wireVoiceBars(this.stage, this.host.voice);
    this.stage.querySelectorAll<HTMLButtonElement>("[data-close-story]").forEach((b) => (b.onclick = () => this.close()));
    this.stage.querySelectorAll<HTMLButtonElement>("[data-scene]").forEach((b) => (b.onclick = () => this.open(b.dataset.scene as SceneId)));
    this.wire(scene);
    if (!this.dlg.open) this.dlg.showModal();
    const focus = this.stage.querySelector<HTMLElement>("[data-autofocus]") ?? this.stage.querySelector<HTMLElement>("button");
    focus?.focus();
    announce(this.stage.querySelector("h2")?.textContent ?? "");
  }

  close(): void {
    this.host.voice.stop();
    if (this.dlg.open) this.dlg.close();
  }

  // ---------------------------------------------------------------------------
  private message(): string {
    return `<div class="scene scene-space">
      <div class="stars" aria-hidden="true"></div>
      <div class="earth-far" aria-hidden="true" style="background-image:url('${earthImg}')"></div>
      <div class="ship-fly" aria-hidden="true">${shipSvg()}</div>
      <button class="btn small ghost scene-skip" data-close-story>Skip intro</button>
      <div class="scene-panel">
        <div class="scene-buddy">${astronautSvg({ pose: "point", size: "130" })}</div>
        <div class="tablet">
          <p class="eyebrow">Scene 1 · The mysterious message</p>
          <h2 id="story-h">📩 A message from Earth!</h2>
          <div id="st-ping" class="tablet-ping"><span class="ping-dot" aria-hidden="true"></span> 1 new message</div>
          <button class="btn primary big-btn" id="st-open" data-autofocus>Open the message</button>
          <div id="st-msg" hidden>
            ${voiceBar("msg", "Explorer! We've received a special message from Earth. Our planet is changing, and scientists are studying what's happening. But did you know we can turn Earth's information into music? Let's investigate!")}
            <button class="btn primary big-btn" data-scene="welcome">🚀 Start mission</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  private welcome(): string {
    const p = this.host.progress();
    return `<div class="scene scene-space">
      <div class="stars" aria-hidden="true"></div>
      <button class="btn small ghost scene-skip" data-close-story>Skip intro</button>
      <div class="scene-panel">
        <div class="scene-buddy">${astronautSvg({ pose: "wave", size: "140" })}</div>
        <div class="tablet holo">
          <p class="eyebrow">Scene 2 · Welcome aboard!</p>
          <h2 id="story-h">Hello, explorer!</h2>
          <div class="holo-earth" aria-hidden="true" style="background-image:url('${earthImg}')"></div>
          ${voiceBar("welcome", "Hello, explorer! I'm your space buddy. Together, we're going to visit different parts of Earth, listen to its music and discover why our planet is so special.")}
          ${this.badgeRow(p)}
          <button class="btn primary big-btn" id="st-go" data-autofocus>Let's go! 🌍</button>
        </div>
      </div>
    </div>`;
  }

  private missions(): string {
    const p = this.host.progress();
    const cards = EXPERIENCES.map((e) => {
      const m = MISSIONS[e.id];
      const mp = p[e.id];
      const done = mp.done.filter(Boolean).length;
      const place = getRegion(getExperience(e.id).regions[0])!;
      return `<li class="mission-pick m-${e.id}">
        <div class="mp-art" aria-hidden="true"><span>${m.icon}</span></div>
        <h3>${esc(m.title)}</h3>
        <p>${esc(m.invite)}</p>
        <p class="small"><span aria-hidden="true">📍</span> Starts at ${esc(place.short ?? place.name)} · you can change place later</p>
        <div class="mp-progress" role="img" aria-label="${done} of ${STEPS.length} steps done${mp.badge ? ", badge earned" : ""}">
          <span style="width:${(done / STEPS.length) * 100}%"></span>
        </div>
        <p class="small muted">${done}/${STEPS.length} steps ${mp.badge ? `· ${m.badgeIcon} badge earned!` : ""}</p>
        <button class="btn primary big-btn" data-mission="${e.id}">${done ? "Continue" : "Start"} ${esc(m.title)}</button>
      </li>`;
    }).join("");
    return `<div class="scene scene-choose">
      <div class="stars" aria-hidden="true"></div>
      <button class="btn small ghost scene-skip" data-close-story>Close</button>
      <div class="choose-head">
        <div class="scene-buddy small">${astronautSvg({ pose: "point", size: "80" })}</div>
        <div><p class="eyebrow">Scene 4 · Choose your mission</p><h2 id="story-h">Where shall we go first?</h2><p class="small">You can do the missions in any order.</p></div>
      </div>
      <ul class="mission-picks">${cards}</ul>
    </div>`;
  }

  private game(): string {
    const g = GAME[this.gameIndex];
    if (!g) {
      return `<div class="scene scene-choose">
        <button class="btn small ghost scene-skip" data-close-story>Close</button>
        <div class="game-end">
          <div class="scene-buddy">${astronautSvg({ pose: "wave", size: "120" })}</div>
          <h2 id="story-h">You're an Earth helper! 🌟</h2>
          <p>Every small action helps. Thank you for thinking about our planet.</p>
          <div class="row-btns"><button class="btn" id="game-again">Play again</button><button class="btn primary" data-close-story data-autofocus>Back to exploring</button></div>
        </div>
      </div>`;
    }
    return `<div class="scene scene-choose">
      <button class="btn small ghost scene-skip" data-close-story>Close</button>
      <p class="eyebrow">Scene 9 · What would you do? (${this.gameIndex + 1} of ${GAME.length})</p>
      <div class="game-card">
        <div class="game-icon" aria-hidden="true">${g.icon}</div>
        <h2 id="story-h">${esc(g.situation)}</h2>
        <p class="game-q">${esc(g.q)}</p>
        <div class="choices" role="group" aria-label="Choices">
          ${g.options.map((o, i) => `<button class="choice" data-choice="${i}">${esc(o.t)}</button>`).join("")}
        </div>
        <p class="feedback" id="game-feedback" aria-live="polite"></p>
        <button class="btn primary" id="game-next" hidden>Next ▶</button>
      </div>
    </div>`;
  }

  private finale(): string {
    const p = this.host.progress();
    const n = badgeCount(p);
    const earned = EXPERIENCES.filter((e) => p[e.id].badge).map((e) => MISSIONS[e.id]);
    return `<div class="scene scene-space finale">
      <div class="stars" aria-hidden="true"></div>
      <button class="btn small ghost scene-skip" data-close-story>Close</button>
      <div class="scene-panel">
        <div class="scene-buddy">${astronautSvg({ pose: "wave", size: "130" })}</div>
        <div class="tablet holo">
          <p class="eyebrow">Scene 10 · Mission complete!</p>
          <h2 id="story-h">${n === 3 ? "Fantastic work, explorer!" : `${n} of 3 badges so far!`}</h2>
          <div class="holo-earth small" aria-hidden="true" style="background-image:url('${earthImg}')"></div>
          ${this.badgeRow(p)}
          ${voiceBar("finale", n === 3 ? "Fantastic work, explorer! You listened to the ocean, discovered the forests and explored Earth's changing weather. You learned that every part of our planet is connected. Keep exploring, keep asking questions and never stop listening to Earth!" : "Great progress, explorer! Finish the other missions to collect every badge.")}
          <h3>What you discovered</h3>
          <ul class="small">${earned.length ? earned.map((m) => `<li>${m.badgeIcon} <strong>${esc(m.badge)}</strong>: ${esc(m.invite.replace("Let's discover", "you discovered").replace("!", "."))}</li>`).join("") : "<li>Start a mission to make your first discovery.</li>"}${p.game ? "<li>🌟 You found ways to help in “What would you do?”.</li>" : ""}</ul>
          <div class="row-btns">
            <button class="btn" data-scene="message">↻ Replay the story</button>
            <button class="btn" data-scene="game">🌟 What would you do?</button>
          </div>
          <details class="cert-box">
            <summary>🖨️ My explorer certificate</summary>
            <label class="ctl">Explorer name (optional, stays on this computer) <input id="cert-name" maxlength="40" value="${esc(p.name)}" autocomplete="off" /></label>
            <button class="btn primary" id="cert-print" ${n === 0 ? "disabled" : ""}>Print certificate</button>
            ${n === 0 ? `<p class="small muted">Earn a badge first.</p>` : ""}
          </details>
          <details class="cert-box">
            <summary>👩‍🏫 For parents and teachers</summary>
            <ul class="small">
              <li>What did the music do when the sea got warmer? Can you hum it?</li>
              <li>Which two times did you compare? What was different in the numbers?</li>
              <li>Why can't one warm week prove that a coral reef bleached? What else would scientists check?</li>
              <li>What is one thing your family could do this week to save water or keep a beach or park clean?</li>
              <li>The sounds are made by a computer from real numbers. They are not recordings from space. Why do you think scientists turn data into sound?</li>
            </ul>
          </details>
        </div>
      </div>
    </div>`;
  }

  private badgeRow(p: Progress): string {
    return `<ul class="badge-row" aria-label="Mission badges">${EXPERIENCES.map((e) => {
      const m = MISSIONS[e.id];
      const on = p[e.id].badge;
      return `<li class="badge ${on ? "on" : ""}"><span class="badge-icon" aria-hidden="true">${on ? m.badgeIcon : "🔒"}</span><span class="small">${esc(m.badge)}</span><span class="sr-only">${on ? "earned" : "not earned yet"}</span></li>`;
    }).join("")}</ul>`;
  }

  // ---------------------------------------------------------------------------
  private wire(scene: SceneId) {
    if (scene === "message") {
      $("st-open").onclick = () => {
        $("st-ping").hidden = true;
        $("st-open").hidden = true;
        $("st-msg").hidden = false;
        (this.stage.querySelector("#st-msg [data-say]") as HTMLElement).focus();
      };
    }
    if (scene === "welcome") {
      $("st-go").onclick = () => {
        const p = this.host.progress();
        p.intro = true;
        this.host.save();
        this.stage.querySelector(".holo-earth")?.classList.add("expand");
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.setTimeout(() => {
          this.close();
          this.host.explore();
        }, reduce ? 0 : 650);
      };
    }
    if (scene === "missions") {
      this.stage.querySelectorAll<HTMLButtonElement>("[data-mission]").forEach((b) => (b.onclick = () => {
        this.close();
        this.host.chooseMission(b.dataset.mission as ExperienceId);
      }));
    }
    if (scene === "game") {
      const again = document.getElementById("game-again");
      if (again) again.onclick = () => ((this.gameIndex = 0), this.open("game"));
      const g = GAME[this.gameIndex];
      if (!g) {
        const p = this.host.progress();
        p.game = true;
        this.host.save();
        return;
      }
      this.stage.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((b) => (b.onclick = () => {
        const o = g.options[+b.dataset.choice!];
        b.classList.add(o.ok ? "right" : "wrong");
        $("game-feedback").textContent = `${o.ok ? "✅" : "🤔"} ${o.why}`;
        if (o.ok) {
          this.stage.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((x) => (x.disabled = true));
          const next = $("game-next");
          next.hidden = false;
          next.onclick = () => (this.gameIndex++, this.open("game"));
          next.focus();
        }
      }));
    }
    if (scene === "finale") {
      const p = this.host.progress();
      p.finale = true;
      this.host.save();
      const name = $<HTMLInputElement>("cert-name");
      name.oninput = () => ((p.name = name.value.slice(0, 40)), this.host.save());
      $("cert-print").onclick = () => printCertificate(p);
    }
  }

  /** Reset the game to its first situation (used when it is opened from a menu). */
  restartGame(): void {
    this.gameIndex = 0;
  }
}

/** A printable certificate. Printing is the browser's own dialog; nothing is sent anywhere. */
export function printCertificate(p: Progress): void {
  let area = document.getElementById("print-area");
  if (!area) {
    area = document.createElement("div");
    area.id = "print-area";
    document.body.appendChild(area);
  }
  const earned = EXPERIENCES.filter((e) => p[e.id].badge).map((e) => MISSIONS[e.id]);
  area.innerHTML = `<div class="certificate">
    <p class="cert-top">EARTHSONA · Hear the Earth. Understand the Change.</p>
    <h1>Earth Explorer Certificate</h1>
    <p class="cert-name">${esc(p.name.trim() || "Explorer")}</p>
    <p>listened to real measurements of our planet turned into music, and earned:</p>
    <ul>${earned.map((m) => `<li>${m.badgeIcon} ${esc(m.badge)} badge</li>`).join("")}</ul>
    <p class="cert-small">Sounds were made by EARTHSONA from NASA and NOAA data. ${new Date().toLocaleDateString()}</p>
  </div>`;
  window.print();
}
