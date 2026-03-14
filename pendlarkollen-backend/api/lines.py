from fastapi import APIRouter, HTTPException

from services.config import validate_operator
from services.gtfs_static import (
    load_routes_for_operator,
    load_stops_for_operator,
    load_lines_by_stop,
    build_active_stop_line_times_index,
    now_seconds_stockholm,
    is_within_window,
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

    # 2) Om tomt: samla linjer för alla "child stops" (plattformar) som har parent_station == sid
    if not lines_set:
        child_stop_ids = [
            s["stop_id"]
            for s in stops_map.values()
            if (s.get("parent_station") or "").strip() == sid
        ]
        for child_id in child_stop_ids:
            for l in stop_to_lines.get(child_id, []):
                lines_set.add(l)

    # smart sort
    def sort_key(x: str):
        return (0, int(x)) if x.isdigit() else (1, x)

    return [{"line": l} for l in sorted(lines_set, key=sort_key)]

@router.get("/lines/by-stop/active")
def lines_by_stop_active(operator: str, stop_id: str, window_min: int = 120):
    operator = validate_operator(operator)
    sid = (stop_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="stop_id krävs")

    if window_min < 5:
        window_min = 5
    if window_min > 12 * 60:
        window_min = 12 * 60

    stops_map = load_stops_for_operator(operator)
    if sid not in stops_map:
        raise HTTPException(status_code=404, detail="Hållplats finns inte")

    # stop_ids att kolla: själva + ev. plattformar (parent_station)
    stop_ids = [sid]
    child_stop_ids = [
        s["stop_id"]
        for s in stops_map.values()
        if (s.get("parent_station") or "").strip() == sid
    ]
    stop_ids.extend(child_stop_ids)

    index = build_active_stop_line_times_index(operator)

    # nu + fönster
    now_sec = now_seconds_stockholm()  # ligger i gtfs_static.py
    window_sec = window_min * 60

    lines_set = set()

    for stop_x in stop_ids:
        per_line = index.get(stop_x, {})
        for line_short, times in per_line.items():
            # om någon tid ligger inom fönstret → linjen är “aktiv här nu”
            if any(is_within_window(t, now_sec, window_sec) for t in times):
                lines_set.add(line_short)

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

    # Alla child-stops (lägen/plattformar)
    children = [
        s for s in stops_map.values()
        if (s.get("parent_station") or "").strip() == pid
    ]

    if not children:
        raise HTTPException(status_code=404, detail="Inga lägen hittades för parent_station")

    # stop_id -> { line_short -> [dep_sec,...] }
    index = build_active_stop_line_times_index(operator)

    out = []
    for s in children:
        stop_id = s["stop_id"]
        per_line = index.get(stop_id, {})
        lines = sorted([ln for ln in per_line.keys() if (ln or "").strip()])

        out.append({
            "stop_id": stop_id,
            "name": s.get("name", ""),
            "lat": s["lat"],
            "lon": s["lon"],
            "lines": [{"line": ln} for ln in lines],
        })

    # Sortera lägen så det blir stabilt i popup
    out.sort(key=lambda x: (x["name"] or "", x["stop_id"]))

    return out