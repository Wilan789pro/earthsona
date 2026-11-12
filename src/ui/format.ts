import type { EarthSeries } from "../data/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monthly series show "Mar 2020"; finer series show "5 Mar 2020" when `full`. */
export function fmtDate(iso: string, series: Pick<EarthSeries, "points">, full = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const monthly = series.points.length > 1 && series.points.every((p) => p.time.endsWith("-01"));
  if (monthly || !full) return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function fmtValue(v: number, unit: string, short = false): string {
  const unitless = unit.match(/^(\w+) \(unitless\)$/);
  if (unitless) return short ? v.toFixed(2) : `${unitless[1]} ${v.toFixed(2)}`;
  const dp = Math.abs(v) >= 100 ? 0 : 1;
  return `${v.toFixed(dp)} ${unit}`.trim();
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
