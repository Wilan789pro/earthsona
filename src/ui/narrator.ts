import type { ExperienceId } from "../data/types";

/**
 * Short, optional spoken tips (about 5–12 s each), one idea at a time, always with subtitles.
 *  - Never autoplays: a tip only starts when the user presses "Hear a tip".
 *  - While a tip speaks, the soundscape is turned down (the user asked for the tip) and restored afterwards.
 *  - Play / pause / stop / replay / next; Stop always works (and Esc stops it too).
 * Uses the browser's built-in speech voices (no audio files, no external service). If speech is not
 * available the subtitle still shows for a few seconds.
 */
export const TIPS: Record<ExperienceId, string[]> = {
  ocean: [
    "Satellites measure how warm the top of the sea is. Warmer water makes higher notes.",
    "When the sea is warmer than usual for that time of year, the music sounds more tense. Near normal, it sounds calm.",
    "The waves are a nature soundscape. The melody on top is made from real temperature measurements.",
  ],
  forest: [
    "Plants reflect infrared light. Satellites use it to measure how green a forest is.",
    "Greener forest makes higher notes and a fuller sound. If clouds hid the forest, you hear a soft tick instead.",
    "Greenness is not the same as counting trees. It shows how leafy the plants look from space.",
  ],
  pulse: [
    "Warmer air makes higher notes. More rain makes a busier rhythm.",
    "More sunshine makes the sound brighter. Listen to the seasons come and go.",
    "These numbers come from a NASA computer model that uses many measurements. They are estimates, not thermometer readings.",
  ],
};

type NarratorState = "idle" | "speaking" | "paused";

export class Narrator {
  state: NarratorState = "idle";
  private index = -1;
  private exp: ExperienceId = "ocean";
  private fallbackTimer: number | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  readonly supported = typeof window !== "undefined" && "speechSynthesis" in window;
  onState: (s: NarratorState, text: string | null) => void = () => {};
  onDuck: (ducked: boolean) => void = () => {};

  constructor() {
    if (this.supported) {
      const pick = () => {
        const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
        // Prefer the more natural-sounding voices most systems ship.
        const pref = [/natural/i, /aria|jenny|sonia|libby|guy/i, /google uk english female|google us english/i, /samantha|karen|daniel|serena/i];
        this.voice = pref.map((re) => voices.find((v) => re.test(v.name))).find(Boolean) ?? voices[0] ?? null;
      };
      pick();
      speechSynthesis.addEventListener?.("voiceschanged", pick);
    }
  }

  setExperience(e: ExperienceId): void {
    if (e !== this.exp) {
      this.stop();
      this.exp = e;
      this.index = -1;
    }
  }

  get text(): string | null {
    return this.index >= 0 ? TIPS[this.exp][this.index] : null;
  }

  /** Play the next tip (or the first). */
  next(): void {
    this.index = (this.index + 1) % TIPS[this.exp].length;
    this.speak();
  }

  replay(): void {
    if (this.index < 0) this.index = 0;
    this.speak();
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
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    if (this.supported) speechSynthesis.cancel();
    if (this.state !== "idle") {
      this.set("idle");
      this.onDuck(false);
    }
  }

  private speak(): void {
    this.stop();
    const text = this.text!;
    this.onDuck(true);
    this.set("speaking");
    const done = () => {
      if (this.state === "idle") return;
      this.set("idle");
      this.onDuck(false);
    };
    if (!this.supported) {
      // No speech engine: show the subtitle for roughly the time it would take to say it.
      this.fallbackTimer = window.setTimeout(done, Math.max(4000, text.split(/\s+/).length * 380));
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "en-GB";
    u.rate = 0.95;
    u.pitch = 1.05;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  private set(s: NarratorState) {
    this.state = s;
    this.onState(s, s === "idle" ? this.text : this.text);
  }
}
