from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.lines import router as lines_router
from api.routes import router as routes_router
from api.stops import router as stops_router
from api.vehicles import router as vehicles_router
from api.rt_status import router as rt_status_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://pendlarkollen.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Koppla in routrarna (just nu tomma)
app.include_router(lines_router, prefix="/api")
app.include_router(routes_router, prefix="/api")
app.include_router(stops_router, prefix="/api")
app.include_router(vehicles_router, prefix="/api")
app.include_router(rt_status_router, prefix="/api")

@app.get("/health")
def health():
    return {"ok": True}
