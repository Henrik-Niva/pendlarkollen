from fastapi import APIRouter

from services.config import validate_operator, DEV_MODE
from services.gtfs_static import (
    load_routes_for_operator,
    load_stops_for_operator,
    load_stop_times_for_operator,
    pick_trip_id_for_line_near_now,
)

router = APIRouter()


@router.get("/stops")
def stops(operator: str, line: str):
    operator = validate_operator(operator)

    if DEV_MODE:
        return {"type": "FeatureCollection", "features": []}

    line_in = (line or "").strip().lower()

    route_map = load_routes_for_operator(operator)
    stops_map = load_stops_for_operator(operator)
    stop_times, route_to_trips = load_stop_times_for_operator(operator)

    # hitta route_id
    route_id = ""
    for rid, short in route_map.items():
        if (short or "").strip().lower() == line_in:
            route_id = rid
            break

    if not route_id:
        return {"type": "FeatureCollection", "features": []}

    trips = route_to_trips.get(route_id, [])
    if not trips:
        return {"type": "FeatureCollection", "features": []}

    trip_id = pick_trip_id_for_line_near_now(operator, line, window_min=180)
    if not trip_id:
        trip_id = max(trips, key=lambda tid: len(stop_times.get(tid, [])))


    seq_list = stop_times.get(trip_id, [])
    features = []

    for seq, stop_id in seq_list:
        s = stops_map.get(stop_id)
        if not s:
            continue

        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [s["lon"], s["lat"]],
                },
                "properties": {
                    "stop_id": stop_id,
                    "name": s["name"],
                    "operator": operator,
                    "line": line_in,
                    "seq": seq,
                },
            }
        )

    return {"type": "FeatureCollection", "features": features}

@router.get("/stops/search")
def stops_search(operator: str, q: str):
    operator = validate_operator(operator)
    qn = (q or "").strip().lower()

    if len(qn) < 2:
        return []

    stops_map = load_stops_for_operator(operator)

    hits = []
    for s in stops_map.values():
        name = (s.get("name") or "").strip()
        if qn in name.lower():
            hits.append(
                {
                    "stop_id": s["stop_id"],
                    "name": name,
                    "lat": s["lat"],
                    "lon": s["lon"],
                }
            )

    return hits[:50]

@router.get("/stops/all")
def stops_all(operator: str):
    """
    Returnerar ALLA GTFS-stops för operatorn som GeoJSON.
    Viktigt: vi ser till att STATIONER (location_type=1, parent_station="") faktiskt finns,
    även om käll-GTFS saknar eller har fel location_type.
    """
    operator = validate_operator(operator)

    if DEV_MODE:
        return {"type": "FeatureCollection", "features": []}

    stops_map = load_stops_for_operator(operator)  # stop_id -> dict

    def norm_str(v) -> str:
        return ("" if v is None else str(v)).strip()

    def norm_int(v, default=0) -> int:
        s = norm_str(v)
        if s == "":
            return default
        try:
            return int(float(s))
        except Exception:
            return default

    # 1) Bygg barn-index: parent_station -> [child_stop_id,...]
    children_by_parent = {}
    for sid, s in stops_map.items():
        parent = norm_str(s.get("parent_station"))
        if parent:
            children_by_parent.setdefault(parent, []).append(sid)

    features = []

    # 2) Skapa features för alla stops (med normaliserade fält)
    #    + auto-promota till station om stop_id har barn
    for sid, s in stops_map.items():
        lat = s.get("lat")
        lon = s.get("lon")
        if lat is None or lon is None:
            # Hoppa över trasiga koordinater (annars kan kartan bli konstig)
            continue

        name = norm_str(s.get("name"))
        parent_station = norm_str(s.get("parent_station"))
        location_type = norm_int(s.get("location_type"), 0)
        platform_code = norm_str(s.get("platform_code"))

        # Om denna stop har barn → den är i praktiken en station,
        # även om location_type saknas eller är 0.
        if sid in children_by_parent:
            parent_station = ""        # stationer ska inte ha parent_station
            location_type = 1          # station

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "stop_id": sid,
                "name": name,
                "operator": operator,  # behåll som validate_operator returnerar
                "parent_station": parent_station,
                "location_type": location_type,
                "platform_code": platform_code,
            },
        })

    # 3) Syntetisera station-features om GTFS saknar station-noden helt,
    #    men barn refererar till parent_station-id.
    for parent_id, child_ids in children_by_parent.items():
        if parent_id in stops_map:
            continue  # finns redan (och promota-logiken ovan tar hand om den)

        # välj första barnets namn/koordinater som fallback
        first_child = stops_map.get(child_ids[0])
        if not first_child:
            continue
        lat = first_child.get("lat")
        lon = first_child.get("lon")
        if lat is None or lon is None:
            continue

        name = norm_str(first_child.get("name")) or parent_id

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "stop_id": parent_id,
                "name": name,
                "operator": operator,
                "parent_station": "",
                "location_type": 1,
                "platform_code": "",
                "synthetic": True,
            },
        })

    return {"type": "FeatureCollection", "features": features}


