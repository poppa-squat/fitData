"""Reference FIT -> canonical Activity converter (Python, official garmin-fit-sdk).

This is the *executable spec* for docs/CONTRACTS.md §3. The C# importer
(sync/) and the TS importer (packages/data) must produce output equal to what
this script produces, within the tolerances in docs/CONTRACTS.md §3.4.

    pip install garmin-fit-sdk
    python3 -I fixtures/tools/fit_to_canonical.py fixtures/fit/easy-run.sanitized.fit \
        --imported-at 2026-01-15T13:00:00Z > fixtures/canonical/easy-run.json
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone

from garmin_fit_sdk import Decoder, Stream

FIT_EPOCH_UNIX = 631065600
SEMI = 180.0 / 2**31
SPORTS = {"running", "cycling", "swimming", "walking", "hiking"}
LAP_TRIGGERS = {"manual": "manual", "time": "time", "distance": "distance", "session_end": "session_end",
                "position_start": "position", "position_lap": "position", "position_waypoint": "position",
                "position_marked": "position"}
INTENSITIES = {"warmup", "active", "interval", "rest", "recovery", "cooldown", "other"}
STROKES = {"freestyle", "backstroke", "breaststroke", "butterfly", "drill", "mixed", "im"}


def iso(fit_ts):
    return datetime.fromtimestamp(fit_ts + FIT_EPOCH_UNIX, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def first(d, *keys):
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return None


def rnd(v, nd=3):
    return None if v is None else round(float(v), nd)


def convert(path, imported_at):
    data = open(path, "rb").read()
    m, errs = Decoder(Stream.from_byte_array(bytearray(data))).read(convert_datetimes_to_dates=False)
    if errs:
        raise SystemExit(f"decode errors: {errs}")
    sess = m["session_mesgs"][0]
    s0 = sess["start_time"]
    sport_raw = sess.get("sport", "generic")
    sport = sport_raw if sport_raw in SPORTS else "other"
    sub = str(sess.get("sub_sport", "generic"))

    recs = sorted(m.get("record_mesgs", []), key=lambda r: r["timestamp"])
    t = []
    cols = {k: [] for k in ["heartRate", "speed", "distance", "altitude", "lat", "lon", "cadence", "power",
                            "temperature", "respirationRate", "stepLength", "verticalOscillation",
                            "groundContactTime", "verticalRatio", "gctBalance"]}
    last_t = None
    for r in recs:
        ti = r["timestamp"] - s0
        if last_t is not None and ti <= last_t:
            continue  # contract: t strictly increasing; keep first record per timestamp
        last_t = ti
        t.append(ti)
        cad = r.get("cadence")
        if cad is not None and sport in ("running", "walking", "hiking"):
            cad = 2 * (cad + (r.get("fractional_cadence") or 0.0))  # FIT stores strides/min (one foot)
        lat, lon = r.get("position_lat"), r.get("position_long")
        sl = r.get("step_length")  # mm
        vo = r.get("vertical_oscillation")  # mm
        st = r.get("stance_time")  # ms
        cols["heartRate"].append(r.get("heart_rate"))
        cols["speed"].append(rnd(first(r, "enhanced_speed", "speed")))
        cols["distance"].append(rnd(r.get("distance"), 2))
        cols["altitude"].append(rnd(first(r, "enhanced_altitude", "altitude"), 2))
        cols["lat"].append(None if lat is None else round(lat * SEMI, 7))
        cols["lon"].append(None if lon is None else round(lon * SEMI, 7))
        cols["cadence"].append(rnd(cad, 3))
        cols["power"].append(r.get("power"))
        cols["temperature"].append(r.get("temperature"))
        cols["respirationRate"].append(rnd(first(r, "enhanced_respiration_rate", "respiration_rate"), 2))
        cols["stepLength"].append(None if sl is None else rnd(sl / 1000.0, 4))
        cols["verticalOscillation"].append(None if vo is None else rnd(vo / 1000.0, 4))
        cols["groundContactTime"].append(None if st is None else rnd(st / 1000.0, 4))
        cols["verticalRatio"].append(rnd(r.get("vertical_ratio"), 2))
        cols["gctBalance"].append(rnd(r.get("stance_time_balance"), 2))
    channels = {k: v for k, v in cols.items() if any(x is not None for x in v)}

    pauses, stop_at = [], None
    for e in sorted(m.get("event_mesgs", []), key=lambda e: e["timestamp"]):
        if e.get("event") != "timer":
            continue
        if e.get("event_type") in ("stop", "stop_all") and stop_at is None:
            stop_at = e["timestamp"] - s0
        elif e.get("event_type") == "start" and stop_at is not None:
            pauses.append({"startT": stop_at, "endT": e["timestamp"] - s0})
            stop_at = None

    laps = []
    for i, l in enumerate(sorted(m.get("lap_mesgs", []), key=lambda l: l["start_time"])):
        st = l["start_time"] - s0
        lap = {"index": i, "startT": st, "endT": rnd(st + l["total_elapsed_time"]),
               "movingTimeS": rnd(l["total_timer_time"]), "trigger": LAP_TRIGGERS.get(str(l.get("lap_trigger")), "other")}
        for key, val in (("distanceM", rnd(l.get("total_distance"), 2)), ("avgHr", l.get("avg_heart_rate")),
                         ("maxHr", l.get("max_heart_rate")),
                         ("avgSpeed", rnd(first(l, "enhanced_avg_speed", "avg_speed"))),
                         ("workoutStepIndex", l.get("wkt_step_index"))):
            if val is not None:
                lap[key] = val
        inten = l.get("intensity")
        if inten in INTENSITIES:
            lap["intensity"] = inten
        laps.append(lap)

    lengths = []
    for i, ln in enumerate(sorted(m.get("length_mesgs", []), key=lambda x: x["start_time"])):
        st = ln["start_time"] - s0
        item = {"index": i, "startT": st, "endT": rnd(st + ln["total_elapsed_time"]),
                "stroke": ln.get("swim_stroke") if ln.get("swim_stroke") in STROKES else "unknown",
                "idle": ln.get("length_type") == "idle"}
        if ln.get("total_strokes") is not None:
            item["strokes"] = ln["total_strokes"]
        lengths.append(item)

    act = (m.get("activity_mesgs") or [{}])[0]
    out = {
        "id": "file:" + hashlib.sha256(data).hexdigest()[:16],
        "schemaVersion": 1,
        "sport": sport,
        "subSport": sub,
        "startTime": iso(s0),
    }
    if act.get("local_timestamp") is not None and act.get("timestamp") is not None:
        out["timezoneOffsetMin"] = round((act["local_timestamp"] - act["timestamp"]) / 60)
    out["elapsedTimeS"] = rnd(sess["total_elapsed_time"])
    out["movingTimeS"] = rnd(sess["total_timer_time"])
    for key, val in (("distanceM", rnd(sess.get("total_distance"), 2)), ("avgHr", sess.get("avg_heart_rate")),
                     ("maxHr", sess.get("max_heart_rate")), ("ascentM", sess.get("total_ascent")),
                     ("descentM", sess.get("total_descent")), ("calories", sess.get("total_calories")),
                     ("poolLengthM", sess.get("pool_length"))):
        if val is not None:
            out[key] = val
    out["hasGps"] = "lat" in channels
    out["channels"] = list(channels.keys())
    fid = m["file_id_mesgs"][0]
    device = " ".join(str(x) for x in (fid.get("manufacturer"), fid.get("garmin_product") or fid.get("product")) if x)
    out["source"] = {"provider": "file", "format": "fit", "device": device, "importedAt": imported_at}
    out["samples"] = {"t": t, "channels": channels}
    out["pauses"] = pauses
    out["laps"] = laps
    if lengths:
        out["swimLengths"] = lengths
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("fit")
    ap.add_argument("--imported-at", default=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    a = ap.parse_args()
    json.dump(convert(a.fit, a.imported_at), sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
