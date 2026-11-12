import type { Track } from "../data/registry";
import type { CleanPoint } from "../data/normalise";
import type { CleanSeries, ExperienceId, RegionDef } from "../data/types";
import { dataTypeFor } from "../data/parsers.js";
import { esc } from "./dom";
import { fmtDate, fmtValue } from "./format";

/**
 * Child-friendly words, time windows and the discovery cards. Every number shown here is read from the
 * loaded data (value, unit and date); nothing is invented. Text stays short: one idea per card.
 */
export interface TimeWindow {
  key: string;
  label: string;
  from: string;
  to: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "All" plus one window per year; a single-year series gets quarter-year windows instead. */
export function timeWindows(times: string[]): TimeWindow[] {
  if (!times.length) return [];
  const years = [...new Set(times.map((t) => t.slice(0, 4)))].sort();
  const all: TimeWindow = { key: "all", label: years.length > 1 ? `All ${years[0]}–${years[years.length - 1]}` : `All of ${years[0]}`, from: times[0], to: times[times.length - 1] };
  if (years.length > 1) return [all, ...years.map((y) => ({ key: y, label: y, from: `${y}-01-01`, to: `${y}-12-31` }))];
  const y = years[0];
  const q = (i: number) => ({
    key: `${y}-q${i + 1}`,
    label: `${MONTHS[i * 3]}–${MONTHS[i * 3 + 2]}`,
    from: `${y}-${String(i * 3 + 1).padStart(2, "0")}-01`,
    to: `${y}-${String(i * 3 + 3).padStart(2, "0")}-31`,
  });
  return [all, q(0), q(1), q(2), q(3)];
}

const LABELS: Record<string, string> = {
  SST: "Sea temperature",
  SSTA: "Warmer or cooler than usual",
  NDVI: "Forest greenness",
  EVI: "Leafiness (EVI)",
  T2M: "Air temperature",
  PRECTOTCORR: "Rain",
  ALLSKY_SFC_SW_DWN: "Sunshine",
};

export const KID = {
  label: (v: string) => LABELS[v] ?? v,
  periodLabel: (key: string, fallback: string) => (key.endsWith("daily") ? "Every day of 2024" : key.includes("-") && key.length === 9 ? `Every month ${key.replace("-", "–")}` : fallback),
  harmony: (label: string) =>
    label.startsWith("calm") ? "calm harmony (normal)" : label.startsWith("gentle") ? `a bit tense (${label.includes("warmer") ? "warmer" : "cooler"} than usual)` : label.startsWith("strong") ? `very tense (${label.includes("warmer") ? "much warmer" : "much cooler"} than usual)` : label.startsWith("thin") ? "thin harmony" : label.startsWith("open") ? "open harmony" : "full chord",

  welcome() {
    return {
      kicker: "Welcome to EARTHSONA",
      title: "Listen to planet Earth!",
      fact: "Choose a world (🌊 ocean, 🌳 forest or 💓 weather), pick a place, then press <strong>▶ Play</strong>.",
      data: `<ol class="disc-steps"><li>🌿 First you hear the place: waves, wind, rain or birds.</li><li>📈 On top, a sound made from real measurements taken by NASA satellites and models.</li><li>✦ Press <strong>Try this out</strong> to compare two different years.</li></ol>`,
      sound: "Sounds are made by EARTHSONA from the numbers. They are not recordings from space.",
    };
  },

  discovery(kind: "place" | "time", exp: ExperienceId, region: RegionDef, track: Track | null, w: TimeWindow) {
    const kicker = kind === "place" ? `📍 ${region.short ?? region.name}` : `🕒 ${w.label}`;
    if (!track) {
      return {
        kicker,
        title: "No measurements here yet",
        fact: esc(region.kidIntro ?? ""),
        data: `<p class="small">There is no real data downloaded for this place, so you only hear its nature sounds. EARTHSONA never makes up numbers.</p>`,
        sound: "Try another place to hear the data sound too.",
      };
    }
    const pitch = track.layers.find((l) => l.def.roles.includes("pitch"))!.result.series;
    const pts = (pitch.points as CleanPoint[]).filter((p) => p.time >= w.from && p.time <= w.to && p.value !== null && !p.bridged);
    if (!pts.length) {
      return { kicker, title: "Clouds got in the way", fact: "", data: `<p class="small">No usable measurements in ${esc(w.label)}.</p>`, sound: "You will hear soft ticks where data is missing." };
    }
    const max = pts.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
    const min = pts.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a));
    const mean = pts.reduce((a, b) => a + (b.value as number), 0) / pts.length;
    const v = (x: number) => esc(fmtValue(x, pitch.unit));
    const d = (p: CleanPoint) => esc(fmtDate(p.time, pitch, true));
    const dt = dataTypeFor(pitch.variable, pitch.source.name);
    const spark = sparkline(pitch, w, min, max);
    const name = esc(region.kidName ?? region.short ?? region.name);

    const T = {
      ocean: {
        title: kind === "place" ? `How warm is the sea ${region.kidName ? "in" : "at"} ${name}?` : `The ocean in ${esc(w.label)}`,
        fact: "Scientists measure the temperature of the ocean from space. Listen carefully: the sound changes as the measurements change.",
        sound: "🎵 Warmer water = higher notes. 🎶 Warmer than usual = a more tense harmony.",
        hi: "Warmest", lo: "Coolest",
      },
      forest: {
        title: kind === "place" ? `How green is ${name}?` : `The forest in ${esc(w.label)}`,
        fact: "Satellites measure how green plants look by the light they reflect. Greenness is not the same as counting trees.",
        sound: "🎵 Greener = higher notes and a fuller sound. A soft tick means clouds or snow hid the forest.",
        hi: "Greenest", lo: "Least green",
      },
      pulse: {
        title: kind === "place" ? `Feel the weather pulse of ${name}!` : `The weather in ${esc(w.label)}`,
        fact: "A NASA computer model combines many measurements to estimate the air temperature, rain and sunshine.",
        sound: "🎵 Warmer = higher notes. 🥁 More rain = busier beats. ✨ More sun = brighter sound.",
        hi: "Warmest", lo: "Coldest",
      },
    }[exp];

    const extra: string[] = [];
    const rain = track.layers.find((l) => l.def.variable === "PRECTOTCORR")?.result.series;
    if (rain) {
      const rp = (rain.points as CleanPoint[]).filter((p) => p.time >= w.from && p.time <= w.to && p.value !== null);
      if (rp.length) {
        const wet = rp.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
        extra.push(`🌧️ Rainiest: <strong>${esc(fmtValue(wet.value as number, rain.unit))}</strong> (${esc(fmtDate(wet.time, rain, true))})`);
      }
    }
    const gaps = (pitch.points as CleanPoint[]).filter((p) => p.time >= w.from && p.time <= w.to && p.value === null).length;
    if (gaps) extra.push(`☁️ ${gaps} time${gaps > 1 ? "s" : ""} without a usable measurement`);

    return {
      kicker,
      title: T.title,
      fact: `${esc(region.kidIntro ?? "")} ${kind === "place" && region.fact ? `<span class="disc-fun">Did you know? ${esc(region.fact)}</span>` : ""}`,
      data:
        spark +
        `<ul class="disc-list">` +
        `<li>⬆️ ${T.hi}: <strong>${v(max.value as number)}</strong> (${d(max)})</li>` +
        `<li>⬇️ ${T.lo}: <strong>${v(min.value as number)}</strong> (${d(min)})</li>` +
        `<li>≈ Average: <strong>${v(mean)}</strong> over ${pts.length} measurements</li>` +
        extra.map((x) => `<li>${x}</li>`).join("") +
        `</ul><p class="small muted">${esc(KID.label(pitch.variable))} · ${esc(pitch.source.kind === "noaa" ? "NOAA" : "NASA")} · ${esc(dt.kid)}</p>`,
      sound: `${T.fact} ${T.sound}`,
    };
  },
};

/** Tiny line chart for the discovery card (decorative; the numbers are in the list next to it). */
function sparkline(s: CleanSeries, w: TimeWindow, min: CleanPoint, max: CleanPoint): string {
  const pts = (s.points as CleanPoint[]).filter((p) => p.time >= w.from && p.time <= w.to);
  if (pts.length < 3) return "";
  const lo = min.value as number;
  const hi = max.value as number;
  const W = 260;
  const H = 54;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  let d = "";
  let pen = false;
  pts.forEach((p, i) => {
    if (p.value === null) return void (pen = false);
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });
  const mi = pts.indexOf(max);
  const ni = pts.indexOf(min);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Small chart of ${esc(s.label)} in ${esc(w.label)}"><path d="${d}" /><circle cx="${x(mi)}" cy="${y(hi)}" r="4" class="hi"/><circle cx="${x(ni)}" cy="${y(lo)}" r="4" class="lo"/></svg>`;
}
