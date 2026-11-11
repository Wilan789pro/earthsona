import type { Adapter, EarthSeries, FetchParams } from "../types";
import { simulateSeries } from "./simulatedAdapter";

/**
 * Ocean Symphony — sea surface temperature.
 *
 * TODO(mentor): confirm the source before implementing. Intended source:
 *   JPL MUR SST (Multi-scale Ultra-high Resolution, GHRSST L4, 0.01°, daily, dataset "MUR-JPL-L4-GLOB-v4.1",
 *   doi:10.5067/GHGMR-4FJ04), read as a point time series through an ERDDAP griddap endpoint, e.g.
 *     https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst[(START):7:(END)][(LAT)][(LON)]
 *   (stride 7 = weekly; values in °C on that server; check `_FillValue` / NaN handling and CORS first).
 *   Then: map rows → EarthPoint, set source.kind = "nasa", name = "NASA JPL MUR SST (PO.DAAC)", add the
 *   PO.DAAC citation, add a fixture under tests/fixtures/ and a parser test, and add "sst" to
 *   scripts/fetch-nasa-data.mjs.
 *
 * Until then this adapter deliberately returns SIMULATED data, labelled as such.
 */
export const SST_IMPLEMENTED = false;

export const sstAdapter: Adapter = {
  async fetchSeries(params: FetchParams): Promise<EarthSeries> {
    return simulateSeries(params);
  },
};
