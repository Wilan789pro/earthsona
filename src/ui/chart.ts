import type { CleanSeries } from "../data/types";
import type { CleanPoint } from "../data/normalise";
import { fmtDate, fmtValue } from "./format";

/**
 * Single-series SVG line chart.
 *  - 2px line in the experience colour, recessive grid/axes, no legend (title names the series)
 *  - real gaps (null) break the line and are marked on the baseline; bridged points are hollow
 *  - playhead (dot + vertical rule) follows the player
 *  - hover/focus crosshair + tooltip; click / Enter seeks the player there
 *  - a table view lives in a <details> next to it (built by the caller via `renderTable`)
 */
const W = 640;
const H = 250;
const M = { t: 16, r: 16, b: 38, l: 92 };
const NS = "http://www.w3.org/2000/svg";

export class SeriesChart {
  private svg: SVGSVGElement;
  private series: CleanSeries | null = null;
  private xs: number[] = [];
  private y = (_v: number) => 0;
  private playhead: SVGGElement;
  private hover: SVGGElement;
  private tip: HTMLDivElement;
  onSeek: (i: number) => void = () => {};

  constructor(private host: HTMLElement) {
    host.classList.add("chart");
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("tabindex", "0");
    host.appendChild(this.svg);
    this.tip = document.createElement("div");
    this.tip.className = "chart-tip";
    this.tip.hidden = true;
    host.appendChild(this.tip);
    this.playhead = document.createElementNS(NS, "g");
    this.hover = document.createElementNS(NS, "g");

    this.svg.addEventListener("pointermove", (e) => this.hoverAt(this.indexFromEvent(e)));
    this.svg.addEventListener("pointerleave", () => this.hideHover());
    this.svg.addEventListener("click", (e) => this.onSeek(this.indexFromEvent(e)));
    let kbIndex = 0;
    this.svg.addEventListener("keydown", (e) => {
      if (!this.series) return;
      const n = this.series.points.length;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        kbIndex = Math.max(0, Math.min(n - 1, kbIndex + (e.key === "ArrowRight" ? 1 : -1)));
        this.hoverAt(kbIndex);
      } else if (e.key === "Enter") {
        this.onSeek(kbIndex);
      }
    });
    this.svg.addEventListener("blur", () => this.hideHover());
  }

  render(series: CleanSeries, color: string): void {
    this.series = series;
    const pts = series.points as CleanPoint[];
    const { min, max } = series.stats;
    const pad = (max - min) * 0.08 || 1;
    const y0 = min - pad;
    const y1 = max + pad;
    const t0 = Date.parse(pts[0].time);
    const t1 = Date.parse(pts[pts.length - 1].time);
    const x = (t: string) => M.l + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - M.l - M.r);
    this.y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * (H - M.t - M.b);
    this.xs = pts.map((p) => x(p.time));
    this.host.style.setProperty("--series", color);

    const parts: string[] = [];
    // Grid + y labels (3 recessive lines: min, mean, max)
    for (const [v, lab] of [[min, "min"], [series.stats.mean, "mean"], [max, "max"]] as const) {
      const yy = this.y(v).toFixed(1);
      parts.push(`<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${yy}" y2="${yy}"/>`);
      parts.push(`<text class="axis" x="${M.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtValue(v, series.unit, true)}</text>`);
      if (lab === "mean") parts.push(`<text class="axis faint" x="${W - M.r}" y="${(+yy - 6).toFixed(1)}" text-anchor="end">mean</text>`);
    }
    // x labels: first, middle, last
    const idxs = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    idxs.forEach((i, k) => {
      const anchor = k === 0 ? "start" : k === 2 ? "end" : "middle";
      parts.push(`<text class="axis" x="${this.xs[i].toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${fmtDate(pts[i].time, series)}</text>`);
    });
    parts.push(`<line class="baseline" x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}"/>`);

    // Line, broken at gaps
    let d = "";
    let pen = false;
    pts.forEach((p, i) => {
      if (p.value === null) {
        pen = false;
        parts.push(`<rect class="gap" x="${(this.xs[i] - 2).toFixed(1)}" y="${H - M.b - 6}" width="4" height="6" rx="1"><title>No data ${p.time}</title></rect>`);
        return;
      }
      d += `${pen ? "L" : "M"}${this.xs[i].toFixed(1)},${this.y(p.value).toFixed(1)}`;
      pen = true;
    });
    parts.push(`<path class="line" d="${d}"/>`);
    pts.forEach((p, i) => {
      if (p.bridged && p.value !== null) parts.push(`<circle class="bridged" cx="${this.xs[i].toFixed(1)}" cy="${this.y(p.value).toFixed(1)}" r="3"/>`);
    });

    this.svg.innerHTML = parts.join("");
    this.playhead = document.createElementNS(NS, "g");
    this.playhead.classList.add("playhead");
    this.playhead.innerHTML = `<line y1="${M.t}" y2="${H - M.b}"/><circle r="5"/>`;
    this.playhead.style.display = "none";
    this.hover = document.createElementNS(NS, "g");
    this.hover.classList.add("hover");
    this.hover.innerHTML = `<line y1="${M.t}" y2="${H - M.b}"/><circle r="4"/>`;
    this.hover.style.display = "none";
    this.svg.append(this.hover, this.playhead);

    const s = series.stats;
    this.svg.setAttribute(
      "aria-label",
      `${series.label} at ${series.region.name}, ${pts.length} points from ${fmtDate(pts[0].time, series)} to ${fmtDate(pts[pts.length - 1].time, series)}. ` +
        `Lowest ${fmtValue(s.min, series.unit)}, highest ${fmtValue(s.max, series.unit)}, mean ${fmtValue(s.mean, series.unit)}. ` +
        `Use left and right arrow keys to read values; Enter to play from there.`,
    );
  }

  setPlayhead(i: number): void {
    if (!this.series) return;
    const p = this.series.points[i];
    const x = this.xs[i];
    this.playhead.style.display = "";
    this.playhead.setAttribute("transform", `translate(${x.toFixed(1)},0)`);
    const c = this.playhead.querySelector("circle")!;
    if (p.value === null) {
      c.setAttribute("cy", String(H - M.b - 3));
      c.classList.add("nodata");
    } else {
      c.setAttribute("cy", this.y(p.value).toFixed(1));
      c.classList.remove("nodata");
    }
  }

  hidePlayhead(): void {
    this.playhead.style.display = "none";
  }

  private indexFromEvent(e: MouseEvent): number {
    const r = this.svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < this.xs.length; i++) if (Math.abs(this.xs[i] - vx) < Math.abs(this.xs[best] - vx)) best = i;
    return best;
  }

  private hoverAt(i: number): void {
    if (!this.series) return;
    const p = this.series.points[i] as CleanPoint;
    const x = this.xs[i];
    this.hover.style.display = "";
    this.hover.setAttribute("transform", `translate(${x.toFixed(1)},0)`);
    const c = this.hover.querySelector("circle")!;
    c.style.display = p.value === null ? "none" : "";
    if (p.value !== null) c.setAttribute("cy", this.y(p.value).toFixed(1));
    const val = p.value === null ? "No data" : `${fmtValue(p.value, this.series.unit)}${p.bridged ? " (interpolated)" : ""}`;
    this.tip.innerHTML = `<span class="tip-date">${fmtDate(p.time, this.series, true)}</span><strong>${val}</strong>`;
    this.tip.hidden = false;
    const pct = (x / W) * 100;
    this.tip.style.left = `${pct}%`;
    this.tip.style.transform = `translateX(${pct > 70 ? "-100%" : pct < 30 ? "0" : "-50%"})`;
  }

  private hideHover(): void {
    this.hover.style.display = "none";
    this.tip.hidden = true;
  }
}

export function renderTable(series: CleanSeries): string {
  const rows = (series.points as CleanPoint[])
    .map(
      (p) =>
        `<tr><td>${fmtDate(p.time, series, true)}</td><td>${
          p.value === null ? "no data" : `${fmtValue(p.value, series.unit)}${p.bridged ? " (interpolated)" : ""}`
        }</td></tr>`,
    )
    .join("");
  return `<table><caption class="sr-only">${series.label}, ${series.region.name}</caption><thead><tr><th scope="col">Date</th><th scope="col">${series.label} (${series.unit})</th></tr></thead><tbody>${rows}</tbody></table>`;
}
