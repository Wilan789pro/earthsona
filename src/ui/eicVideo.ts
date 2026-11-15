import type { ExperienceId } from "../data/types";
import { EIC_VIDEOS } from "../data/eicVideos";
import { $, announce, esc } from "./dom";

/**
 * The stage's "🎬 NASA video" view: plays the current mission's NASA SVS visualisation as CONTEXT.
 * Lazy: the video is only requested when this view is opened (preload="none" + poster before that).
 * Labelled as context; never claimed to be synchronised with the sonified data.
 */
export interface EicVideoHost {
  /** Play / pause the data sound (optional "also hear the data"). */
  playData: () => void;
  pauseData: () => void;
  dataPlaying: () => boolean;
  /** Show / hide the globe (stop drawing it while the video covers it). */
  showGlobe: (on: boolean) => void;
}

export class EicVideoView {
  open = false;
  private exp: ExperienceId = "ocean";
  private withData = false;

  constructor(private host: EicVideoHost) {
    $("view-globe").onclick = () => this.close();
    $("view-video").onclick = () => this.show();
  }

  setMission(exp: ExperienceId): void {
    this.exp = exp;
    if (this.open) this.render();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.render();
    $("view-globe").setAttribute("aria-pressed", "false");
    $("view-video").setAttribute("aria-pressed", "true");
    this.host.showGlobe(false);
    announce(`NASA video: ${EIC_VIDEOS[this.exp].title}. Context only, not the data you hear.`);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    const v = document.querySelector<HTMLVideoElement>("#eic-video");
    v?.pause();
    v?.removeAttribute("src");
    v?.load(); // release the network connection
    $("eic-video-box").hidden = true;
    $("eic-video-box").innerHTML = "";
    $("view-globe").setAttribute("aria-pressed", "true");
    $("view-video").setAttribute("aria-pressed", "false");
    this.host.showGlobe(true);
  }

  private render(): void {
    const m = EIC_VIDEOS[this.exp];
    const box = $("eic-video-box");
    box.hidden = false;
    box.innerHTML = `
      <figure class="eic-video" aria-labelledby="eic-v-title">
        <span class="eic-ctx-tag">NASA context visualisation</span>
        <video id="eic-video" controls playsinline muted preload="none" poster="${esc(m.poster)}" aria-describedby="eic-v-desc">
          <source src="${esc(m.file)}" type="video/mp4" />
          Your browser can't play this video. <a href="${esc(m.svsUrl)}" target="_blank" rel="noopener">Watch it on NASA SVS</a>.
        </video>
        <figcaption>
          <strong id="eic-v-title">${esc(m.title)}</strong>
          <span class="eic-kid">${esc(m.kid)}</span>
          <span class="eic-note small">Context only: not synchronised with the sound you hear. Credit: NASA's Scientific Visualization Studio (<a href="${esc(m.svsUrl)}" target="_blank" rel="noopener">SVS ${m.svsId}</a>).</span>
          <label class="eic-with-data small"><input type="checkbox" id="eic-with-data" ${this.withData ? "checked" : ""} /> Also play this place's data sound <span class="muted">(a different dataset)</span></label>
          <details class="eic-more">
            <summary>About this video</summary>
            <p class="small" id="eic-v-desc">${esc(m.description)}</p>
            <dl class="kv small">
              <dt>Data</dt><dd>${esc(m.product)}</dd>
              <dt>Covers</dt><dd>${esc(m.coverage)}</dd>
              <dt>And the sound?</dt><dd>${esc(m.relation)}</dd>
              <dt>Credit</dt><dd>${esc(m.credit)} <a href="${esc(m.svsUrl)}" target="_blank" rel="noopener">NASA SVS ${m.svsId}</a></dd>
            </dl>
          </details>
        </figcaption>
      </figure>`;
    const video = $<HTMLVideoElement>("eic-video");
    const cb = $<HTMLInputElement>("eic-with-data");
    cb.onchange = () => {
      this.withData = cb.checked;
      if (!cb.checked && this.host.dataPlaying()) this.host.pauseData();
      if (cb.checked && !video.paused) this.host.playData();
    };
    video.onplay = () => this.withData && !this.host.dataPlaying() && this.host.playData();
    video.onpause = () => this.withData && this.host.dataPlaying() && this.host.pauseData();
  }
}
