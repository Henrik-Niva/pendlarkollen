import sys
import os

# Lägg till backend-roten i PYTHONPATH så att imports fungerar
sys.path.append(
    os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
)

import csv
import io
import json
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Dict, Any

from dotenv import load_dotenv
from services.gtfs_static import get_gtfs_zip_bytes

load_dotenv()

DEFAULT_OPERATORS = ["ul", "sl", "xt"]
TIMEZONE = "Europe/Stockholm"


def get_output_dir() -> str:
    return os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "pendlarkollen-frontend",
            "public",
            "generated",
        )
    )


def read_csv_from_zip(z: zipfile.ZipFile, filename: str):
    if filename not in z.namelist():
        return []
    with z.open(filename) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace")))


def read_routes(z: zipfile.ZipFile) -> Dict[str, str]:
    rows = read_csv_from_zip(z, "routes.txt")
    route_to_line: Dict[str, str] = {}

    for row in rows:
        route_id = (row.get("route_id") or "").strip()
        line = (row.get("route_short_name") or "").strip()
        if route_id and line:
            route_to_line[route_id] = line

    return route_to_line


def read_trips(z: zipfile.ZipFile) -> Dict[str, Dict[str, Any]]:
    rows = read_csv_from_zip(z, "trips.txt")
    trips: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        trip_id = (row.get("trip_id") or "").strip()
        if not trip_id:
            continue

        route_id = (row.get("route_id") or "").strip()
        shape_id = (row.get("shape_id") or "").strip()
        service_id = (row.get("service_id") or "").strip()

        direction_raw = (row.get("direction_id") or "").strip()
        try:
            direction_id = int(direction_raw) if direction_raw != "" else None
        except ValueError:
            direction_id = None

        headsign = (row.get("trip_headsign") or "").strip()
        trip_short_name = (row.get("trip_short_name") or "").strip()
        internal_journey_number = (row.get("samtrafiken_internal_journey_number") or "").strip()

        trips[trip_id] = {
            "trip_id": trip_id,
            "route_id": route_id,
            "shape_id": shape_id,
            "service_id": service_id,
            "direction_id": direction_id,
            "headsign": headsign,
            "trip_short_name": trip_short_name,
            "samtrafiken_internal_journey_number": internal_journey_number,
        }

    return trips


def read_shapes(z: zipfile.ZipFile) -> Dict[str, list]:
    rows = read_csv_from_zip(z, "shapes.txt")
    raw = defaultdict(list)

    for row in rows:
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

        raw[shape_id].append((seq, [lon, lat]))

    shapes = {}
    for shape_id, pts in raw.items():
        pts.sort(key=lambda x: x[0])
        coords = [coord for _seq, coord in pts]
        if len(coords) >= 2:
            shapes[shape_id] = coords

    return shapes


def read_stop_times(z: zipfile.ZipFile) -> Dict[str, list]:
    rows = read_csv_from_zip(z, "stop_times.txt")
    stop_times = defaultdict(list)

    for row in rows:
        trip_id = (row.get("trip_id") or "").strip()
        stop_id = (row.get("stop_id") or "").strip()
        seq_s = (row.get("stop_sequence") or "").strip()

        if not trip_id or not stop_id or not seq_s:
            continue

        try:
            seq = int(seq_s)
        except ValueError:
            continue

        stop_times[trip_id].append((seq, stop_id))

    for trip_id in stop_times:
        stop_times[trip_id].sort(key=lambda x: x[0])

    return dict(stop_times)


def read_stops_minimal(z: zipfile.ZipFile) -> Dict[str, str]:
    """
    Minimal stop-map för att kunna sätta first_stop_name / last_stop_name
    utan att bära med full stop-data i route_variants.
    """
    rows = read_csv_from_zip(z, "stops.txt")
    stop_names: Dict[str, str] = {}

    for row in rows:
        stop_id = (row.get("stop_id") or "").strip()
        name = (row.get("stop_name") or "").strip()
        if stop_id:
            stop_names[stop_id] = name

    return stop_names


def read_services(z: zipfile.ZipFile) -> Dict[str, Dict[str, Any]]:
    services: Dict[str, Dict[str, Any]] = {}

    # calendar.txt
    calendar_rows = read_csv_from_zip(z, "calendar.txt")
    for row in calendar_rows:
        service_id = (row.get("service_id") or "").strip()
        if not service_id:
            continue

        services[service_id] = {
            "start_date": (row.get("start_date") or "").strip(),
            "end_date": (row.get("end_date") or "").strip(),
            "weekdays": {
                "monday": (row.get("monday") or "0").strip() == "1",
                "tuesday": (row.get("tuesday") or "0").strip() == "1",
                "wednesday": (row.get("wednesday") or "0").strip() == "1",
                "thursday": (row.get("thursday") or "0").strip() == "1",
                "friday": (row.get("friday") or "0").strip() == "1",
                "saturday": (row.get("saturday") or "0").strip() == "1",
                "sunday": (row.get("sunday") or "0").strip() == "1",
            },
            "added_dates": [],
            "removed_dates": [],
        }

    # calendar_dates.txt
    calendar_dates_rows = read_csv_from_zip(z, "calendar_dates.txt")
    for row in calendar_dates_rows:
        service_id = (row.get("service_id") or "").strip()
        date_s = (row.get("date") or "").strip()
        ex_s = (row.get("exception_type") or "").strip()

        if not service_id or not date_s or ex_s not in ("1", "2"):
            continue

        if service_id not in services:
            services[service_id] = {
                "start_date": "",
                "end_date": "",
                "weekdays": {
                    "monday": False,
                    "tuesday": False,
                    "wednesday": False,
                    "thursday": False,
                    "friday": False,
                    "saturday": False,
                    "sunday": False,
                },
                "added_dates": [],
                "removed_dates": [],
            }

        if ex_s == "1":
            services[service_id]["added_dates"].append(date_s)
        else:
            services[service_id]["removed_dates"].append(date_s)

    for service_id in services:
        services[service_id]["added_dates"].sort()
        services[service_id]["removed_dates"].sort()

    return services


def build_variant_id(operator: str, line: str, direction_id, shape_id: str) -> str:
    direction_part = "na" if direction_id is None else str(direction_id)
    return f"{operator}|{line}|{direction_part}|{shape_id}"


def pick_representative_trip(trip_ids: list[str], stop_times_by_trip: Dict[str, list]) -> str | None:
    if not trip_ids:
        return None

    best_trip_id = None
    best_len = -1

    for trip_id in trip_ids:
        seq = stop_times_by_trip.get(trip_id, [])
        if len(seq) > best_len:
            best_len = len(seq)
            best_trip_id = trip_id

    return best_trip_id

def build_stop_ids_for_trip(
    trip_id: str,
    stop_times_by_trip: Dict[str, list],
) -> list[str]:
    seq_list = stop_times_by_trip.get(trip_id, [])
    return [stop_id for _seq, stop_id in seq_list if stop_id]

def build_variants(
    operator: str,
    route_to_line: Dict[str, str],
    trips_by_id: Dict[str, Dict[str, Any]],
    shapes_by_id: Dict[str, list],
    stop_times_by_trip: Dict[str, list],
    stop_names_by_id: Dict[str, str],
) -> list:
    grouped = {}

    for trip_id, trip in trips_by_id.items():
        route_id = trip["route_id"]
        shape_id = trip["shape_id"]
        direction_id = trip["direction_id"]
        service_id = trip["service_id"]
        headsign = trip["headsign"]

        line = (route_to_line.get(route_id) or "").strip()
        if not line or not shape_id:
            continue

        if shape_id not in shapes_by_id:
            continue

        group_key = (line, direction_id, shape_id)

        if group_key not in grouped:
            grouped[group_key] = {
                "line": line,
                "route_id": route_id,
                "direction_id": direction_id,
                "shape_id": shape_id,
                "trip_count": 0,
                "service_ids": set(),
                "sample_trip_ids": [],
                "trip_ids": [],
                "headsign_counter": Counter(),
            }

        g = grouped[group_key]
        g["trip_count"] += 1

        if service_id:
            g["service_ids"].add(service_id)

        g["trip_ids"].append(trip_id)

        if len(g["sample_trip_ids"]) < 3:
            g["sample_trip_ids"].append(trip_id)

        if headsign:
            g["headsign_counter"][headsign] += 1

    variants = []

    def line_sort_key(line_name: str):
        return (0, int(line_name)) if line_name.isdigit() else (1, line_name)

    for (_line, _direction_id, _shape_id), g in sorted(
        grouped.items(),
        key=lambda item: (
            line_sort_key(item[1]["line"]),
            99 if item[1]["direction_id"] is None else item[1]["direction_id"],
            item[1]["shape_id"],
        ),
    ):
        representative_trip_id = pick_representative_trip(g["trip_ids"], stop_times_by_trip)
        if not representative_trip_id:
            continue

        seq_list = stop_times_by_trip.get(representative_trip_id, [])
        if len(seq_list) < 2:
            continue

        stop_ids = build_stop_ids_for_trip(representative_trip_id, stop_times_by_trip)
        if len(stop_ids) < 2:
            continue

        geometry_coords = shapes_by_id.get(g["shape_id"], [])
        if len(geometry_coords) < 2:
            continue

        first_stop_name = ""
        last_stop_name = ""

        if seq_list:
            first_stop_id = seq_list[0][1]
            last_stop_id = seq_list[-1][1]
            first_stop_name = stop_names_by_id.get(first_stop_id, "")
            last_stop_name = stop_names_by_id.get(last_stop_id, "")

        if g["headsign_counter"]:
            headsign = g["headsign_counter"].most_common(1)[0][0]
        else:
            headsign = last_stop_name

        variant = {
            "variant_id": build_variant_id(operator, g["line"], g["direction_id"], g["shape_id"]),
            "line": g["line"],
            "route_id": g["route_id"],
            "direction_id": g["direction_id"],
            "headsign": headsign,
            "first_stop_name": first_stop_name,
            "last_stop_name": last_stop_name,
            "shape_id": g["shape_id"],
            "trip_count": g["trip_count"],
            "service_ids": sorted(g["service_ids"]),
            "sample_trip_ids": g["sample_trip_ids"],
            "has_time_data": False,
            "stop_ids": stop_ids,
            "geometry": {
                "type": "LineString",
                "coordinates": geometry_coords,
            },
        }

        variants.append(variant)

    return variants

def write_output(operator: str, payload: dict, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{operator}_route_variants.json")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Skrev {path} ({len(payload.get('variants', []))} variants)")


def build_operator_payload(operator: str) -> dict:
    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    route_to_line = read_routes(z)
    trips_by_id = read_trips(z)
    shapes_by_id = read_shapes(z)
    stop_times_by_trip = read_stop_times(z)
    stop_names_by_id = read_stops_minimal(z)
    services = read_services(z)

    variants = build_variants(
        operator=operator,
        route_to_line=route_to_line,
        trips_by_id=trips_by_id,
        shapes_by_id=shapes_by_id,
        stop_times_by_trip=stop_times_by_trip,
        stop_names_by_id=stop_names_by_id,
    )

    return {
        "version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "operator": operator,
        "timezone": TIMEZONE,
        "services": services,
        "variants": variants,
    }


def main():
    output_dir = get_output_dir()
    operators = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_OPERATORS

    for operator in operators:
        print(f"Bygger route variants för {operator}...")
        payload = build_operator_payload(operator)
        write_output(operator, payload, output_dir)


if __name__ == "__main__":
    main()