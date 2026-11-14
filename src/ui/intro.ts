import { $, announce } from "./dom";

/**
 * The introduction film (public/media/intro.mp4, ~52 s): the Commander reports strange sounds from Earth, the
 * young astronaut — the explorer, i.e. the child — wonders whether Earth is talking, and lifts her tablet.
 * The film's last seconds are a placeholder card ("App screenshot goes here"): instead of showing it, the
 * live EARTHSONA interface grows out of the tablet's screen.
 */
const REVEAL_AT = 49.3; // seconds: the camera has zoomed into the tablet; the placeholder starts at ~49.7 s
// The tablet screen in the video frame at REVEAL_AT (fractions of width / height).
const TABLET = { left: 0.26, top: 0.43, right: 0.79, bottom: 0.92 };

export function runIntro(onDone: () => void, onReveal?: () => void): void {
  const box = $("intro");
  const video = $<HTMLVideoElement>("intro-video");
  const start = $("intro-start");
  const skip = $("intro-skip");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let finished = false;

  const finish = (animated: boolean) => {
    if (finished) return;
    finished = true;
    onReveal?.();
    const app = document.querySelector<HTMLElement>(".app")!;
    if (animated && !reduce) {
      // The app appears inside the tablet's screen and grows to fill the window.
      const r = box.getBoundingClientRect();
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const scale = Math.min(r.width / vw, r.height / vh);
      const ox = (r.width - vw * scale) / 2;
      const oy = (r.height - vh * scale) / 2;
      const inset = {
        top: oy + TABLET.top * vh * scale,
        left: ox + TABLET.left * vw * scale,
        right: r.width - (ox + TABLET.right * vw * scale),
        bottom: r.height - (oy + TABLET.bottom * vh * scale),
      };
      app.style.setProperty("--from-tablet", `inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px round 18px)`);
      app.classList.add("from-tablet");
      box.classList.add("reveal");
      window.setTimeout(() => {
        box.hidden = true;
        box.classList.remove("reveal");
        app.classList.remove("from-tablet");
        video.pause();
        onDone();
      }, 1300);
    } else {
      box.hidden = true;
      video.pause();
      onDone();
    }
  };

  box.hidden = false;
  start.hidden = false;
  skip.hidden = true;
  video.currentTime = 0;
  video.onerror = () => finish(false); // no film available: go straight to the app
  video.ontimeupdate = () => {
    if (video.currentTime >= REVEAL_AT) finish(true);
  };
  video.onended = () => finish(true);
  $("intro-play").onclick = async () => {
    start.hidden = true;
    skip.hidden = false;
    video.muted = false;
    try {
      await video.play();
    } catch {
      video.muted = true; // some browsers still block sound: play muted (the film has its own subtitles)
      await video.play().catch(() => finish(false));
    }
    skip.focus();
    announce("The story is playing. Press Skip to go straight to EARTHSONA.");
  };
  $("intro-skip-now").onclick = () => finish(false);
  skip.onclick = () => finish(true);
  box.onkeydown = (e) => {
    if (e.key === "Escape") finish(false);
  };
  ($("intro-play") as HTMLElement).focus();
}
