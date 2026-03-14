from fastapi import APIRouter
from typing import Optional

from services.config import validate_operator
from services.gtfs_rt import get_vehicles

router = APIRouter()


@router.get("/vehicles")
def vehicles(operator: str, line: Optional[str] = None):
    operator = validate_operator(operator)
    return get_vehicles(operator, line)
