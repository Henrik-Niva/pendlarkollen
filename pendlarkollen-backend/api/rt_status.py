import time
from fastapi import APIRouter
from fastapi import HTTPException

from services.gtfs_static import load_routes_for_operator
from services.gtfs_rt import get_vehicles

router = APIRouter()

OPS = ["sl", "ul", "xt"]

_STATUS_CACHE = {"ts": 0.0, "data": None}
STATUS_TTL_SECONDS = 60.0


def _pick_candidate_lines(route_map: dict, limit: int = 3) -> list[str]:
    """
    Välj de mest frekventa line_short i route_map (route_id -> line_short).
    """
    freq: dict[str, int] = {}
    canonical: dict[str, str] = {}

    for short in route_map.values():
        s = (short or "").strip()
        if not s:
            continue
        k = s.lower()
        freq[k] = freq.get(k, 0) + 1
        # behåll original-casing från första gången vi ser linjen
        if k not in canonical:
            canonical[k] = s

    # sortera på frekvens (högst först)
    ordered = sorted(freq.items(), key=lambda kv: kv[1], reverse=True)

    out: list[str] = []
    for k, _count in ordered:
        out.append(canonical[k])
        if len(out) >= limit:
            break

    return out


def _check_operator(operator: str) -> dict:
    try:
        route_map = load_routes_for_operator(operator)
    except Exception as e:
        return {"ok": False, "reason": f"Kunde inte läsa statisk GTFS för {operator}.", "debug": {"error": str(e)}}

    candidates = _pick_candidate_lines(route_map, limit=3)
    if not candidates:
        return {"ok": False, "reason": f"Inga linjer hittades för {operator}.", "debug": {"candidates": []}}

    per_line = []
    any_ok = False

    for line in candidates:
        try:
            fc = get_vehicles(operator, line)
            feats = (fc or {}).get("features") or []
            cnt = len(feats)
            per_line.append({"line": line, "ok": True, "features": cnt})
            if cnt > 0:
                any_ok = True
        except HTTPException as he:
            per_line.append({"line": line, "ok": False, "http": he.status_code, "detail": he.detail})
        except Exception as e:
            per_line.append({"line": line, "ok": False, "error": str(e)})

    if any_ok:
        return {"ok": True, "reason": None, "debug": {"tested": per_line}}

    # Ingen linje gav fordon => störning/instabilt
    return {
        "ok": False,
        "reason": "Fordon för denna operatör kan ej visas.",
        "debug": {"tested": per_line},
    }


@router.get("/realtime/status")
def realtime_status():
    now = time.time()
    cached = _STATUS_CACHE["data"]
    ts = _STATUS_CACHE["ts"]

    if cached is not None and now - ts < STATUS_TTL_SECONDS:
        return cached

    out = {op: _check_operator(op) for op in OPS}

    _STATUS_CACHE["ts"] = now
    _STATUS_CACHE["data"] = out
    return out