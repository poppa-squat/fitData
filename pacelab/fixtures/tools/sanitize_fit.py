"""Build a sanitized FIT fixture from a real activity.

- GPS track shifted so it starts at a public location (Central Park, NYC).
- Start time moved to 2026-01-15T12:00:00Z (all offsets preserved).
- user_profile, serial numbers, workout notes, undocumented messages dropped.
Usage: pip install garmin-fit-sdk fit-tool
       python3 -I fixtures/tools/sanitize_fit.py fixtures/private/<in>.fit fixtures/fit/<name>.sanitized.fit
Edit TARGET_LAT/TARGET_LON/NEW_START_UNIX if you like. Running and laps-from-workouts only; extend for other sports.
"""
import sys
from garmin_fit_sdk import Decoder, Stream
from fit_tool.fit_file_builder import FitFileBuilder
from fit_tool.profile.messages.file_id_message import FileIdMessage
from fit_tool.profile.messages.device_info_message import DeviceInfoMessage
from fit_tool.profile.messages.event_message import EventMessage
from fit_tool.profile.messages.record_message import RecordMessage
from fit_tool.profile.messages.lap_message import LapMessage
from fit_tool.profile.messages.session_message import SessionMessage
from fit_tool.profile.messages.activity_message import ActivityMessage
from fit_tool.profile.profile_type import (
    FileType, Manufacturer, Event, EventType, Sport, SubSport, LapTrigger, Intensity, SessionTrigger, Activity,
    TimerTrigger,
)

FIT_EPOCH_UNIX = 631065600
SEMI = 180.0 / 2**31
NEW_START_UNIX = 1768478400  # 2026-01-15T12:00:00Z
TARGET_LAT, TARGET_LON = 40.7812, -73.9665
LOCAL_OFFSET_S = -5 * 3600  # EST in January

src, dst = sys.argv[1], sys.argv[2]
m, errs = Decoder(Stream.from_file(src)).read(convert_datetimes_to_dates=False)
assert not errs, errs
sess = m["session_mesgs"][0]
s0 = sess["start_time"]
dlat = TARGET_LAT - sess["start_position_lat"] * SEMI
dlon = TARGET_LON - sess["start_position_long"] * SEMI


def ms(fit_ts):  # fit_tool wants unix milliseconds
    return (fit_ts - s0 + NEW_START_UNIX) * 1000


b = FitFileBuilder(auto_define=True, min_string_size=50)

fid = FileIdMessage()
fid.type = FileType.ACTIVITY
fid.manufacturer = Manufacturer.GARMIN.value
fid.product = 3290  # fenix6
fid.time_created = ms(m["file_id_mesgs"][0]["time_created"])
b.add(fid)

di = DeviceInfoMessage()
di.timestamp = ms(s0)
di.manufacturer = Manufacturer.GARMIN.value
di.product = 3290
di.software_version = 28.02
di.device_index = 0
b.add(di)

for e in m["event_mesgs"]:
    if e.get("event") != "timer":
        continue
    ev = EventMessage()
    ev.timestamp = ms(e["timestamp"])
    ev.event = Event.TIMER
    ev.event_type = EventType.START if e["event_type"] == "start" else EventType.STOP_ALL
    ev.timer_trigger = TimerTrigger.MANUAL
    b.add(ev)

for r in m["record_mesgs"]:
    rec = RecordMessage()
    rec.timestamp = ms(r["timestamp"])
    if r.get("position_lat") is not None:
        rec.position_lat = r["position_lat"] * SEMI + dlat
        rec.position_long = r["position_long"] * SEMI + dlon
    rec.distance = r["distance"]
    rec.enhanced_speed = r["enhanced_speed"]
    rec.enhanced_altitude = r["enhanced_altitude"]
    rec.heart_rate = r["heart_rate"]
    rec.cadence = r["cadence"]
    rec.fractional_cadence = r.get("fractional_cadence", 0.0)
    rec.temperature = r["temperature"]
    b.add(rec)

step_intensity = {0: Intensity.WARMUP, 1: Intensity.ACTIVE, 2: Intensity.ACTIVE, 3: Intensity.COOLDOWN}
trig = {"time": LapTrigger.TIME, "distance": LapTrigger.DISTANCE, "manual": LapTrigger.MANUAL,
        "session_end": LapTrigger.SESSION_END, "position_start": LapTrigger.POSITION_START}
for i, l in enumerate(m["lap_mesgs"]):
    lap = LapMessage()
    lap.message_index = i
    lap.timestamp = ms(l["timestamp"])
    lap.start_time = ms(l["start_time"])
    lap.total_elapsed_time = l["total_elapsed_time"]
    lap.total_timer_time = l["total_timer_time"]
    lap.total_distance = l["total_distance"]
    lap.enhanced_avg_speed = l["enhanced_avg_speed"]
    lap.enhanced_max_speed = l["enhanced_max_speed"]
    lap.avg_heart_rate = l["avg_heart_rate"]
    lap.max_heart_rate = l["max_heart_rate"]
    lap.avg_cadence = l["avg_cadence"]
    lap.total_ascent = l["total_ascent"]
    lap.total_descent = l["total_descent"]
    lap.total_calories = l["total_calories"]
    lap.event = Event.LAP
    lap.event_type = EventType.STOP
    lap.lap_trigger = trig[l["lap_trigger"]]
    lap.sport = Sport.RUNNING
    lap.sub_sport = SubSport.GENERIC
    if l.get("wkt_step_index") is not None:
        lap.wkt_step_index = l["wkt_step_index"]
        if l["wkt_step_index"] in step_intensity:  # matches the workout in easy-run; adjust per file
            lap.intensity = step_intensity[l["wkt_step_index"]]
    b.add(lap)

se = SessionMessage()
se.message_index = 0
se.timestamp = ms(sess["timestamp"])
se.start_time = ms(s0)
se.start_position_lat = TARGET_LAT
se.start_position_long = TARGET_LON
se.total_elapsed_time = sess["total_elapsed_time"]
se.total_timer_time = sess["total_timer_time"]
se.total_distance = sess["total_distance"]
se.enhanced_avg_speed = sess["enhanced_avg_speed"]
se.enhanced_max_speed = sess["enhanced_max_speed"]
se.avg_heart_rate = sess["avg_heart_rate"]
se.max_heart_rate = sess["max_heart_rate"]
se.avg_cadence = sess["avg_cadence"]
se.max_cadence = sess["max_cadence"]
se.total_ascent = sess["total_ascent"]
se.total_descent = sess["total_descent"]
se.total_calories = sess["total_calories"]
se.first_lap_index = 0
se.num_laps = sess["num_laps"]
se.event = Event.LAP
se.event_type = EventType.STOP
se.trigger = SessionTrigger.ACTIVITY_END
se.sport = Sport.RUNNING
se.sub_sport = SubSport.GENERIC
b.add(se)

act = ActivityMessage()
act.timestamp = ms(m["activity_mesgs"][0]["timestamp"])
act.total_timer_time = m["activity_mesgs"][0]["total_timer_time"]
act.num_sessions = 1
act.type = Activity.MANUAL
act.event = Event.ACTIVITY
act.event_type = EventType.STOP
act.local_timestamp = (m["activity_mesgs"][0]["timestamp"] - s0 + NEW_START_UNIX - FIT_EPOCH_UNIX) + LOCAL_OFFSET_S
b.add(act)

b.build().to_file(dst)
print("wrote", dst)
