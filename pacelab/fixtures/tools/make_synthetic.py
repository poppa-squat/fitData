"""Deterministic SYNTHETIC fixtures (fake person, fake data) so every track can
work on cycling, swimming, trends and readiness before real sync exists.

    python3 -I fixtures/tools/make_synthetic.py
writes fixtures/canonical/{cycling-synthetic,swim-synthetic,index-synthetic}.json
"""
import json
import math
import os
import random
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "canonical")
rng = random.Random(42)
IMPORTED = "2026-02-01T00:00:00Z"


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def summary_of(a):
    return {k: v for k, v in a.items() if k not in ("samples", "pauses", "laps", "swimLengths")}


def cycling():
    start = datetime(2026, 1, 17, 14, 0, tzinfo=timezone.utc)
    n = 3600
    t, hr, pw, cad, spd, dist, alt = [], [], [], [], [], [], []
    d, h = 0.0, 95.0
    laps = []
    for i in range(n):
        in_interval = 900 <= i < 2700 and ((i - 900) // 300) % 2 == 0  # 3 x 5 min hard, 5 min easy
        target = 260 if in_interval else 160
        if i < 600:
            target = 120 + i * 0.07
        if i >= 3000:
            target = 130
        p = max(0, target + rng.gauss(0, 12))
        h += ((95 + p * 0.3) - h) / 25  # HR lags power
        v = 6.5 + p / 60 + rng.gauss(0, 0.15)
        d += v
        t.append(i)
        pw.append(round(p))
        hr.append(round(h))
        cad.append(round(88 + rng.gauss(0, 3) + (4 if in_interval else 0)))
        spd.append(round(v, 3))
        dist.append(round(d, 2))
        alt.append(round(20 + 5 * math.sin(i / 300), 2))
    bounds = [0, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3600]
    names = ["warmup", "active", "interval", "recovery", "interval", "recovery", "interval", "recovery", "active", "cooldown"]
    for li, (a, b) in enumerate(zip(bounds, bounds[1:])):
        laps.append({"index": li, "startT": a, "endT": b, "movingTimeS": b - a, "distanceM": round(dist[b - 1] - (dist[a - 1] if a else 0), 2),
                     "avgHr": round(sum(hr[a:b]) / (b - a)), "maxHr": max(hr[a:b]), "avgSpeed": round(sum(spd[a:b]) / (b - a), 3),
                     "trigger": "manual", "intensity": names[li]})
    return {
        "id": "file:00000000c7c11e01", "schemaVersion": 1, "sport": "cycling", "subSport": "indoor_cycling",
        "name": "SYNTHETIC trainer intervals 3x5", "startTime": iso(start), "timezoneOffsetMin": -300,
        "elapsedTimeS": n, "movingTimeS": n, "distanceM": dist[-1], "avgHr": round(sum(hr) / n), "maxHr": max(hr),
        "calories": 700, "hasGps": False, "channels": ["heartRate", "speed", "distance", "altitude", "cadence", "power"],
        "source": {"provider": "file", "format": "fit", "device": "synthetic", "importedAt": IMPORTED},
        "samples": {"t": t, "channels": {"heartRate": hr, "speed": spd, "distance": dist, "altitude": alt, "cadence": cad, "power": pw}},
        "pauses": [], "laps": laps,
    }


def swim():
    start = datetime(2026, 1, 19, 11, 30, tzinfo=timezone.utc)
    pool = 25.0
    t, hr, spd, dist, cad = [], [], [], [], []
    lengths, laps = [], []
    clock, d, h, li = 0.0, 0.0, 100.0, 0
    sets = [(8, "freestyle"), (4, "backstroke"), (8, "freestyle"), (4, "breaststroke"), (8, "freestyle")]
    for si, (count, stroke) in enumerate(sets):
        lap_start = clock
        lap_d0 = d
        for _ in range(count):
            dur = (22 if stroke == "freestyle" else 27) + rng.gauss(0, 1.2)
            strokes = round((17 if stroke == "freestyle" else 15) + rng.gauss(0, 1))
            lengths.append({"index": li, "startT": round(clock, 1), "endT": round(clock + dur, 1), "strokes": strokes,
                            "stroke": stroke, "idle": False})
            clock += dur
            d += pool
            h += (150 - h) / 4
            t.append(round(clock, 1)); hr.append(round(h)); spd.append(round(pool / dur, 3)); dist.append(d)
            cad.append(round(strokes / dur * 60, 1))
            li += 1
        laps.append({"index": si, "startT": round(lap_start, 1), "endT": round(clock, 1), "movingTimeS": round(clock - lap_start, 1),
                     "distanceM": d - lap_d0, "trigger": "manual", "intensity": "active"})
        if si < len(sets) - 1:  # 30 s rest, recorded as an idle length
            lengths.append({"index": li, "startT": round(clock, 1), "endT": round(clock + 30, 1), "stroke": "unknown", "idle": True})
            clock += 30
            h -= 20
            t.append(round(clock, 1)); hr.append(round(h)); spd.append(0.0); dist.append(d); cad.append(None)
            li += 1
    return {
        "id": "file:000000005e1a7001", "schemaVersion": 1, "sport": "swimming", "subSport": "lap_swimming",
        "name": "SYNTHETIC pool 800m", "startTime": iso(start), "timezoneOffsetMin": -300,
        "elapsedTimeS": round(clock, 1), "movingTimeS": round(clock - 30 * (len(sets) - 1), 1), "distanceM": d,
        "avgHr": round(sum(hr) / len(hr)), "maxHr": max(hr), "poolLengthM": pool, "hasGps": False,
        "channels": ["heartRate", "speed", "distance", "cadence"],
        "source": {"provider": "file", "format": "fit", "device": "synthetic", "importedAt": IMPORTED},
        "samples": {"t": t, "channels": {"heartRate": hr, "speed": spd, "distance": dist, "cadence": cad}},
        "pauses": [], "laps": laps, "swimLengths": lengths,
    }


def index(full):
    acts = [summary_of(a) for a in full]
    wellness = []
    d0 = date(2025, 12, 1)
    load_yesterday = 0.0
    for k in range(62):
        day = d0 + timedelta(days=k)
        # ~4 synthetic runs a week (summary only)
        if rng.random() < 0.55:
            dur = rng.choice([1800, 2400, 3000, 3600, 4800])
            spd = rng.uniform(2.6, 3.4)
            st = datetime(day.year, day.month, day.day, 22, 0, tzinfo=timezone.utc)
            acts.append({"id": f"file:{k:016x}", "schemaVersion": 1, "sport": rng.choice(["running"] * 5 + ["cycling", "swimming"]),
                         "subSport": "generic", "name": "SYNTHETIC", "startTime": iso(st), "timezoneOffsetMin": -300,
                         "elapsedTimeS": dur + 60, "movingTimeS": dur, "distanceM": round(dur * spd, 1),
                         "avgHr": round(140 + rng.gauss(0, 8)), "maxHr": round(170 + rng.gauss(0, 6)), "hasGps": True,
                         "channels": ["heartRate", "speed", "distance", "cadence"],
                         "source": {"provider": "file", "format": "fit", "device": "synthetic", "importedAt": IMPORTED}})
            load_yesterday = dur / 3600
        else:
            load_yesterday = 0.0
        total = max(14400, rng.gauss(7.2 * 3600, 2400))
        bed_end = datetime(day.year, day.month, day.day, 11, 30, tzinfo=timezone.utc) + timedelta(minutes=rng.randint(-40, 40))
        bed_start = bed_end - timedelta(seconds=total + rng.randint(1200, 3000))
        hrv = max(15, rng.gauss(48, 7) - 6 * load_yesterday)
        rhr = rng.gauss(54, 2) + 2 * load_yesterday
        wellness.append({
            "date": day.isoformat(),
            "sleep": {"source": "oura", "bedtimeStart": iso(bed_start), "bedtimeEnd": iso(bed_end), "totalSleepS": round(total),
                      "deepS": round(total * 0.18), "remS": round(total * 0.22), "lightS": round(total * 0.60),
                      "awakeS": rng.randint(900, 3000), "latencyS": rng.randint(240, 1500), "efficiencyPct": rng.randint(82, 95),
                      "avgHr": round(rhr + 4), "lowestHr": round(rhr - 3), "avgHrvMs": round(hrv, 1),
                      "avgBreathRate": round(rng.gauss(14.5, 0.6), 2), "providerScore": rng.randint(60, 92)},
            "restingHr": {"value": round(rhr - 3), "source": "oura"},
            "hrvMs": {"value": round(hrv, 1), "source": "oura"},
            "providerReadiness": {"value": rng.randint(55, 92), "source": "oura"},
            "temperatureDeviationC": {"value": round(rng.gauss(0, 0.25), 2), "source": "oura"},
            "steps": {"value": rng.randint(4000, 16000), "source": "garmin"},
        })
    acts.sort(key=lambda a: a["startTime"], reverse=True)
    return {"schemaVersion": 1, "profileId": "synthetic", "generatedAt": IMPORTED, "activities": acts, "wellness": wellness}


if __name__ == "__main__":
    real = json.load(open(os.path.join(OUT, "easy-run.json")))
    c, s = cycling(), swim()
    for name, obj in (("cycling-synthetic.json", c), ("swim-synthetic.json", s), ("index-synthetic.json", index([real, c, s]))):
        with open(os.path.join(OUT, name), "w") as f:
            json.dump(obj, f, separators=(",", ":"))
            f.write("\n")
        print("wrote", name)
