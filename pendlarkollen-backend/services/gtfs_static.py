import io
import io as textio
import csv
import zipfile
import time
from typing import Dict, Set, Tuple
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from fastapi import HTTPException

from services.config import BASE, DEV_MODE, TRAFIKLAB_KEY_STATIC

# ===== CACHES =====
ROUTES_CACHE: Dict[str, Dict[str, str]] = {}  # operator -> { route_id -> route_short_name }
GTFS_ZIP_CACHE: Dict[str, tuple[float, bytes]] = {}  # operator -> (timestamp, zip_bytes)
GTFS_ZIP_TTL_SECONDS = 60 * 60 * 6  # 6 timmar
# ===== MERA CACHES =====
TRIPS_CACHE: Dict[str, Dict[str, str]] = {}           # operator -> { trip_id -> route_id }
STOPS_CACHE: Dict[str, Dict[str, dict]] = {}          # operator -> stop_id -> {name, lat, lon}
STOP_TIMES_CACHE: Dict[str, Dict[str, list]] = {}     # operator -> trip_id -> [(seq, stop_id)]
ROUTE_TO_TRIPS_CACHE: Dict[str, Dict[str, list]] = {} # operator -> route_id -> [trip_id,...]
TRIP_SHAPE_CACHE: Dict[str, Dict[str, str]] = {}      # operator -> { trip_id -> shape_id }
SHAPES_CACHE: Dict[str, Dict[str, list]] = {}         # operator -> { shape_id -> [[lon, lat], ...] }
STOP_TO_LINES_CACHE: Dict[str, Dict[str, list]] = {}  # operator -> stop_id -> [line_short_name,...]

TRIP_SERVICE_CACHE: Dict[str, Dict[str, str]] = {}   # operator -> { trip_id -> service_id }
CALENDAR_CACHE: Dict[str, Dict[str, dict]] = {}      # operator -> { service_id -> {start,end,weekday_flags...} }
CALENDAR_DATES_CACHE: Dict[str, Dict[str, dict]] = {}  # operator -> { service_id -> {"add": set(), "remove": set()} }
ACTIVE_SERVICE_CACHE: Dict[str, Tuple[str, Set[str]]] = {}  # operator -> (yyyymmdd, active_service_ids)
STOP_TIMES_WITH_TIME_CACHE: Dict[str, Dict[str, list]] = {}  # operator -> trip_id -> [(seq, stop_id, dep_sec)]
ACTIVE_STOP_LINE_TIMES_CACHE: Dict[str, Tuple[str, Dict[str, Dict[str, list]]]] = {}  # operator -> (yyyymmdd, stop_id -> { line_short -> [dep_sec,...] })

# ===== TIME HELPERS (Stockholm + GTFS times) =====
def today_yyyymmdd_stockholm() -> str:
    return datetime.now(ZoneInfo("Europe/Stockholm")).date().strftime("%Y%m%d")


def now_seconds_stockholm() -> int:
    now = datetime.now(ZoneInfo("Europe/Stockholm"))
    return now.hour * 3600 + now.minute * 60 + now.second


def parse_hhmmss_to_seconds(s: str) -> int | None:
    """
    GTFS tillåter tider > 23:59:59 (t.ex. 25:10:00).
    Vi parse:ar HH:MM:SS till sekunder.
    """
    s = (s or "").strip()
    if not s:
        return None

    parts = s.split(":")
    if len(parts) != 3:
        return None

    try:
        hh = int(parts[0])
        mm = int(parts[1])
        ss = int(parts[2])
    except ValueError:
        return None

    if hh < 0 or mm < 0 or mm > 59 or ss < 0 or ss > 59:
        return None

    return hh * 3600 + mm * 60 + ss


def is_within_window(dep_sec: int, now_sec: int, window_sec: int) -> bool:
    """
    dep_sec kan vara > 86400 (t.ex. 25:10).
    Vi kollar närmaste “dygnsskift”-justering.
    """
    # närmaste dygn-offset
    k = round((dep_sec - now_sec) / 86400)

    for dk in (k - 1, k, k + 1):
        if abs((dep_sec - dk * 86400) - now_sec) <= window_sec:
            return True
    return False

def get_gtfs_zip_bytes(operator: str) -> bytes:
    """
    Hämtar GTFS zip (static).
    I DEV_MODE returnerar vi tomt bytes, och callers kan hantera det.
    """
    if DEV_MODE:
        return b""

    now = time.time()
    cached = GTFS_ZIP_CACHE.get(operator)
    if cached:
        ts, data = cached
        if now - ts < GTFS_ZIP_TTL_SECONDS:
            return data

    url = f"{BASE}/gtfs/{operator}/{operator}.zip?key={TRAFIKLAB_KEY_STATIC}"
    r = requests.get(url, timeout=30)

    # Robust backoff vid rate limit
    if r.status_code == 429:
        for attempt in range(4):  # max ~2+4+8+16 = 30s
            retry_after = r.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                wait_s = int(retry_after)
            else:
                wait_s = 2 ** (attempt + 1)  # 2,4,8,16

            time.sleep(wait_s)
            r = requests.get(url, timeout=30)
            if r.status_code != 429:
                break

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GTFS static misslyckades: {r.status_code}")

    GTFS_ZIP_CACHE[operator] = (now, r.content)
    return r.content


def load_routes_for_operator(operator: str) -> Dict[str, str]:
    """
    Returnerar mapping route_id -> route_short_name
    """
    if operator in ROUTES_CACHE:
        return ROUTES_CACHE[operator]

    if DEV_MODE:
        ROUTES_CACHE[operator] = {}
        return ROUTES_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "routes.txt" not in z.namelist():
        raise HTTPException(status_code=502, detail="routes.txt saknas i zip")

    mapping: Dict[str, str] = {}

    with z.open("routes.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            rid = (row.get("route_id") or "").strip()
            short = (row.get("route_short_name") or "").strip()
            if rid:
                mapping[rid] = short

    ROUTES_CACHE[operator] = mapping
    return mapping

def load_trips_for_operator(operator: str) -> Dict[str, str]:
    """
    Returnerar mapping: trip_id -> route_id
    """
    if operator in TRIPS_CACHE:
        return TRIPS_CACHE[operator]

    if DEV_MODE:
        TRIPS_CACHE[operator] = {}
        return TRIPS_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "trips.txt" not in z.namelist():
        raise HTTPException(status_code=502, detail="trips.txt saknas i zip")

    mapping: Dict[str, str] = {}

    with z.open("trips.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            trip_id = (row.get("trip_id") or "").strip()
            route_id = (row.get("route_id") or "").strip()
            if trip_id and route_id:
                mapping[trip_id] = route_id

    TRIPS_CACHE[operator] = mapping
    return mapping

def load_trip_shapes_for_operator(operator: str) -> Dict[str, str]:
    """
    Returnerar mapping: trip_id -> shape_id
    """
    if operator in TRIP_SHAPE_CACHE:
        return TRIP_SHAPE_CACHE[operator]

    if DEV_MODE:
        TRIP_SHAPE_CACHE[operator] = {}
        return TRIP_SHAPE_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "trips.txt" not in z.namelist():
        TRIP_SHAPE_CACHE[operator] = {}
        return TRIP_SHAPE_CACHE[operator]

    mapping: Dict[str, str] = {}

    with z.open("trips.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            trip_id = (row.get("trip_id") or "").strip()
            shape_id = (row.get("shape_id") or "").strip()
            if trip_id and shape_id:
                mapping[trip_id] = shape_id

    TRIP_SHAPE_CACHE[operator] = mapping
    return mapping

def load_shapes_for_operator(operator: str) -> Dict[str, list]:
    """
    Returnerar mapping:
      shape_id -> [[lon, lat], [lon, lat], ...]

    Bygger koordinater i ordning enligt shape_pt_sequence.
    Om shapes.txt saknas returneras tom mapping.
    """
    if operator in SHAPES_CACHE:
        return SHAPES_CACHE[operator]

    if DEV_MODE:
        SHAPES_CACHE[operator] = {}
        return SHAPES_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "shapes.txt" not in z.namelist():
        SHAPES_CACHE[operator] = {}
        return SHAPES_CACHE[operator]

    raw: Dict[str, list] = {}

    with z.open("shapes.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            shape_id = (row.get("shape_id") or "").strip()
            lat_s = (row.get("shape_pt_lat") or "").strip()
            lon_s = (row.get("shape_pt_lon") or "").strip()
            seq_s = (row.get("shape_pt_sequence") or "").strip()

            if not shape_id or not lat_s or not lon_s or not seq_s:
                continue

            try:
                lat = float(lat_s)
                lon = float(lon_s)
                seq = int(seq_s)
            except ValueError:
                continue

            raw.setdefault(shape_id, []).append((seq, [lon, lat]))

    out: Dict[str, list] = {}
    for shape_id, points in raw.items():
        points.sort(key=lambda x: x[0])
        coords = [coord for _seq, coord in points]
        if len(coords) >= 2:
            out[shape_id] = coords

    SHAPES_CACHE[operator] = out
    return out
    
def load_trip_services_for_operator(operator: str) -> Dict[str, str]:
    """
    Returnerar mapping: trip_id -> service_id
    """
    if operator in TRIP_SERVICE_CACHE:
        return TRIP_SERVICE_CACHE[operator]

    if DEV_MODE:
        TRIP_SERVICE_CACHE[operator] = {}
        return TRIP_SERVICE_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "trips.txt" not in z.namelist():
        raise HTTPException(status_code=502, detail="trips.txt saknas i zip")

    mapping: Dict[str, str] = {}

    with z.open("trips.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            trip_id = (row.get("trip_id") or "").strip()
            service_id = (row.get("service_id") or "").strip()
            if trip_id and service_id:
                mapping[trip_id] = service_id

    TRIP_SERVICE_CACHE[operator] = mapping
    return mapping

def load_calendar_for_operator(operator: str) -> Dict[str, dict]:
    if operator in CALENDAR_CACHE:
        return CALENDAR_CACHE[operator]

    if DEV_MODE:
        CALENDAR_CACHE[operator] = {}
        return CALENDAR_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    # calendar.txt kan saknas i vissa GTFS, då får vi hantera via calendar_dates
    if "calendar.txt" not in z.namelist():
        CALENDAR_CACHE[operator] = {}
        return CALENDAR_CACHE[operator]

    out: Dict[str, dict] = {}

    with z.open("calendar.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            service_id = (row.get("service_id") or "").strip()
            if not service_id:
                continue

            # weekday flags 0/1
            out[service_id] = {
                "monday": (row.get("monday") or "0").strip() == "1",
                "tuesday": (row.get("tuesday") or "0").strip() == "1",
                "wednesday": (row.get("wednesday") or "0").strip() == "1",
                "thursday": (row.get("thursday") or "0").strip() == "1",
                "friday": (row.get("friday") or "0").strip() == "1",
                "saturday": (row.get("saturday") or "0").strip() == "1",
                "sunday": (row.get("sunday") or "0").strip() == "1",
                "start_date": (row.get("start_date") or "").strip(),  # YYYYMMDD
                "end_date": (row.get("end_date") or "").strip(),      # YYYYMMDD
            }

    CALENDAR_CACHE[operator] = out
    return out


def load_calendar_dates_for_operator(operator: str) -> Dict[str, dict]:
    if operator in CALENDAR_DATES_CACHE:
        return CALENDAR_DATES_CACHE[operator]

    if DEV_MODE:
        CALENDAR_DATES_CACHE[operator] = {}
        return CALENDAR_DATES_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "calendar_dates.txt" not in z.namelist():
        CALENDAR_DATES_CACHE[operator] = {}
        return CALENDAR_DATES_CACHE[operator]

    out: Dict[str, dict] = {}

    with z.open("calendar_dates.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            service_id = (row.get("service_id") or "").strip()
            date_s = (row.get("date") or "").strip()  # YYYYMMDD
            ex_s = (row.get("exception_type") or "").strip()  # 1=add, 2=remove
            if not service_id or not date_s or ex_s not in ("1", "2"):
                continue

            entry = out.setdefault(service_id, {"add": set(), "remove": set()})
            if ex_s == "1":
                entry["add"].add(date_s)
            else:
                entry["remove"].add(date_s)

    CALENDAR_DATES_CACHE[operator] = out
    return out

def load_stops_for_operator(operator: str) -> Dict[str, dict]:
    """
    Returnerar mapping: stop_id -> { stop_id, name, lat, lon }
    """
    if operator in STOPS_CACHE:
        return STOPS_CACHE[operator]

    if DEV_MODE:
        STOPS_CACHE[operator] = {}
        return STOPS_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "stops.txt" not in z.namelist():
        raise HTTPException(status_code=502, detail="stops.txt saknas i zip")

    mapping: Dict[str, dict] = {}

    with z.open("stops.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            stop_id = (row.get("stop_id") or "").strip()
            if not stop_id:
                continue

            name = (row.get("stop_name") or "").strip()
            lat_s = (row.get("stop_lat") or "").strip()
            lon_s = (row.get("stop_lon") or "").strip()

            try:
                lat = float(lat_s)
                lon = float(lon_s)
            except ValueError:
                continue

            parent_station = (row.get("parent_station") or "").strip()

            mapping[stop_id] = {
                "stop_id": stop_id,
                "name": name,
                "lat": lat,
                "lon": lon,
                "parent_station": parent_station,
            }

    STOPS_CACHE[operator] = mapping
    return mapping

def load_stop_times_for_operator(operator: str):
    """
    Returnerar:
    - stop_times: trip_id -> [(seq, stop_id)]
    - route_to_trips: route_id -> [trip_id,...]
    """
    if operator in STOP_TIMES_CACHE and operator in ROUTE_TO_TRIPS_CACHE:
        return STOP_TIMES_CACHE[operator], ROUTE_TO_TRIPS_CACHE[operator]

    if DEV_MODE:
        STOP_TIMES_CACHE[operator] = {}
        ROUTE_TO_TRIPS_CACHE[operator] = {}
        return STOP_TIMES_CACHE[operator], ROUTE_TO_TRIPS_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "stop_times.txt" not in z.namelist():
        raise HTTPException(status_code=502, detail="stop_times.txt saknas i zip")

    trip_to_route = load_trips_for_operator(operator)

    route_to_trips: Dict[str, list] = {}
    for trip_id, route_id in trip_to_route.items():
        if route_id:
            route_to_trips.setdefault(route_id, []).append(trip_id)

    trip_map: Dict[str, list] = {}

    with z.open("stop_times.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            trip_id = (row.get("trip_id") or "").strip()
            stop_id = (row.get("stop_id") or "").strip()
            seq_s = (row.get("stop_sequence") or "").strip()
            if not trip_id or not stop_id or not seq_s:
                continue
            try:
                seq = int(seq_s)
            except ValueError:
                continue
            trip_map.setdefault(trip_id, []).append((seq, stop_id))

    for trip_id in trip_map:
        trip_map[trip_id].sort(key=lambda x: x[0])

    STOP_TIMES_CACHE[operator] = trip_map
    ROUTE_TO_TRIPS_CACHE[operator] = route_to_trips
    return trip_map, route_to_trips

def load_stop_times_with_times_for_operator(operator: str) -> Dict[str, list]:
    """
    trip_id -> [(stop_sequence:int, stop_id:str, dep_sec:int)]
    dep_sec från departure_time (fallback arrival_time).
    """
    if operator in STOP_TIMES_WITH_TIME_CACHE:
        return STOP_TIMES_WITH_TIME_CACHE[operator]

    if DEV_MODE:
        STOP_TIMES_WITH_TIME_CACHE[operator] = {}
        return STOP_TIMES_WITH_TIME_CACHE[operator]

    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    if "stop_times.txt" not in z.namelist():
        raise HTTPException(status_code=502, detail="stop_times.txt saknas i zip")

    trip_map: Dict[str, list] = {}

    with z.open("stop_times.txt") as f:
        reader = csv.DictReader(textio.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        for row in reader:
            trip_id = (row.get("trip_id") or "").strip()
            stop_id = (row.get("stop_id") or "").strip()
            seq_s = (row.get("stop_sequence") or "").strip()
            if not trip_id or not stop_id or not seq_s:
                continue
            try:
                seq = int(seq_s)
            except ValueError:
                continue

            dep = parse_hhmmss_to_seconds(row.get("departure_time") or "")
            if dep is None:
                dep = parse_hhmmss_to_seconds(row.get("arrival_time") or "")
            if dep is None:
                continue

            trip_map.setdefault(trip_id, []).append((seq, stop_id, dep))

    for trip_id in trip_map:
        trip_map[trip_id].sort(key=lambda x: x[0])

    STOP_TIMES_WITH_TIME_CACHE[operator] = trip_map
    return trip_map

def load_lines_by_stop(operator: str) -> Dict[str, list]:
    """
    Bygger cache: stop_id -> [line_short_name,...] för en operator.
    Byggs en gång och återanvänds.
    """
    if operator in STOP_TO_LINES_CACHE:
        return STOP_TO_LINES_CACHE[operator]

    if DEV_MODE:
        STOP_TO_LINES_CACHE[operator] = {}
        return STOP_TO_LINES_CACHE[operator]

    route_map = load_routes_for_operator(operator)      # route_id -> short_name
    trip_to_route = load_trips_for_operator(operator)   # trip_id -> route_id
    stop_times, _route_to_trips = load_stop_times_for_operator(operator)  # trip_id -> [(seq, stop_id)]
    trip_to_service = load_trip_services_for_operator(operator)
    active_services = get_active_service_ids_for_operator(operator)

    # stop_id -> set(lines)
    stop_to_lines: Dict[str, set] = {}

    for trip_id, seq_list in stop_times.items():
        service_id = trip_to_service.get(trip_id)
        if not service_id or service_id not in active_services:
            continue

        route_id = trip_to_route.get(trip_id)
        if not route_id:
            continue

        line_short = (route_map.get(route_id) or "").strip()
        if not line_short:
            continue

        for _seq, stop_id in seq_list:
            if not stop_id:
                continue
            stop_to_lines.setdefault(stop_id, set()).add(line_short)

    # frys till listor, sortera smart
    def sort_key(x: str):
        return (0, int(x)) if x.isdigit() else (1, x)

    out: Dict[str, list] = {}
    for stop_id, lines in stop_to_lines.items():
        out[stop_id] = sorted(lines, key=sort_key)

    STOP_TO_LINES_CACHE[operator] = out
    return out

def get_active_service_ids_for_operator(operator: str) -> Set[str]:
    today = today_yyyymmdd_stockholm()

    cached = ACTIVE_SERVICE_CACHE.get(operator)
    if cached and cached[0] == today:
        return cached[1]

    cal = load_calendar_for_operator(operator)
    cal_dates = load_calendar_dates_for_operator(operator)

    # weekday name for today
    wd = datetime.now(ZoneInfo("Europe/Stockholm")).date().weekday()
    weekday_key = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][wd]

    active: Set[str] = set()

    # 1) baseline from calendar.txt
    for service_id, row in cal.items():
        start = row.get("start_date") or ""
        end = row.get("end_date") or ""
        if start and today < start:
            continue
        if end and today > end:
            continue
        if row.get(weekday_key):
            active.add(service_id)

    # 2) exceptions from calendar_dates.txt
    for service_id, ex in cal_dates.items():
        if today in ex.get("remove", set()):
            active.discard(service_id)
        if today in ex.get("add", set()):
            active.add(service_id)

    ACTIVE_SERVICE_CACHE[operator] = (today, active)
    return active

def build_active_stop_line_times_index(operator: str) -> Dict[str, Dict[str, list]]:
    """
    stop_id -> { line_short -> [dep_sec,...] } för trips som är aktiva idag.
    Cache: byggs max 1 gång per dag och operator.
    """
    today = today_yyyymmdd_stockholm()

    if DEV_MODE:
        ACTIVE_STOP_LINE_TIMES_CACHE[operator] = (today, {})
        return {}

    cached = ACTIVE_STOP_LINE_TIMES_CACHE.get(operator)
    if cached and cached[0] == today:
        return cached[1]

    route_map = load_routes_for_operator(operator)            # route_id -> short
    trip_to_route = load_trips_for_operator(operator)         # trip_id -> route_id
    trip_to_service = load_trip_services_for_operator(operator)
    active_services = get_active_service_ids_for_operator(operator)
    stop_times_t = load_stop_times_with_times_for_operator(operator)

    index: Dict[str, Dict[str, list]] = {}

    for trip_id, seq_list in stop_times_t.items():
        service_id = trip_to_service.get(trip_id)
        if not service_id or service_id not in active_services:
            continue

        route_id = trip_to_route.get(trip_id)
        if not route_id:
            continue

        line_short = (route_map.get(route_id) or "").strip()
        if not line_short:
            continue

        for _seq, stop_id, dep_sec in seq_list:
            per_line = index.setdefault(stop_id, {})
            per_line.setdefault(line_short, []).append(dep_sec)

    # sortera tider för varje stop/linje
    for _stop_id, per_line in index.items():
        for _line_short, times in per_line.items():
            times.sort()

    ACTIVE_STOP_LINE_TIMES_CACHE[operator] = (today, index)
    return index

def pick_trip_id_for_line_near_now(operator: str, line: str, window_min: int = 180) -> str | None:
    
    if DEV_MODE:
        return None

    """
    Välj en trip för en linje (route_short_name) som:
    - är aktiv idag
    - har minst en stop_time inom tidsfönster runt nu
    Returnerar trip_id eller None.
    """
    route_map = load_routes_for_operator(operator)            # route_id -> short
    trip_to_route = load_trips_for_operator(operator)         # trip_id -> route_id
    trip_to_service = load_trip_services_for_operator(operator)
    active_services = get_active_service_ids_for_operator(operator)
    stop_times_t = load_stop_times_with_times_for_operator(operator)

    line_in = (line or "").strip().lower()
    if not line_in:
        return None

    # alla route_ids som matchar linjenumret (kan vara flera varianter)
    route_ids = {rid for rid, short in route_map.items() if (short or "").strip().lower() == line_in}
    if not route_ids:
        return None

    now_sec = now_seconds_stockholm()
    window_min = max(5, min(int(window_min), 12 * 60))
    window_sec = window_min * 60

    best_trip: str | None = None
    best_score: int | None = None

    for trip_id, route_id in trip_to_route.items():
        if route_id not in route_ids:
            continue

        service_id = trip_to_service.get(trip_id)
        if not service_id or service_id not in active_services:
            continue

        seq_list = stop_times_t.get(trip_id)
        if not seq_list:
            continue

        for _seq, _stop_id, dep_sec in seq_list:
            if not is_within_window(dep_sec, now_sec, window_sec):
                continue

            # score = minsta avstånd till nu (med wrap)
            diff = abs(dep_sec - now_sec)
            diff = min(diff, abs((dep_sec - 86400) - now_sec), abs((dep_sec + 86400) - now_sec))

            if best_score is None or diff < best_score:
                best_score = diff
                best_trip = trip_id

    return best_trip

