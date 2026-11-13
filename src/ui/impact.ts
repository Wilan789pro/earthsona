import type { Track } from "../data/registry";
import type { CleanPoint } from "../data/normalise";
import type { CleanSeries, ExperienceId, RegionDef } from "../data/types";
import { dataTypeFor } from "../data/parsers.js";
import { astronautSvg, voiceBar, wireVoiceBars, type BuddyVoice } from "./astronaut";
import { $, announce, esc } from "./dom";
import { fmtDate, fmtValue } from "./format";
import { KID } from "./kid";
import { CHAIN_LABEL, IMPACT, MISSIONS } from "./missions";

/**
 * Earth Impact Explorer (Scene 8): "What could this change mean for our planet?"
 * The top box is ONLY real numbers from the loaded data. Everything below is general science, labelled as
 * such, and the last link of every chain says what was not checked for this place.
 */
export interface ImpactHost {
  experience: ExperienceId;
  region: RegionDef;
  track: Track | null;
  voice: BuddyVoice;
}

const valid = (s: CleanSeries) => (s.points as CleanPoint[]).filter((p) => p.value !== null && !p.bridged);
const maxOf = (pts: CleanPoint[]) => pts.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
const minOf = (pts: CleanPoint[]) => pts.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a));

/** One short list of facts read from the data (value, unit, date). Empty when nothing is loaded. */
export function impactMeasured(exp: ExperienceId, track: Track | null): string[] {
  if (!track) return [];
  const get = (v: string) => track.layers.find((l) => l.def.variable === v)?.result.series;
  const fact = (s: CleanSeries, p: CleanPoint, what: string) => `${what}: <strong>${esc(fmtValue(p.value as number, s.unit))}</strong> (${esc(fmtDate(p.time, s, true))})`;
  const out: string[] = [];
  if (exp === "ocean") {
    const sst = get("SST");
    const an = get("SSTA");
    if (sst && valid(sst).length) out.push(fact(sst, maxOf(valid(sst)), "Warmest sea surface measured"));
    if (an && valid(an).length) {
      const pts = valid(an);
      out.push(fact(an, maxOf(pts), "Most warmer-than-usual"));
      const warm = pts.filter((p) => (p.value as number) >= 1).length;
      out.push(`Samples at least <strong>1 °C warmer than usual</strong>: <strong>${warm}</strong> of ${pts.length}`);
    }
  } else if (exp === "forest") {
    const nd = get("NDVI");
    if (nd && valid(nd).length) {
      out.push(fact(nd, maxOf(valid(nd)), "Greenest (NDVI)"));
      out.push(fact(nd, minOf(valid(nd)), "Least green (NDVI)"));
      const gaps = nd.points.length - valid(nd).length;
      if (gaps) out.push(`Times hidden by clouds or snow: <strong>${gaps}</strong>`);
    }
  } else {
    const t = get("T2M");
    const r = get("PRECTOTCORR");
    if (r && valid(r).length) {
      out.push(fact(r, maxOf(valid(r)), "Rainiest"));
      out.push(fact(r, minOf(valid(r)), "Driest"));
    }
    if (t && valid(t).length) out.push(fact(t, maxOf(valid(t)), "Warmest"));
  }
  return out;
}

export function renderImpact(host: ImpactHost): void {
  const { experience: exp, region, track } = host;
  const imp = IMPACT[exp];
  const mission = MISSIONS[exp];
  const facts = impactMeasured(exp, track);
  const pitch = track?.layers.find((l) => l.def.roles.includes("pitch"))?.result.series;
  const kind = pitch ? dataTypeFor(pitch.variable, pitch.source.name) : null;
  const org = track ? [...new Set(track.layers.map((l) => (l.result.series.source.kind === "noaa" ? "NOAA" : "NASA")))].join(" + ") : "";
  const body = $("impact-body");
  body.innerHTML = `
    <div class="impact-intro">
      <div class="mc-buddy">${astronautSvg({ pose: "point", size: "70" })}</div>
      <div>
        <p class="eyebrow">${mission.icon} ${esc(mission.title)} · ${esc(region.short ?? region.name)}</p>
        <h3 class="impact-title">${esc(imp.title)}</h3>
        ${voiceBar("impact", "Wow! We discovered something interesting. But why does it matter?")}
      </div>
    </div>

    <section class="impact-box measured" aria-labelledby="im-meas">
      <h3 id="im-meas"><span class="kind-dot measured" aria-hidden="true"></span> What the data shows here</h3>
      ${facts.length
        ? `<ul>${facts.map((f) => `<li>${f}</li>`).join("")}</ul><p class="small muted">${esc(KID.label(pitch!.variable))} · ${esc(org)} · ${esc(kind!.kid)} Every period: ${esc(track!.period.label)}.</p>`
        : `<p>No real measurements are loaded for this place, so there is nothing to show here. Nothing is made up.</p>`}
    </section>

    <section aria-labelledby="im-tap">
      <h3 id="im-tap">👆 Tap to discover</h3>
      <div class="tap-scene t-${exp}">
        ${imp.scene.map((o, i) => `<button class="tap-obj" style="left:${o.x}%;top:${o.y}%" data-tap="${i}" aria-label="${esc(o.name)}"><span aria-hidden="true">${o.emoji}</span></button>`).join("")}
      </div>
      <p class="tap-fact" id="tap-fact" aria-live="polite">Tap a picture to learn about it.</p>
    </section>

    <section aria-labelledby="im-chain">
      <h3 id="im-chain">🔗 What could happen? <button class="btn small" id="chain-play">▶ Show me step by step</button></h3>
      <ol class="chain" id="chain">
        ${imp.chain.map((c) => `<li class="chain-step k-${c.kind}"><span class="chain-icon" aria-hidden="true">${c.icon}</span><span>${esc(c.text)}<span class="kind-tag k-${c.kind}">${esc(CHAIN_LABEL[c.kind])}</span></span></li>`).join("")}
      </ol>
    </section>

    <section aria-labelledby="im-ask">
      <h3 id="im-ask">🧑‍🚀 Ask the astronaut</h3>
      <div class="chips">${imp.ask.map((a, i) => `<button class="chip" data-ask="${i}">${esc(a.q)}</button>`).join("")}</div>
      <div id="ask-answer" class="ask-answer" aria-live="polite"></div>
    </section>

    <section aria-labelledby="im-pred">
      <h3 id="im-pred">🔮 Prediction challenge</h3>
      <p>${esc(imp.predict.q)}</p>
      <div class="choices">${imp.predict.options.map((o, i) => `<button class="choice" data-pred="${i}">${esc(o.t)}</button>`).join("")}</div>
      <p class="feedback" id="pred-feedback" aria-live="polite"></p>
    </section>

    <section aria-labelledby="im-act">
      <h3 id="im-act">💚 What can we do?</h3>
      <ul class="actions">${mission.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    </section>

    <p class="small muted">Sources for the science above: ${imp.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ")}. These describe what can happen in general, not what happened at this place.</p>`;

  wireVoiceBars(body, host.voice);
  body.querySelectorAll<HTMLButtonElement>("[data-tap]").forEach((b) => (b.onclick = () => {
    const o = imp.scene[+b.dataset.tap!];
    body.querySelectorAll(".tap-obj").forEach((x) => x.classList.toggle("on", x === b));
    $("tap-fact").innerHTML = `<strong>${o.emoji} ${esc(o.name)}:</strong> ${esc(o.fact)}`;
  }));
  $("chain-play").onclick = () => {
    const chain = $("chain");
    chain.classList.remove("reveal");
    void chain.offsetWidth;
    chain.classList.add("reveal");
    announce(imp.chain.map((c) => c.text).join(" "));
  };
  body.querySelectorAll<HTMLButtonElement>("[data-ask]").forEach((b) => (b.onclick = () => {
    const a = imp.ask[+b.dataset.ask!];
    const box = $("ask-answer");
    box.innerHTML = `<div class="ask-row"><div class="mc-buddy">${astronautSvg({ size: "48" })}</div><div><p class="small muted">${esc(a.q)}</p>${voiceBar("ask", esc(a.a))}</div></div>`;
    wireVoiceBars(box, host.voice);
  }));
  body.querySelectorAll<HTMLButtonElement>("[data-pred]").forEach((b) => (b.onclick = () => {
    const o = imp.predict.options[+b.dataset.pred!];
    b.classList.add(o.ok ? "right" : "wrong");
    $("pred-feedback").textContent = `${o.ok ? "✅" : "🤔"} ${o.why}`;
  }));
}
