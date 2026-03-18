from fastapi import APIRouter, HTTPException

from services.config import validate_operator
from services.gtfs_static import (
    load_routes_for_operator,
    load_stops_for_operator,
    load_lines_by_stop,
    get_active_lines_for_stop_ids,
)

router = APIRouter()


@router.get("/lines")
def lines(operator: str):
    """
    Returnerar en lista med linjer (route_short_name) för en operator.
    """
    operator = validate_operator(operator)
    route_map = load_routes_for_operator(operator)

    line_set = {(v or "").strip() for v in route_map.values()}
    line_set = {x for x in line_set if x}

    def sort_key(x: str):
        return (0, int(x)) if x.isdigit() else (1, x)

    return [{"line": l} for l in sorted(line_set, key=sort_key)]


@router.get("/lines/by-stop")
def lines_by_stop(operator: str, stop_id: str):
    operator = validate_operator(operator)
    sid = (stop_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="stop_id krävs")

    stops_map = load_stops_for_operator(operator)
    if sid not in stops_map:
        raise HTTPException(status_code=404, detail="Hållplats finns inte")

    stop_to_lines = load_lines_by_stop(operator)

    # 1) Försök direkt på stop_id
    lines_set = set(stop_to_lines.get(sid, []))

    # 2) Om tomt: samla linjer för alla child-stops som har parent_station == sid
    if not lines_set:
        child_stop_ids = [
            s["stop_id"]
            for s in stops_map.values()
            if (s.get("parent_station") or "").strip() == sid
        ]
        for child_id in child_stop_ids:
            for l in stop_to_lines.get(child_id, []):
                lines_set.add(l)

    def sort_key(x: str):
        return (0, int(x)) if x.isdigit() else (1, x)

    return [{"line": l} for l in sorted(lines_set, key=sort_key)]


@router.get("/lines/by-stop/active")
def lines_by_stop_active(operator: str, stop_id: str, window_min: int = 120):
    operator = validate_operator(operator)
    sid = (stop_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="stop_id krävs")

    stops_map = load_stops_for_operator(operator)
    if sid not in stops_map:
        raise HTTPException(status_code=404, detail="Hållplats finns inte")

    stop_ids = [sid]
    child_stop_ids = [
        s["stop_id"]
        for s in stops_map.values()
        if (s.get("parent_station") or "").strip() == sid
    ]
    stop_ids.extend(child_stop_ids)

    lines_set = get_active_lines_for_stop_ids(operator, stop_ids, window_min=window_min)

    def sort_key(x: str):
        return (0, int(x)) if x.isdigit() else (1, x)

    return [{"line": l} for l in sorted(lines_set, key=sort_key)]


@router.get("/lines/by-parent-station/active")
def lines_by_parent_station_active(operator: str, parent_station: str, window_min: int = 120):
    """
    Returnerar alla lägen/plattformar under parent_station, med linjer som är aktiva nära nu.
    """
    operator = validate_operator(operator)
    pid = (parent_station or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="parent_station krävs")

    stops_map = load_stops_for_operator(operator)

    children = [
        s for s in stops_map.values()
        if (s.get("parent_station") or "").strip() == pid
    ]

    if not children:
        raise HTTPException(status_code=404, detail="Inga lägen hittades för parent_station")

    out = []
    for s in children:
        stop_id = s["stop_id"]
        lines_set = get_active_lines_for_stop_ids(operator, [stop_id], window_min=window_min)
        lines = sorted([ln for ln in lines_set if (ln or "").strip()])

        out.append({
            "stop_id": stop_id,
            "name": s.get("name", ""),
            "lat": s["lat"],
            "lon": s["lon"],
            "lines": [{"line": ln} for ln in lines],
        })

    out.sort(key=lambda x: (x["name"] or "", x["stop_id"]))
    return out