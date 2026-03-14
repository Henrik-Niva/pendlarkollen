from fastapi import APIRouter

from services.config import validate_operator, DEV_MODE
from services.gtfs_static import (
    load_routes_for_operator,
    load_stops_for_operator,
    load_stop_times_for_operator,
    load_trip_shapes_for_operator,
    load_shapes_for_operator,
    pick_trip_id_for_line_near_now,
)

router = APIRouter()


@router.get("/route")
def route(operator: str, line: str):
    operator = validate_operator(operator)

    if DEV_MODE:
        return {"type": "FeatureCollection", "features": []}

    line_in = (line or "").strip().lower()

    route_map = load_routes_for_operator(operator)
    stops_map = load_stops_for_operator(operator)
    stop_times, route_to_trips = load_stop_times_for_operator(operator)

    # NYTT
    trip_to_shape = load_trip_shapes_for_operator(operator)
    shapes_map = load_shapes_for_operator(operator)

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

    # välj representativ trip nära nu, annars längsta stop-sekvens
    trip_id = pick_trip_id_for_line_near_now(operator, line, window_min=180)
    if not trip_id:
        trip_id = max(trips, key=lambda tid: len(stop_times.get(tid, [])))

    coords = []
    geometry_source = "stops"
    shape_id = ""

    # Försök först använda shapes.txt
    if trip_id:
        shape_id = (trip_to_shape.get(trip_id) or "").strip()
        if shape_id:
            shape_coords = shapes_map.get(shape_id) or []
            if len(shape_coords) >= 2:
                coords = shape_coords
                geometry_source = "shapes"

    # Fallback: bygg rak linje via hållplatser
    if len(coords) < 2:
        seq_list = stop_times.get(trip_id, [])
        for seq, stop_id in seq_list:
            s = stops_map.get(stop_id)
            if not s:
                continue
            coords.append([s["lon"], s["lat"]])

    if len(coords) < 2:
        return {"type": "FeatureCollection", "features": []}

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {
                    "operator": operator,
                    "line": line_in,
                    "route_id": route_id,
                    "trip_id": trip_id,
                    "shape_id": shape_id,
                    "geometry_source": geometry_source,
                },
            }
        ],
    }

@router.get("/routes")
def routes(operator: str):
    """
    Returnerar GeoJSON FeatureCollection för ALLA linjer (för browse-lines).
    Bygger genom att återanvända /route för varje linje.
    Varje feature får properties:
      - line: linjekortnamn (t.ex. "4")
      - operator: operator (t.ex. "sl")
    """
    operator = validate_operator(operator)

    if DEV_MODE:
        return {"type": "FeatureCollection", "features": []}

    route_map = load_routes_for_operator(operator)

    out_features = []

    # route_map: { route_id: short_name }
    for _rid, short in route_map.items():
        line = (short or "").strip()
        if not line:
            continue

        try:
            fc = route(operator=operator, line=line)
            feats = (fc or {}).get("features", []) or []
            for f in feats:
                if not isinstance(f, dict):
                    continue
                props = f.get("properties") or {}
                if not isinstance(props, dict):
                    props = {}
                props["line"] = line
                props["operator"] = operator
                f["properties"] = props
                out_features.append(f)
        except Exception:
            # skippar en trasig linje hellre än att hela endpointen failar
            continue

    return {"type": "FeatureCollection", "features": out_features}