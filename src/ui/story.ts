import { EXPERIENCES } from "../data/regions";
import { $, announce, esc } from "./dom";
import { lunaSvg, type LunaVoice } from "./luna";
import { GAME, MISSIONS, badgeCount, type Progress } from "./missions";

/**
 * Story screens in one dialog: the welcome (Luna introduces herself), "What would you do?" and the finale
 * (badges, certificate, prompts for grown-ups). Everything else happens in the app itself, with Luna's bubble.
 */
export type SceneId = "welcome" | "game" | "finale";

export interface StoryHost {
  progress: () => Progress;
  save: () => void;
  voice: LunaVoice;
  /** The child pressed "Let's go!" on the welcome screen. */
  start: () => void;
}

const BASE = import.meta.env.BASE_URL;
const WELCOME =
  "Hi, explorer! I'm Luna, the Moon. I go round and round the Earth, and I love listening to it. Satellites measure our planet every day, and we can turn those numbers into music. Shall we find out what Earth is telling us?";

export class Story {
  private dlg = $<HTMLDialogElement>("dlg-story");
  private stage = $("story-stage");
  private gameIndex = 0;
  private closing = false;
  /** Replay the introduction film (set by main). */
  onReplayIntro: (() => void) | null = null;

  constructor(private host: StoryHost) {
    // Closing with Esc or the backdrop silences the story's voice. When close() is called by a button the voice
    // is stopped right away instead: the "close" event fires later and must not cut off a line said afterwards.
    this.dlg.addEventListener("close", () => {
      if (this.closing) this.closing = false;
      else this.host.voice.stop();
    });
  }

  get isOpen(): boolean {
    return this.dlg.open;
  }

  open(scene: SceneId): void {
    this.host.voice.stop();
    this.dlg.dataset.scene = scene;
    this.stage.innerHTML = { welcome: this.welcome, game: this.game, finale: this.finale }[scene].call(this);
    this.stage.querySelectorAll<HTMLButtonElement>("[data-close-story]").forEach((b) => (b.onclick = () => this.close()));
    this.stage.querySelectorAll<HTMLButtonElement>("[data-say]").forEach((b) => (b.onclick = () => this.host.voice.say(b.dataset.say ?? "", true)));
    this.wire(scene);
    if (!this.dlg.open) this.dlg.showModal();
    (this.stage.querySelector<HTMLElement>("[data-autofocus]") ?? this.stage.querySelector<HTMLElement>("button"))?.focus();
    announce(this.stage.querySelector("h2")?.textContent ?? "");
    // After the first tap the browser lets Luna speak; read the screen's words if voice is on.
    const line = this.stage.querySelector<HTMLElement>("[data-line]")?.textContent;
    if (line && scene !== "welcome") this.host.voice.say(line);
  }

  close(): void {
    this.host.voice.stop();
    if (this.dlg.open) {
      this.closing = true;
      this.dlg.close();
    }
  }

  restartGame(): void {
    this.gameIndex = 0;
  }

  private hear(text: string): string {
    return `<button class="round" data-say="${esc(text)}" title="Hear Luna"><svg aria-hidden="true"><use href="#i-sound" /></svg><span class="sr-only">Hear Luna say it</span></button>`;
  }

  // ---------------------------------------------------------------------------
  private welcome(): string {
    return `<div class="scene scene-welcome">
      <button class="pill quiet scene-skip" data-close-story>Skip</button>
      <div class="mini-orbit" aria-hidden="true">
        <div class="mini-earth" style="background-image:url('${BASE}textures/blue-marble.jpg')"></div>
        <div class="mini-luna">${lunaSvg("happy", 84)}</div>
      </div>
      <div class="scene-card">
        <h2 id="story-h">Hi, I'm Luna!</h2>
        <p class="scene-line" data-line>${esc(WELCOME)}</p>
        <div class="row-btns">
          <button class="pill primary big" id="st-go" data-autofocus>Let's go!</button>
          <button class="pill quiet" id="st-intro">🎬 Watch the story again</button>
          ${this.hear(WELCOME)}
        </div>
        <p class="small muted">Luna talks out loud. Press the speaker button any time to make her quiet.</p>
      </div>
    </div>`;
  }

  private game(): string {
    const g = GAME[this.gameIndex];
    if (!g) {
      const end = "You're an Earth helper! Every small thing we do helps. Thank you for thinking about our planet.";
      return `<div class="scene scene-plain">
        <button class="pill quiet scene-skip" data-close-story>Close</button>
        <div class="scene-card center">
          <span>${lunaSvg("proud", 110)}</span>
          <h2 id="story-h">You're an Earth helper!</h2>
          <p class="scene-line" data-line>${esc(end)}</p>
          <div class="row-btns center"><button class="pill" id="game-again">Play again</button><button class="pill primary" data-close-story data-autofocus>Back to the Earth</button></div>
        </div>
      </div>`;
    }
    const line = `${g.situation} ${g.q}`;
    return `<div class="scene scene-plain">
      <button class="pill quiet scene-skip" data-close-story>Close</button>
      <div class="scene-card game-card">
        <p class="eyebrow">What would you do? · ${this.gameIndex + 1} of ${GAME.length}</p>
        <div class="game-top"><span class="game-icon" aria-hidden="true">${g.icon}</span>${lunaSvg("happy", 64)}</div>
        <h2 id="story-h" data-line>${esc(line)}</h2>
        <div class="choices" role="group" aria-label="Choices">
          ${g.options.map((o, i) => `<button class="choice" data-choice="${i}">${esc(o.t)}</button>`).join("")}
        </div>
        <p class="feedback" id="game-feedback" aria-live="polite"></p>
        <button class="pill primary" id="game-next" hidden>Next</button>
      </div>
    </div>`;
  }

  private finale(): string {
    const p = this.host.progress();
    const n = badgeCount(p);
    const earned = EXPERIENCES.filter((e) => p[e.id].badge).map((e) => MISSIONS[e.id]);
    const line =
      n === 3
        ? "Fantastic work, explorer! You listened to the ocean, the forests and Earth's weather. Every part of our planet is connected. Keep exploring, keep asking questions, and never stop listening to Earth!"
        : `Great job! You have ${n} of 3 badges. Visit the other worlds to collect them all.`;
    return `<div class="scene scene-plain">
      <button class="pill quiet scene-skip" data-close-story>Close</button>
      <div class="scene-card">
        <div class="finale-top"><span>${lunaSvg(n === 3 ? "proud" : "encouraging", 96)}</span><div><p class="eyebrow">${n === 3 ? "Mission complete!" : "Your badges"}</p><h2 id="story-h">${n === 3 ? "You did it!" : `${n} of 3 badges`}</h2></div></div>
        ${badgeRow(p)}
        <p class="scene-line" data-line>${esc(line)}</p>
        ${earned.length ? `<h3>What you discovered</h3><ul class="found">${earned.map((m) => `<li><strong>${esc(m.badge)}</strong>: ${esc(m.invite.replace("Let's discover", "you discovered").replace("!", "."))}</li>`).join("")}${p.game ? "<li>You found ways to help in “What would you do?”.</li>" : ""}</ul>` : ""}
        <div class="row-btns">
          <button class="pill" data-story-scene="game">What would you do?</button>
          <button class="pill" data-story-scene="welcome">Meet Luna again</button>
        </div>
        <details class="cert-box">
          <summary>My explorer certificate</summary>
          <label class="ctl">Explorer name (optional, stays on this computer) <input id="cert-name" maxlength="40" value="${esc(p.name)}" autocomplete="off" /></label>
          <button class="pill primary" id="cert-print" ${n === 0 ? "disabled" : ""}>Print my certificate</button>
          ${n === 0 ? `<p class="small muted">Earn a badge first.</p>` : ""}
        </details>
        <details class="cert-box">
          <summary>For parents and teachers</summary>
          <ul class="small">
            <li>What did the music do when the sea got warmer? Can you hum it?</li>
            <li>Which two years did you compare? What was different in the numbers?</li>
            <li>Why can't one warm week prove that a coral reef bleached? What else would scientists check?</li>
            <li>In Luna's playground, what happened to the forest sounds when the forest was taken away? Why was that only pretend?</li>
            <li>What is one thing your family could do this week to save water or keep a beach or park clean?</li>
          </ul>
        </details>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  private wire(scene: SceneId) {
    this.stage.querySelectorAll<HTMLButtonElement>("[data-story-scene]").forEach((b) => (b.onclick = () => {
      if (b.dataset.storyScene === "game") this.gameIndex = 0;
      this.open(b.dataset.storyScene as SceneId);
    }));
    if (scene === "welcome") {
      const replay = document.getElementById("st-intro");
      if (replay) replay.onclick = () => {
        this.close();
        this.onReplayIntro?.();
      };
      $("st-go").onclick = () => {
        const p = this.host.progress();
        p.intro = true;
        this.host.save();
        this.close();
        this.host.start();
      };
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
        $("game-feedback").textContent = o.why;
        this.host.voice.say(o.why);
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
}

export function badgeRow(p: Progress): string {
  return `<ul class="badge-row" aria-label="Badges">${EXPERIENCES.map((e) => {
    const m = MISSIONS[e.id];
    const on = p[e.id].badge;
    return `<li class="badge b-${e.id} ${on ? "on" : ""}"><span class="badge-icon" aria-hidden="true">${on ? m.badgeIcon : "?"}</span><span class="small">${esc(m.badge)}</span><span class="sr-only">${on ? "earned" : "not earned yet"}</span></li>`;
  }).join("")}</ul>`;
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
    <p>listened to real measurements of our planet turned into music with Luna, and earned:</p>
    <ul>${earned.map((m) => `<li>${m.badgeIcon} ${esc(m.badge)} badge</li>`).join("")}</ul>
    <p class="cert-small">Sounds were made by EARTHSONA from NASA and NOAA data. ${new Date().toLocaleDateString()}</p>
  </div>`;
  window.print();
}
