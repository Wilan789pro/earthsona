import { esc } from "./dom";

/**
 * The interactive history graph (bottom "journey", step 2). x = date, y = the REAL measured value.
 * Only real observations are drawn: dates without a measurement (clouds, snow) are shown as grey clouds on
 * the axis, never filled in. Hover/arrow keys show a point; click/Enter selects it (A); in compare mode a
 * second selection (B) shades the period between them and shows the change.
 */
export interface GraphPoint {
  time: string;
  value: number | null;
  quality?: string;
}

export interface GraphSource {
  id: string;
  /** Short label for the source switch, e.g. "NASA MODIS · 2020–2024". */
  label: string;
  /** Where it comes from, shown under the graph. */
  note: string;
  variable: string;
  /** Kid name, e.g. "Greenness". */
  name: string;
  unit: string;
  points: GraphPoint[];
  /** Number formatting digits. */
  digits: number;
  theme: "forest" | "ocean" | "pulse";
}

export type Trend = { dir: "up" | "down" | "flat"; change: number; perYear: number };

/** Least-squares trend over the valid points (per year), and whether it is big enough to talk about. */
export function trendOf(points: GraphPoint[], flatBelow: number): Trend | null {
  const v = points.filter((p) => p.value !== null) as { time: string; value: number }[];
  if (v.length < 2) return null;
  const xs = v.map((p) => Date.parse(p.time) / (365.25 * 86_400_000));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = v.reduce((a, p) => a + p.value, 0) / v.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => ((num += (x - mx) * (v[i].value - my)), (den += (x - mx) ** 2)));
  const perYear = den ? num / den : 0;
  const change = perYear * (xs[xs.length - 1] - xs[0]);
  return { dir: Math.abs(change) < flatBelow ? "flat" : change > 0 ? "up" : "down", change, perYear };
}

const W = 640;
const H = 210;
const PAD = { l: 44, r: 14, t: 14, b: 34 };

export class HistoryGraph {
  private src: GraphSource | null = null;
  private hover = -1;
  private sel: number[] = [];
  private playhead: string | null = null;
  compare = false;
  onSelect: (indices: number[], src: GraphSource) => void = () => {};

  constructor(private host: HTMLElement) {
    host.addEventListener("keydown", (e) => this.key(e));
    host.addEventListener("mouseleave", () => this.setHover(-1));
  }

  get source(): GraphSource | null {
    return this.src;
  }
  get selection(): number[] {
    return this.sel;
  }

  setSource(src: GraphSource | null): void {
    this.src = src;
    this.sel = [];
    this.hover = -1;
    this.render();
  }

  setCompare(on: boolean): void {
    this.compare = on;
    if (!on && this.sel.length > 1) this.sel = this.sel.slice(-1);
    this.render();
  }

  clearSelection(): void {
    this.sel = [];
    this.render();
  }

  /** Select a point (A). In compare mode the next selection becomes B (A stays). */
  select(i: number, notify = true): void {
    const p = this.src?.points[i];
    if (!p || p.value === null) return;
    if (this.compare && this.sel.length === 1 && this.sel[0] !== i) this.sel = [this.sel[0], i].sort((a, b) => a - b);
    else this.sel = [i];
    this.render();
    if (notify) this.onSelect(this.sel, this.src!);
  }

  setPlayhead(time: string | null): void {
    if (time === this.playhead) return;
    this.playhead = time;
    const g = this.host.querySelector<SVGLineElement>(".hg-playhead");
    if (!g || !this.src) return;
    if (time === null) {
      g.style.display = "none";
      return;
    }
    const x = this.x(Date.parse(time));
    g.setAttribute("x1", String(x));
    g.setAttribute("x2", String(x));
    g.style.display = "";
  }

  private range(): { t0: number; t1: number; v0: number; v1: number } {
    const pts = this.src!.points;
    const vals = pts.filter((p) => p.value !== null).map((p) => p.value as number);
    const t0 = Date.parse(pts[0].time);
    const t1 = Math.max(t0 + 86_400_000, Date.parse(pts[pts.length - 1].time));
    let v0 = Math.min(...vals);
    let v1 = Math.max(...vals);
    const pad = Math.max((v1 - v0) * 0.15, Math.abs(v1) * 0.02, 0.01);
    v0 -= pad;
    v1 += pad;
    return { t0, t1, v0, v1 };
  }
  private x(t: number): number {
    const r = this.range();
    if (this.src!.points.length === 1) return (PAD.l + W - PAD.r) / 2;
    return PAD.l + ((t - r.t0) / (r.t1 - r.t0)) * (W - PAD.l - PAD.r);
  }
  private y(v: number): number {
    const r = this.range();
    return PAD.t + (1 - (v - r.v0) / (r.v1 - r.v0)) * (H - PAD.t - PAD.b);
  }

  private fmt(v: number): string {
    return v.toFixed(this.src!.digits);
  }

  private render(): void {
    const s = this.src;
    if (!s || !s.points.some((p) => p.value !== null)) {
      this.host.innerHTML = `<p class="hg-empty">No real measurements to draw here. Nothing is made up.</p>`;
      return;
    }
    const r = this.range();
    const pts = s.points;
    // line segments through valid points (a gap of missing dates breaks the line)
    let d = "";
    let pen = false;
    pts.forEach((p) => {
      if (p.value === null) return void (pen = false);
      d += `${pen ? "L" : "M"}${this.x(Date.parse(p.time)).toFixed(1)},${this.y(p.value).toFixed(1)}`;
      pen = true;
    });
    const valid = pts.map((p, i) => ({ p, i })).filter((o) => o.p.value !== null);
    const area = valid.length > 1 ? `M${this.x(Date.parse(valid[0].p.time))},${H - PAD.b}` + valid.map((o) => `L${this.x(Date.parse(o.p.time)).toFixed(1)},${this.y(o.p.value!).toFixed(1)}`).join("") + `L${this.x(Date.parse(valid[valid.length - 1].p.time))},${H - PAD.b}Z` : "";
    // y ticks
    const ticks = [0, 0.5, 1].map((k) => r.v0 + (r.v1 - r.v0) * (0.1 + k * 0.8));
    const yt = ticks.map((v) => `<g class="hg-tick"><line x1="${PAD.l}" x2="${W - PAD.r}" y1="${this.y(v)}" y2="${this.y(v)}"/><text x="${PAD.l - 6}" y="${this.y(v) + 4}" text-anchor="end">${this.fmt(v)}</text></g>`).join("");
    // x ticks: years (or the dates themselves when there are only a few)
    const xs: string[] = [];
    const y0 = new Date(r.t0).getUTCFullYear();
    const y1 = new Date(r.t1).getUTCFullYear();
    if (pts.length <= 6) pts.forEach((p) => xs.push(`<text x="${this.x(Date.parse(p.time))}" y="${H - 12}" text-anchor="middle">${esc(shortDate(p.time))}</text>`));
    else
      for (let y = y0; y <= y1; y++) {
        const t = Date.UTC(y, 0, 1);
        if (t < r.t0 - 20 * 86_400_000 || t > r.t1) continue;
        xs.push(`<text x="${this.x(Math.max(t, r.t0))}" y="${H - 12}" text-anchor="${t < r.t0 + 30 * 86_400_000 ? "start" : "middle"}">${y}</text>`);
      }
    const sel = this.sel;
    const shade = sel.length === 2 ? `<rect class="hg-span" x="${this.x(Date.parse(pts[sel[0]].time))}" y="${PAD.t}" width="${Math.max(2, this.x(Date.parse(pts[sel[1]].time)) - this.x(Date.parse(pts[sel[0]].time)))}" height="${H - PAD.t - PAD.b}" rx="8"/>` : "";
    const many = pts.length > 40;
    const dots = pts
      .map((p, i) => {
        const cx = this.x(Date.parse(p.time));
        if (p.value === null) return `<text class="hg-cloud" x="${cx}" y="${H - PAD.b - 3}" text-anchor="middle" aria-hidden="true">☁</text>`;
        const k = sel.indexOf(i);
        const cls = `hg-dot${k >= 0 ? " sel" : ""}${p.quality && p.quality !== "good" ? " lowq" : ""}`;
        const rr = k >= 0 ? 8 : many ? 3.6 : 6.5;
        return `<circle class="${cls}" data-i="${i}" cx="${cx.toFixed(1)}" cy="${this.y(p.value).toFixed(1)}" r="${rr}"/>${k >= 0 ? `<text class="hg-letter" x="${cx}" y="${this.y(p.value) - 13}" text-anchor="middle">${"AB"[k]}</text>` : ""}`;
      })
      .join("");
    // invisible wide hit areas so small dots are easy to touch
    // each date owns the strip half-way to its neighbours (max 24 px wide), so hit areas never overlap
    const hits = valid
      .map((o, k) => {
        const cx = this.x(Date.parse(o.p.time));
        const left = k > 0 ? Math.max(cx - 12, (cx + this.x(Date.parse(valid[k - 1].p.time))) / 2) : cx - 12;
        const right = k < valid.length - 1 ? Math.min(cx + 12, (cx + this.x(Date.parse(valid[k + 1].p.time))) / 2) : cx + 12;
        return `<rect class="hg-hit" data-i="${o.i}" x="${left.toFixed(1)}" y="${PAD.t}" width="${Math.max(1, right - left).toFixed(1)}" height="${H - PAD.t - PAD.b}"/>`;
      })
      .join("");
    this.host.innerHTML = `
      <svg class="hg-svg hg-${s.theme}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${s.name} over time, ${valid.length} real measurements. Use the arrow keys to move between dates and Enter to listen.`)}">
        <defs><linearGradient id="hg-fill-${s.theme}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hg-stop1"/><stop offset="1" class="hg-stop2"/></linearGradient></defs>
        ${yt}
        ${shade}
        ${area ? `<path class="hg-area" d="${area}" fill="url(#hg-fill-${s.theme})"/>` : ""}
        <path class="hg-line" d="${d}"/>
        <line class="hg-playhead" x1="0" x2="0" y1="${PAD.t}" y2="${H - PAD.b}" style="display:none"/>
        ${dots}
        ${hits}
        <g class="hg-x">${xs.join("")}</g>
        <text class="hg-unit" x="${PAD.l}" y="${PAD.t - 3}">${esc(s.unit)}</text>
      </svg>
      <div class="hg-tip" hidden></div>`;
    const svg = this.host.querySelector("svg")!;
    svg.querySelectorAll<SVGElement>("[data-i]").forEach((el) => {
      const i = +el.dataset.i!;
      el.addEventListener("mouseenter", () => this.setHover(i));
      el.addEventListener("click", () => this.select(i));
    });
    if (this.playhead) {
      const t = this.playhead;
      this.playhead = null;
      this.setPlayhead(t);
    }
    if (this.hover >= 0) this.setHover(this.hover);
  }

  private setHover(i: number): void {
    this.hover = i;
    const tip = this.host.querySelector<HTMLElement>(".hg-tip");
    this.host.querySelectorAll(".hg-dot.hov").forEach((e) => e.classList.remove("hov"));
    if (!tip || !this.src) return;
    const p = this.src.points[i];
    if (i < 0 || !p || p.value === null) {
      tip.hidden = true;
      return;
    }
    this.host.querySelector(`.hg-dot[data-i="${i}"]`)?.classList.add("hov");
    let prev: GraphPoint | null = null;
    for (let k = i - 1; k >= 0; k--)
      if (this.src.points[k].value !== null) {
        prev = this.src.points[k];
        break;
      }
    const diff = prev ? p.value - (prev.value as number) : null;
    const arrow = diff === null ? "" : Math.abs(diff) < 10 ** -this.src.digits ? " ➡" : diff > 0 ? " ⬆" : " ⬇";
    tip.innerHTML = `<strong>${esc(longDate(p.time))}</strong><span>${esc(this.src.name)}: <b>${this.fmt(p.value)}</b>${esc(arrow)}</span>${p.quality && p.quality !== "good" ? `<span class="small">quality: ${esc(p.quality)}</span>` : ""}`;
    const svg = this.host.querySelector("svg")!;
    const box = svg.getBoundingClientRect();
    const hostBox = this.host.getBoundingClientRect();
    const px = (this.x(Date.parse(p.time)) / W) * box.width + box.left - hostBox.left;
    const py = (this.y(p.value) / H) * box.height + box.top - hostBox.top;
    tip.hidden = false;
    tip.style.left = `${Math.min(hostBox.width - 150, Math.max(0, px - 70))}px`;
    tip.style.top = `${Math.max(0, py - 64)}px`;
  }

  private key(e: KeyboardEvent): void {
    if (!this.src) return;
    const valid = this.src.points.map((p, i) => (p.value === null ? -1 : i)).filter((i) => i >= 0);
    if (!valid.length) return;
    const cur = this.hover >= 0 ? this.hover : this.sel[this.sel.length - 1] ?? -1;
    let k = valid.indexOf(cur);
    if (e.key === "ArrowRight") k = Math.min(valid.length - 1, k + 1);
    else if (e.key === "ArrowLeft") k = k < 0 ? 0 : Math.max(0, k - 1);
    else if (e.key === "Home") k = 0;
    else if (e.key === "End") k = valid.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      if (cur >= 0) this.select(cur);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    this.setHover(valid[Math.max(0, k)]);
  }
}

export const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
