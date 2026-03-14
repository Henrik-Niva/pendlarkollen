import os
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()

# ===== DEV MODE =====
DEV_MODE = os.getenv("DEV_MODE", "0") == "1"

if DEV_MODE:
    print("⚠️  DEV_MODE aktivt – inga Trafiklab-anrop görs")

# ===== TRAFIKLAB KEYS =====
TRAFIKLAB_KEY_STATIC = os.getenv("TRAFIKLAB_KEY_STATIC")
TRAFIKLAB_KEY_RT = os.getenv("TRAFIKLAB_KEY_RT")

# Kräv bara nycklar om vi INTE är i DEV_MODE
if not DEV_MODE:
    if not TRAFIKLAB_KEY_STATIC:
        raise RuntimeError("Saknar TRAFIKLAB_KEY_STATIC i .env")
    if not TRAFIKLAB_KEY_RT:
        raise RuntimeError("Saknar TRAFIKLAB_KEY_RT i .env")

# ===== BAS-URL =====
BASE = "https://opendata.samtrafiken.se"

# ===== OPERATOR-VALIDERING =====
ALLOWED_OPERATORS = {"ul", "sl", "xt"}

def validate_operator(operator: str) -> str:
    op = (operator or "").strip().lower()
    if op not in ALLOWED_OPERATORS:
        raise HTTPException(status_code=400, detail=f"Ogiltig operator: {operator}")
    return op
