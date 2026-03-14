import time
from typing import Optional, Dict

import requests
from fastapi import HTTPException
from google.transit import gtfs_realtime_pb2

from services.config import BASE, DEV_MODE, TRAFIKLAB_KEY_RT
from services.gtfs_static import load_routes_for_operator, load_trips_for_operator

RT_CACHE: Dict[str, tuple[float, dict]] = {}
RT_TTL_SECONDS = 2.0


def _norm_id(s: str) -> str:
    s = (s or "").strip()
    if ":" in s:
        return s.split(":")[-1].strip()
    return s


def get_vehicles(operator: str, line: Optional[str] = None) -> dict:
    if DEV_MODE:
        return {"type": "FeatureCollection", "features": []}

    line_in = (line or "").strip().lower()
    cache_key = f"{operator}:{line_in}"
    now = time.time()

    cached = RT_CACHE.get(cache_key)
    if cached and now - cached[0] < RT_TTL_SECONDS:
        return cached[1]

    route_map = load_routes_for_operator(operator)
    trip_to_route = load_trips_for_operator(operator)

    rt_url = f"{BASE}/gtfs-rt/{operator}/VehiclePositions.pb?key={TRAFIKLAB_KEY_RT}"
    r = requests.get(rt_url, timeout=20)

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GTFS-RT misslyckades: {r.status_code}")

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(r.content)

    # Guard 1: feed helt tom
    if operator == "ul" and len(feed.entity) == 0:
        raise HTTPException(
            status_code=503,
            detail="UL VehiclePositions verkar vara nere (tom GTFS-RT feed).",
        )

    # Guard 2: feed har entities men inga positioner alls
    if operator == "ul":
        has_any_position = False
        for e in feed.entity:
            if not e.HasField("vehicle"):
                continue
            if e.vehicle.HasField("position"):
                has_any_position = True
                break
        if not has_any_position:
            raise HTTPException(
                status_code=503,
                detail="UL VehiclePositions verkar vara nere (inga vehicle.position i GTFS-RT feed).",
            )

    features = []

    for entity in feed.entity:
        if not entity.HasField("vehicle"):
            continue

        v = entity.vehicle
        if not v.HasField("position"):
            continue

        lat = v.position.latitude
        lon = v.position.longitude

        trip_id = v.trip.trip_id if v.HasField("trip") else ""
        route_id = v.trip.route_id if v.HasField("trip") else ""

        if not route_id and trip_id:
            route_id = trip_to_route.get(trip_id, "")

        route_id_norm = _norm_id(route_id)
        line_short = route_map.get(route_id, "")
        if not line_short and route_id_norm and route_id_norm != route_id:
            line_short = route_map.get(route_id_norm, "")

        # line-filter
        if line_in:
            ls = (line_short or "").strip().lower()
            rid = (route_id or "").strip().lower()
            ridn = (route_id_norm or "").strip().lower()
            if not ((ls == line_in) or (rid == line_in) or (ridn == line_in)):
                continue

        vehicle_id = v.vehicle.id if v.HasField("vehicle") else entity.id

        # ✅ NYTT: bearing/speed från GTFS-RT om det finns
        bearing = None
        if v.position.HasField("bearing"):
            try:
                bearing = float(v.position.bearing)
            except Exception:
                bearing = None

        speed = None
        if v.position.HasField("speed"):
            try:
                speed = float(v.position.speed)
            except Exception:
                speed = None

        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": vehicle_id,
                    "operator": operator,
                    "route_id": route_id,
                    "trip_id": trip_id,
                    "line": line_short,
                    "bearing": bearing,  # ✅ NYTT
                    "speed": speed,      # (valfritt)
                },
            }
        )

    # Guard 3: UL svarar men ger inget för vald linje (typiskt “incident-läge”)
    if operator == "ul" and line_in and len(features) == 0:
        raise HTTPException(
            status_code=503,
            detail=f"UL realtidsdata saknas för linje {line}. VehiclePositions-feed verkar ligga nere.",
        )

    response = {"type": "FeatureCollection", "features": features}
    RT_CACHE[cache_key] = (time.time(), response)
    return response