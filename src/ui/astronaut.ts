/**
 * The space buddy: one consistent astronaut character (inline SVG, original artwork) and its voice.
 *
 * The voice never autoplays: a line is spoken only when the child presses a "Hear it" button. Captions are
 * always shown, and pause / stop / replay always work. While the buddy speaks, the soundscape is turned
 * down (the child asked to hear it) and restored afterwards. Uses the browser's built-in speech voices.
 */

let uid = 0;

/** The astronaut. `pose` adds a gentle wave or point (CSS animation, off with reduced motion). */
export function astronautSvg(opts: { pose?: "wave" | "point" | "idle"; size?: string; label?: string } = {}): string {
  const id = `astro${++uid}`;
  const pose = opts.pose ?? "idle";
  const label = opts.label ?? "Your space buddy, a friendly astronaut";
  return `<svg class="astro astro-${pose}" viewBox="0 0 120 150" width="${opts.size ?? "120"}" role="img" aria-label="${label}">
  <defs>
    <radialGradient id="${id}v" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#a5f3fc"/><stop offset=".45" stop-color="#0e7490"/><stop offset="1" stop-color="#082f49"/></radialGradient>
    <linearGradient id="${id}s" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient>
  </defs>
  <g class="astro-body">
    <rect x="30" y="66" width="60" height="22" rx="8" fill="#94a3b8"/>
    <rect x="34" y="70" width="52" height="54" rx="20" fill="url(#${id}s)" stroke="#64748b" stroke-width="2"/>
    <rect x="48" y="86" width="24" height="16" rx="4" fill="#0f172a"/>
    <circle cx="54" cy="94" r="2.5" fill="#22d3ee"/><circle cx="60" cy="94" r="2.5" fill="#4ade80"/><circle cx="66" cy="94" r="2.5" fill="#fbbf24"/>
    <path d="M40 76 44 84" stroke="#fb923c" stroke-width="5" stroke-linecap="round"/>
    <rect x="38" y="118" width="18" height="24" rx="8" fill="url(#${id}s)" stroke="#64748b" stroke-width="2"/>
    <rect x="64" y="118" width="18" height="24" rx="8" fill="url(#${id}s)" stroke="#64748b" stroke-width="2"/>
    <rect x="36" y="136" width="22" height="10" rx="5" fill="#475569"/><rect x="62" y="136" width="22" height="10" rx="5" fill="#475569"/>
    <g class="arm-l"><rect x="20" y="78" width="16" height="34" rx="8" fill="url(#${id}s)" stroke="#64748b" stroke-width="2"/><circle cx="28" cy="114" r="7" fill="#fb923c"/></g>
    <g class="arm-r"><rect x="84" y="78" width="16" height="34" rx="8" fill="url(#${id}s)" stroke="#64748b" stroke-width="2"/><circle cx="92" cy="114" r="7" fill="#fb923c"/></g>
  </g>
  <g class="astro-head">
    <circle cx="60" cy="40" r="34" fill="url(#${id}s)" stroke="#64748b" stroke-width="2"/>
    <rect x="31" y="22" width="58" height="40" rx="20" fill="url(#${id}v)" stroke="#1e293b" stroke-width="2"/>
    <circle cx="48" cy="42" r="3.6" fill="#ecfeff"/><circle cx="72" cy="42" r="3.6" fill="#ecfeff"/>
    <path d="M51 51q9 7 18 0" fill="none" stroke="#ecfeff" stroke-width="3" stroke-linecap="round"/>
    <path d="M38 30q6-6 14-6" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>
    <rect x="56" y="2" width="8" height="8" rx="3" fill="#94a3b8"/><circle cx="60" cy="2" r="4" fill="#f472b6" class="astro-light"/>
  </g>
</svg>`;
}

/** Small spaceship used in the scenes. */
export function shipSvg(): string {
  return `<svg class="ship" viewBox="0 0 160 70" aria-hidden="true">
    <path d="M10 40 Q40 12 100 18 L140 34 Q148 38 140 42 L100 56 Q40 62 10 40Z" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>
    <path d="M96 22 L128 34 L96 34Z" fill="#38bdf8" opacity=".85"/>
    <circle cx="70" cy="38" r="6" fill="#22d3ee"/><circle cx="50" cy="38" r="6" fill="#22d3ee"/>
    <path d="M14 34 L0 28 M14 46 L0 52" stroke="#fb923c" stroke-width="4" stroke-linecap="round" class="ship-flame"/>
    <path d="M40 24 L56 6 L68 22Z" fill="#f472b6"/>
  </svg>`;
}

type VoiceState = "idle" | "speaking" | "paused";

export class BuddyVoice {
  state: VoiceState = "idle";
  text = "";
  private timer: number | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  readonly supported = typeof window !== "undefined" && "speechSynthesis" in window;
  onState: (s: VoiceState, text: string) => void = () => {};
  onDuck: (ducked: boolean) => void = () => {};

  constructor() {
    if (!this.supported) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
      const pref = [/natural/i, /aria|jenny|sonia|libby|guy/i, /google uk english female|google us english/i, /samantha|karen|daniel|serena/i];
      this.voice = pref.map((re) => voices.find((v) => re.test(v.name))).find(Boolean) ?? voices[0] ?? null;
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  /** Speak one line (only ever called from a button press). */
  say(text: string): void {
    this.stop();
    this.text = text;
    this.onDuck(true);
    this.set("speaking");
    const done = () => {
      if (this.state === "idle") return;
      this.set("idle");
      this.onDuck(false);
    };
    if (!this.supported) {
      this.timer = window.setTimeout(done, Math.max(3500, text.split(/\s+/).length * 380));
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "en-GB";
    u.rate = 0.95;
    u.pitch = 1.1;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  replay(): void {
    if (this.text) this.say(this.text);
  }

  togglePause(): void {
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
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.supported && this.state !== "idle") speechSynthesis.cancel();
    if (this.state !== "idle") {
      this.set("idle");
      this.onDuck(false);
    }
  }

  private set(s: VoiceState) {
    this.state = s;
    this.onState(s, this.text);
  }
}

/**
 * Markup for a "voice bar": a Hear-it button, pause / stop / replay, and the caption. The caption text is
 * always visible (it is the line itself), so the voice is optional.
 */
export function voiceBar(id: string, text: string): string {
  return `<div class="voice-bar" data-voice="${id}">
    <button class="btn small voice-hear" data-say>🔊 Hear it</button>
    <span class="voice-ctls" hidden>
      <button class="btn small icon-btn" data-vpause title="Pause"><span aria-hidden="true">⏸</span><span class="sr-only">Pause</span></button>
      <button class="btn small icon-btn" data-vstop title="Stop"><span aria-hidden="true">■</span><span class="sr-only">Stop</span></button>
      <button class="btn small icon-btn" data-vreplay title="Replay"><span aria-hidden="true">↻</span><span class="sr-only">Replay</span></button>
    </span>
  </div><p class="caption" data-caption="${id}">${text}</p>`;
}

/** Wire every voice bar inside `root` to the shared voice. `text` is read from the caption (plain text). */
export function wireVoiceBars(root: HTMLElement, voice: BuddyVoice): void {
  root.querySelectorAll<HTMLElement>(".voice-bar").forEach((bar) => {
    const id = bar.dataset.voice!;
    const cap = root.querySelector<HTMLElement>(`[data-caption="${id}"]`);
    const ctls = bar.querySelector<HTMLElement>(".voice-ctls")!;
    const line = () => cap?.textContent?.trim() ?? "";
    bar.querySelector<HTMLButtonElement>("[data-say]")!.onclick = () => {
      voice.say(line());
      root.querySelectorAll<HTMLElement>(".voice-ctls").forEach((c) => (c.hidden = true));
      ctls.hidden = false;
      bar.dataset.active = "1";
    };
    bar.querySelector<HTMLButtonElement>("[data-vpause]")!.onclick = () => voice.togglePause();
    bar.querySelector<HTMLButtonElement>("[data-vstop]")!.onclick = () => voice.stop();
    bar.querySelector<HTMLButtonElement>("[data-vreplay]")!.onclick = () => voice.say(line());
  });
}
