import { $, esc } from "./dom";

/**
 * Luna — the Moon, EARTHSONA's guide. She sits beside her speech bubble (always visible, never hidden behind
 * the globe), shows how she feels about what is happening, and speaks with Kokoro (af_heart).
 * The explorer — the astronaut girl from the introduction video — is the child playing.
 */

// ---------------------------------------------------------------------------
// Drawing: one consistent character, seven expressions (+ talking mouth that keeps the expression's eyes)
// ---------------------------------------------------------------------------
let uid = 0;
export type Mood = "happy" | "curious" | "surprised" | "thoughtful" | "concerned" | "encouraging" | "proud" | "sleepy" | "talk" | "wow";

const INK = "#3b2f4a";
const eye = (cx: number, cy: number, rx = 5.6, ry = 6.6, look = [0, 0]) =>
  `<ellipse cx="${cx + look[0]}" cy="${cy + look[1]}" rx="${rx}" ry="${ry}" fill="${INK}"/><circle cx="${cx + 2 + look[0]}" cy="${cy - 2.5 + look[1]}" r="2.2" fill="#fff"/><circle cx="${cx - 1.4 + look[0]}" cy="${cy + 3 + look[1]}" r="1" fill="#fff"/>`;
const closedHappy = (cx: number, cy: number) => `<path d="M${cx - 6} ${cy + 2}q6 -8 12 0" stroke="${INK}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
const brow = (d: string) => `<path d="${d}" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;

const FACES: Record<Exclude<Mood, "talk" | "wow">, { eyes: string; brows: string; mouth: string; extra?: string; tilt?: number }> = {
  happy: { eyes: eye(40, 49) + eye(68, 49), brows: "", mouth: `<path d="M47 62q7 7 14 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>` },
  curious: {
    eyes: eye(40, 50, 5.2, 6.2, [2, -1]) + eye(68, 48, 6.4, 7.4, [2, -1]),
    brows: brow("M33 39q7 -2 13 1") + brow("M61 34q7 -5 14 0"),
    mouth: `<ellipse cx="57" cy="65" rx="3.4" ry="3" fill="#7a2e3b"/>`,
    extra: `<text x="88" y="42" font-family="system-ui,sans-serif" font-weight="800" font-size="16" fill="#ff8a3d" stroke="${INK}" stroke-width=".8">?</text>`,
    tilt: -6,
  },
  surprised: {
    eyes: eye(40, 48, 6.8, 7.8) + eye(68, 48, 6.8, 7.8),
    brows: brow("M32 35q8 -6 15 0") + brow("M61 35q8 -6 15 0"),
    mouth: `<ellipse cx="54" cy="67" rx="5.4" ry="6.4" fill="#7a2e3b"/>`,
    extra: `<path d="M14 26l-6-6M18 18l-3-8M96 50l8-2" stroke="#ff8a3d" stroke-width="2.6" stroke-linecap="round"/>`,
  },
  thoughtful: {
    eyes: eye(40, 49, 5.4, 6.4, [-2, -3]) + eye(68, 49, 5.4, 6.4, [-2, -3]),
    brows: brow("M33 39q7 -1 13 2") + brow("M61 39q7 -3 13 0"),
    mouth: `<path d="M50 65q5 1 10 -2" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    extra: `<circle cx="90" cy="40" r="3" fill="#7fd6ff" stroke="${INK}" stroke-width="1.4"/><circle cx="98" cy="30" r="4.2" fill="#7fd6ff" stroke="${INK}" stroke-width="1.4"/>`,
    tilt: 4,
  },
  concerned: {
    eyes: eye(40, 51, 5, 6) + eye(68, 51, 5, 6),
    brows: brow("M33 42q6 -5 13 -6") + brow("M62 36q7 1 13 6"),
    mouth: `<path d="M47 68q7 -6 14 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
    extra: `<path d="M84 34q4 6 0 9q-4 -3 0 -9z" fill="#7fd6ff" stroke="${INK}" stroke-width="1.4"/>`,
  },
  encouraging: {
    eyes: closedHappy(40, 49) + eye(68, 49),
    brows: brow("M61 38q7 -4 14 0"),
    mouth: `<path d="M45 61q9 11 18 0z" fill="#7a2e3b"/><path d="M49 64q5 3 10 0" fill="#ff9aa8"/>`,
    extra: `<path d="M94 58l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1z" fill="#ffd23f" stroke="${INK}" stroke-width="1.2"/>`,
  },
  proud: {
    eyes: closedHappy(40, 48) + closedHappy(68, 48),
    brows: "",
    mouth: `<path d="M43 60q11 15 22 0z" fill="#7a2e3b"/><path d="M48 64q6 4 12 0" fill="#ff9aa8"/>`,
    extra: `<path d="M8 40l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1zM96 66l2 4 4 1-3 2 1 4-4-2-3 2 1-4-3-2 4-1z" fill="#ffd23f" stroke="${INK}" stroke-width="1.2"/>`,
  },
  sleepy: {
    eyes: `<path d="M34 50q6 5 12 0M62 50q6 5 12 0" stroke="${INK}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`,
    brows: "",
    mouth: `<ellipse cx="54" cy="65" rx="3" ry="2.4" fill="#7a2e3b"/>`,
  },
};

/** Draw Luna. `talking` swaps in an animated mouth but keeps the expression's eyes and brows. */
export function lunaSvg(mood: Mood = "happy", size = 96, talking = false): string {
  const m = mood === "wow" ? "surprised" : mood === "talk" ? "happy" : mood;
  const talk = talking || mood === "talk";
  const f = FACES[m];
  const id = `ln${++uid}`;
  const mouth = talk ? `<g class="luna-mouth"><path d="M47 62q7 9 14 0z" fill="#7a2e3b"/><path d="M50 66q4 2.5 8 0" fill="#ff9aa8"/></g>` : f.mouth;
  return `<svg class="luna-svg luna-${m}${talk ? " is-talking" : ""}" viewBox="-6 -6 120 120" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <radialGradient id="${id}" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".7" stop-color="#fbe9a8"/><stop offset="1" stop-color="#efd27a"/></radialGradient>
    </defs>
    <g class="luna-body" transform="rotate(${f.tilt ?? 0} 54 54)">
      <circle cx="54" cy="54" r="44" fill="url(#${id})" stroke="${INK}" stroke-width="3.5"/>
      <circle cx="28" cy="34" r="6" fill="#efd78f"/><circle cx="80" cy="28" r="4" fill="#efd78f"/><circle cx="82" cy="76" r="7" fill="#efd78f"/><circle cx="26" cy="76" r="3.5" fill="#efd78f"/>
      <ellipse cx="30" cy="61" rx="7" ry="4.5" fill="#ffb3c1" opacity=".85"/><ellipse cx="78" cy="61" rx="7" ry="4.5" fill="#ffb3c1" opacity=".85"/>
      <g class="luna-eyes">${f.eyes}</g>${f.brows}${mouth}
      <path class="luna-star" d="M84 8l3 6 6.5 1-4.7 4.4 1.1 6.4L84 22.8l-5.9 3 1.1-6.4L74.5 15l6.5-1z" fill="#ffd23f" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    </g>
    ${f.extra ?? ""}
  </svg>`;
}

/** Which feeling fits which moment (used everywhere, so Luna reacts consistently). */
export const MOOD_FOR = {
  welcome: "happy",
  newWorld: "curious",
  newPlace: "curious",
  listening: "happy",
  discovery: "surprised",
  explain: "thoughtful",
  problem: "concerned",
  tryAgain: "encouraging",
  success: "proud",
  thinking: "thoughtful",
} as const satisfies Record<string, Mood>;

// ---------------------------------------------------------------------------
// Voice: Kokoro-82M (af_heart) generated on the EARTHSONA backend; browser speech only as a fallback.
// ---------------------------------------------------------------------------
export type VoiceState = "idle" | "loading" | "speaking" | "paused";
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
const PREFERRED = [
  /(ava|emma|jenny|aria|sonia|libby|maisie|michelle|natasha|clara).*(natural|online)/i,
  /(natural|online).*(english)/i,
  /google uk english female/i,
  /google us english/i,
  /(samantha|karen|moira|tessa|serena|fiona|victoria)/i,
];

/** Sentence-sized pieces (≤ ~220 characters) so speech starts quickly. */
export function splitForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*["”’)]?\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > 220) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out.length ? out.map((c) => c.slice(0, 1500)) : [text.slice(0, 1500)];
}

export class LunaVoice {
  state: VoiceState = "idle";
  enabled = true;
  /** Becomes true after the first tap: browsers only allow audio after the user interacts. */
  unlocked = false;
  text = "";
  chosen = "";
  /** "kokoro" when the backend can synthesise speech, otherwise "browser". */
  engine: "kokoro" | "browser" = "browser";
  private queue: string[] = [];
  private timer: number | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private audio = new Audio();
  private abort: AbortController | null = null;
  private cache = new Map<string, string>();
  private token = 0;
  readonly supported = typeof window !== "undefined" && "speechSynthesis" in window;
  onState: (s: VoiceState) => void = () => {};
  onDuck: (d: boolean) => void = () => {};
  onVoices: () => void = () => {};
  onError: (msg: string) => void = () => {};

  constructor() {
    this.audio.preload = "auto";
    if (!this.supported) return;
    const pick = () => {
      const all = this.voices();
      this.voice = all.find((v) => v.name === this.chosen) ?? PREFERRED.map((re) => all.find((v) => re.test(v.name))).find(Boolean) ?? all[0] ?? null;
      this.onVoices();
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  voices(): SpeechSynthesisVoice[] {
    return this.supported ? speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en")) : [];
  }
  get voiceName(): string {
    return this.engine === "kokoro" ? "Kokoro af_heart" : this.voice?.name ?? "";
  }
  choose(name: string): void {
    this.chosen = name;
    this.voice = this.voices().find((v) => v.name === name) ?? this.voice;
  }

  /** Say a line (if enabled and allowed). The words are always on screen anyway. Never overlaps. */
  say(text: string, force = false): void {
    this.stop();
    this.text = text;
    if (!(this.enabled || force) || !this.unlocked) return;
    const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "").trim();
    if (!clean) return;
    if (this.engine === "kokoro") void this.kokoro(clean);
    else this.browser(clean);
  }

  /** Kokoro: synthesise sentence-sized chunks; play chunk n while chunk n+1 is generated. */
  private async kokoro(text: string) {
    const token = ++this.token;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.onDuck(true);
    const chunks = splitForSpeech(text);
    const fetchChunk = (c: string): Promise<string> => {
      const hit = this.cache.get(c);
      if (hit) return Promise.resolve(hit);
      return fetch(`${API_BASE}/api/luna/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: c }), signal })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`TTS ${r.status}`))))
        .then((b) => {
          const url = URL.createObjectURL(b);
          this.cache.set(c, url);
          if (this.cache.size > 40) {
            const [k, u] = this.cache.entries().next().value as [string, string];
            URL.revokeObjectURL(u);
            this.cache.delete(k);
          }
          return url;
        });
    };
    if (!this.cache.has(chunks[0])) this.set("loading");
    // A stop() aborts pending requests; mark each promise as handled so that is not an "unhandled rejection".
    const prefetch = (c: string) => {
      const p = fetchChunk(c);
      p.catch(() => {});
      return p;
    };
    let next = prefetch(chunks[0]);
    for (let i = 0; i < chunks.length; i++) {
      let url: string;
      try {
        url = await next;
      } catch {
        if (token !== this.token) return; // stopped or replaced
        this.onError("Luna's server voice is unavailable right now, so she's using this device's voice.");
        this.browser(chunks.slice(i).join(" "));
        return;
      }
      if (token !== this.token) return;
      if (i + 1 < chunks.length) next = prefetch(chunks[i + 1]); // prefetch while this one plays
      this.audio.src = url;
      try {
        await this.audio.play();
      } catch {
        return this.finish();
      }
      this.set("speaking");
      await new Promise<void>((res) => {
        const done = () => (this.audio.removeEventListener("ended", done), res());
        this.audio.addEventListener("ended", done);
        const check = window.setInterval(() => token !== this.token && (clearInterval(check), done()), 200);
        this.audio.addEventListener("ended", () => clearInterval(check), { once: true });
      });
      if (token !== this.token) return;
    }
    this.finish();
  }

  private browser(text: string) {
    if (!this.supported) return;
    this.queue = text.match(/[^.!?…]+[.!?…]*["”’)]?\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    this.onDuck(true);
    this.set("speaking");
    this.next();
  }

  private next() {
    const line = this.queue.shift();
    if (!line) return this.finish();
    const u = new SpeechSynthesisUtterance(line);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "en-GB";
    u.rate = 0.95;
    u.pitch = 1.04;
    u.onend = () => {
      if (this.state === "idle") return;
      this.timer = window.setTimeout(() => this.next(), 220);
    };
    u.onerror = () => this.finish();
    speechSynthesis.speak(u);
  }

  private finish() {
    if (this.state === "idle") return;
    this.set("idle");
    this.onDuck(false);
  }

  replay(): void {
    if (this.text) this.say(this.text, true);
  }

  togglePause(): void {
    if (this.engine === "kokoro" && this.audio.src && (this.state === "speaking" || this.state === "paused")) {
      if (this.state === "speaking") {
        this.audio.pause();
        this.set("paused");
      } else {
        void this.audio.play();
        this.set("speaking");
      }
      return;
    }
    if (!this.supported) return;
    if (this.state === "speaking") {
      speechSynthesis.pause();
      this.set("paused");
    } else if (this.state === "paused") {
      speechSynthesis.resume();
      this.set("speaking");
    }
  }

  stop(): void {
    this.token++;
    this.abort?.abort();
    this.abort = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.audio.pause();
    if (this.state !== "idle") {
      this.state = "idle";
      if (this.supported) speechSynthesis.cancel();
      this.onState("idle");
      this.onDuck(false);
    }
  }

  private set(s: VoiceState) {
    this.state = s;
    this.onState(s);
  }
}

// ---------------------------------------------------------------------------
// Speech bubble
// ---------------------------------------------------------------------------
export interface BubbleAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}
export interface SayOpts {
  mood?: Mood;
  actions?: BubbleAction[];
  /** Extra HTML shown under the words (not read aloud). */
  extra?: string;
  /** Speak even if this exact line was just said. */
  repeat?: boolean;
}

export class Luna {
  private last = "";
  constructor(readonly voice: LunaVoice) {
    this.draw();
    $("voice-toggle").onclick = () => this.setVoiceEnabled(!this.voice.enabled, true);
    $("voice-pause").onclick = () => this.voice.togglePause();
    $("voice-replay").onclick = () => this.voice.replay();
    $("voice-stop").onclick = () => this.voice.stop();
    voice.onState = (s) => {
      $("bubble").classList.toggle("talking", s === "speaking");
      $("bubble").classList.toggle("loading", s === "loading");
      this.draw();
      $("voice-pause-icon").setAttribute("href", s === "paused" ? "#i-play" : "#i-pause");
      $("voice-pause").title = s === "paused" ? "Resume Luna" : "Pause Luna";
      ($("voice-pause") as HTMLButtonElement).disabled = s === "idle" || s === "loading";
      ($("voice-stop") as HTMLButtonElement).disabled = s === "idle";
      if (!this.isThinking) this.status(s === "loading" ? "Preparing Luna's voice…" : s === "paused" ? "Paused" : "");
    };
    voice.onError = (msg) => this.status(msg, true);
    ($("voice-pause") as HTMLButtonElement).disabled = true;
    ($("voice-stop") as HTMLButtonElement).disabled = true;
    this.renderVoiceToggle();
  }

  onVoiceSetting: (on: boolean) => void = () => {};
  private isThinking = false;
  /** How Luna feels right now (see MOOD_FOR). */
  mood: Mood = "happy";
  onMood: (m: Mood) => void = () => {};

  setMood(m: Mood): void {
    if (m === "wow") m = "surprised";
    if (m === this.mood) return;
    this.mood = m;
    const dock = $("luna");
    dock.classList.remove("mood-pop");
    void dock.offsetWidth;
    dock.classList.add("mood-pop");
    dock.dataset.mood = m;
    this.draw();
    this.onMood(m);
  }

  private draw(): void {
    const talking = this.voice.state === "speaking";
    $("luna").innerHTML = lunaSvg(this.isThinking ? "thoughtful" : this.mood, 112, talking && !this.isThinking);
  }

  /** Small status line under Luna's words (thinking, voice loading, errors). */
  status(text: string, error = false): void {
    const el = $("luna-status");
    el.textContent = text;
    el.classList.toggle("error", error);
  }

  /** Thinking indicator while Gemini prepares an answer. */
  thinking(on: boolean): void {
    this.isThinking = on;
    $("bubble").classList.toggle("thinking", on);
    this.draw();
    this.status(on ? "Luna is thinking…" : "");
    ($("luna-send") as HTMLButtonElement).disabled = on;
  }

  setVoiceEnabled(on: boolean, fromButton = false): void {
    this.voice.enabled = on;
    if (!on) this.voice.stop();
    else if (fromButton) this.voice.replay();
    this.renderVoiceToggle();
    this.onVoiceSetting(on);
  }

  private renderVoiceToggle() {
    const on = this.voice.enabled;
    $("voice-icon").setAttribute("href", on ? "#i-sound" : "#i-mute");
    $("voice-label").textContent = on ? "Turn Luna's voice off" : "Turn Luna's voice on";
    $("voice-toggle").title = on ? "Luna talks out loud (press to make her quiet)" : "Luna is quiet (press to hear her)";
    $("voice-toggle").setAttribute("aria-pressed", String(on));
  }

  /** Show a line in the bubble and (if allowed) say it. */
  say(text: string, o: SayOpts = {}): void {
    if (o.mood) this.setMood(o.mood);
    const bubble = $("bubble");
    bubble.hidden = false;
    $("bubble-text").textContent = text;
    $("bubble-extra").innerHTML = o.extra ?? "";
    const acts = $("bubble-actions");
    acts.innerHTML = "";
    for (const a of o.actions ?? []) {
      const b = document.createElement("button");
      b.className = `pill${a.primary ? " primary" : ""}`;
      b.textContent = a.label;
      b.onclick = a.onClick;
      acts.appendChild(b);
    }
    bubble.classList.remove("pop");
    void bubble.offsetWidth;
    bubble.classList.add("pop");
    if (text !== this.last || o.repeat) this.voice.say(text);
    this.last = text;
  }

  /** Words-only update (e.g. while a slider moves) — not spoken. */
  caption(text: string): void {
    $("bubble-text").textContent = text;
  }

  get text(): string {
    return $("bubble-text").textContent ?? "";
  }

  extraHtml(html: string): void {
    $("bubble-extra").innerHTML = html;
  }
}

/** Short HTML list for bubble extras. */
export function bubbleList(items: string[]): string {
  return `<ul class="bubble-list">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
