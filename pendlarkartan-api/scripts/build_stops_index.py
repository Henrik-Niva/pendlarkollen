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
from collections import defaultdict
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
        service_id = (row.get("service_id") or "").strip()

        trips[trip_id] = {
            "trip_id": trip_id,
            "route_id": route_id,
            "service_id": service_id,
        }

    return trips


def read_stops(z: zipfile.ZipFile) -> Dict[str, Dict[str, Any]]:
    rows = read_csv_from_zip(z, "stops.txt")
    stops: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        stop_id = (row.get("stop_id") or "").strip()
        if not stop_id:
            continue

        name = (row.get("stop_name") or "").strip()
        parent_station = (row.get("parent_station") or "").strip()

        lat_s = (row.get("stop_lat") or "").strip()
        lon_s = (row.get("stop_lon") or "").strip()

        try:
            lat = float(lat_s)
            lon = float(lon_s)
        except ValueError:
            continue

        location_type_raw = (row.get("location_type") or "").strip()
        try:
            location_type = int(location_type_raw) if location_type_raw != "" else 0
        except ValueError:
            location_type = 0

        stops[stop_id] = {
            "stop_id": stop_id,
            "name": name,
            "lat": lat,
            "lon": lon,
            "parent_station": parent_station,
            "location_type": location_type,
        }

    return stops


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


def infer_parent_and_children(stops_by_id: Dict[str, Dict[str, Any]]):
    """
    Bygger två strukturer:
    - parents_by_id: riktiga/förmodade parent-stops
    - child_ids_by_parent: parent_stop_id -> [child_stop_id,...]

    Regler:
    1) Om stop har children via parent_station -> parent
    2) Om stop har location_type == 1 -> parent
    3) Ensamma stops utan parent/children behandlas också som parent i browse-läge
    """
    child_ids_by_parent = defaultdict(list)

    # 1) explicita child -> parent relationer
    for stop_id, stop in stops_by_id.items():
        parent_station = (stop.get("parent_station") or "").strip()
        if parent_station:
            child_ids_by_parent[parent_station].append(stop_id)

    parent_ids = set()

    # 2) location_type == 1 räknas som parent
    for stop_id, stop in stops_by_id.items():
        if stop.get("location_type") == 1:
            parent_ids.add(stop_id)

    # 3) alla som faktiskt har children räknas som parent
    for parent_id in child_ids_by_parent.keys():
        parent_ids.add(parent_id)

    # 4) ensamma stops utan parent ska också kunna visas i browse-stops
    for stop_id, stop in stops_by_id.items():
        parent_station = (stop.get("parent_station") or "").strip()
        if not parent_station and stop_id not in child_ids_by_parent:
            parent_ids.add(stop_id)

    parents_by_id = {}
    for parent_id in parent_ids:
        stop = stops_by_id.get(parent_id)
        if not stop:
            continue
        parents_by_id[parent_id] = stop

    # sortera childlistor stabilt
    for parent_id in child_ids_by_parent:
        child_ids_by_parent[parent_id].sort()

    return parents_by_id, dict(child_ids_by_parent)


def build_stop_line_links(
    route_to_line: Dict[str, str],
    trips_by_id: Dict[str, Dict[str, Any]],
    stop_times_by_trip: Dict[str, list],
):
    """
    Returnerar:
    - child_stop_to_lines: stop_id -> set(lines)
    """
    child_stop_to_lines = defaultdict(set)

    for trip_id, seq_list in stop_times_by_trip.items():
        trip = trips_by_id.get(trip_id)
        if not trip:
            continue

        route_id = trip.get("route_id") or ""
        line = (route_to_line.get(route_id) or "").strip()
        if not line:
            continue

        for _seq, stop_id in seq_list:
            if stop_id:
                child_stop_to_lines[stop_id].add(line)

    return child_stop_to_lines


def build_payload(operator: str) -> dict:
    zip_bytes = get_gtfs_zip_bytes(operator)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))

    route_to_line = read_routes(z)
    trips_by_id = read_trips(z)
    stops_by_id = read_stops(z)
    stop_times_by_trip = read_stop_times(z)

    parents_by_id, child_ids_by_parent = infer_parent_and_children(stops_by_id)
    child_stop_to_lines = build_stop_line_links(route_to_line, trips_by_id, stop_times_by_trip)

    # parents-lista
    parents = []

    # children-dict
    children = {}

    # line_index
    line_index = defaultdict(lambda: {
        "parent_stop_ids": set(),
        "child_stop_ids": set(),
    })

    # Bygg child-objekt först
    for stop_id, stop in stops_by_id.items():
        parent_station = (stop.get("parent_station") or "").strip()
        if not parent_station:
            continue

        lines = sorted(child_stop_to_lines.get(stop_id, set()), key=line_sort_key)

        children[stop_id] = {
            "stop_id": stop_id,
            "name": stop["name"],
            "lat": stop["lat"],
            "lon": stop["lon"],
            "parent_station": parent_station,
            "lines": lines,
        }

        for line in lines:
            line_index[line]["child_stop_ids"].add(stop_id)
            line_index[line]["parent_stop_ids"].add(parent_station)

    # Bygg parents
    for parent_id, stop in sorted(parents_by_id.items(), key=lambda item: ((item[1]["name"] or ""), item[0])):
        child_ids = child_ids_by_parent.get(parent_id, [])

        # Om parent har children: linjer = union av children
        # Om parent saknar children: använd parentens egna linjer
        if child_ids:
            parent_lines_set = set()
            for child_id in child_ids:
                for line in child_stop_to_lines.get(child_id, set()):
                    parent_lines_set.add(line)
        else:
            parent_lines_set = set(child_stop_to_lines.get(parent_id, set()))

        lines = sorted(parent_lines_set, key=line_sort_key)

        parents.append({
            "stop_id": parent_id,
            "name": stop["name"],
            "lat": stop["lat"],
            "lon": stop["lon"],
            "lines": lines,
            "children": child_ids,
        })

        for line in lines:
            line_index[line]["parent_stop_ids"].add(parent_id)

    # Om ensamt stop också ska finnas som child-liknande lookup för line_index behövs inte nu.
    # Vi håller detta enkelt i v1.

    # konvertera sets -> sorterade listor
    final_line_index = {}
    for line, data in sorted(line_index.items(), key=lambda item: line_sort_key(item[0])):
        final_line_index[line] = {
            "parent_stop_ids": sorted(data["parent_stop_ids"]),
            "child_stop_ids": sorted(data["child_stop_ids"]),
        }

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "operator": operator,
        "timezone": TIMEZONE,
        "parents": parents,
        "children": children,
        "line_index": final_line_index,
    }


def line_sort_key(line_name: str):
    return (0, int(line_name)) if line_name.isdigit() else (1, line_name)


def write_output(operator: str, payload: dict, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{operator}_stops_index.json")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Skrev {path} ({len(payload.get('parents', []))} parents, {len(payload.get('children', {}))} children)")


def main():
    output_dir = get_output_dir()
    operators = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_OPERATORS

    for operator in operators:
        print(f"Bygger stops index för {operator}...")
        payload = build_payload(operator)
        write_output(operator, payload, output_dir)


if __name__ == "__main__":
    main()