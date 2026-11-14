"""Extract, for each ocean place, the nearest real point of the team's ocean CSV
(Datasets/global_ocean_complete_data.csv, read-only) into src/data/oceanSnapshot.json.
Used as REAL starting values for the Ocean lab. Nothing is interpolated: each place gets one real row
plus its distance, so the UI can say how far away the measurement is."""
import csv, json, math, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(os.path.join(root, "scripts", "regions.json"), encoding="utf-8"))
src = next(p for p in (os.path.join(root, "Datasets", "global_ocean_complete_data.csv"), os.path.join(root, "global_ocean_complete_data.csv")) if os.path.exists(p))
rows = list(csv.DictReader(open(src, encoding="utf-8")))
def km(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
num = lambda s: float(s) if s not in ("", None) else None
out = {"source": "global_ocean_complete_data.csv (team export, Earth Information Jukebox project)", "places": {}}
for rid in cfg["experiences"]["ocean"]["regions"]:
    r = next(x for x in cfg["regions"] if x["id"] == rid)
    ok = [x for x in rows if num(x["noaa_sst_c"]) is not None]
    best = min(ok, key=lambda x: km(r["lat"], r["lon"], float(x["latitude"]), float(x["longitude"])))
    out["places"][rid] = {
        "lat": round(float(best["latitude"]), 3), "lon": round(float(best["longitude"]), 3),
        "distanceKm": round(km(r["lat"], r["lon"], float(best["latitude"]), float(best["longitude"]))),
        "from": best["start_date"], "to": best["end_date"],
        "sst": round(num(best["noaa_sst_c"]), 2), "sstAnomaly": round(num(best["temperature_anomaly_c"]), 2),
        "chlorophyll": None if num(best["chlorophyll_a"]) is None else round(num(best["chlorophyll_a"]), 3),
        "salinity": None if num(best["sea_surface_salinity_psu"]) is None else round(num(best["sea_surface_salinity_psu"]), 2),
        "waveHeight": None if num(best["significant_wave_height_m"]) is None else round(num(best["significant_wave_height_m"]), 2),
        "sources": {"temperature": best["temperature_source"], "colour": best["ocean_colour_source"], "salinity": best["salinity_source"], "waves": best["wave_source"]},
    }
json.dump(out, open(os.path.join(root, "src", "data", "oceanSnapshot.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps(out, indent=1))
