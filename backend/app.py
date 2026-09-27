"""FastAPI application and JSON API for the ROOBGEN dashboard."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from ai.training.hand import VerticalHandTrainer
from ai.training.navigation import NavigationTrainer
from simulation.navigation import PRESETS, NavigationWorld
from simulation.pickup import PickupSimulation


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

app = FastAPI(
    title="ROOBGEN Robotics AI Control Center",
    description="Training and simulation APIs for four interactive robotics demonstrations.",
    version="1.0.0",
)

navigation_trainer = NavigationTrainer()
navigation_world = NavigationWorld()
hand_trainer = VerticalHandTrainer()
pickup_simulation = PickupSimulation()


@app.on_event("startup")
def start_navigation_training() -> None:
    """Start the sample navigation policy so the dashboard has live metrics."""
    navigation_trainer.start()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "healthy", "model": "online", "simulations": 4}


@app.get("/api/training/status")
def training_status() -> dict[str, Any]:
    return navigation_trainer.status()


@app.post("/api/training/start")
def training_start() -> dict[str, Any]:
    return navigation_trainer.start()


@app.post("/api/training/pause")
def training_pause() -> dict[str, Any]:
    return navigation_trainer.pause()


@app.post("/api/training/reset")
def training_reset() -> dict[str, Any]:
    return navigation_trainer.reset()


@app.post("/api/training/config")
def training_config(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return navigation_trainer.configure(payload)


@app.get("/api/navigation")
def navigation_status() -> dict[str, Any]:
    return navigation_world.snapshot()


@app.post("/api/navigation/config")
def navigation_config(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return navigation_world.configure(payload)


@app.get("/api/navigation/presets")
def navigation_presets() -> dict[str, Any]:
    return {"presets": list(PRESETS)}


@app.post("/api/navigation/preset/{name}")
def navigation_preset(name: str) -> dict[str, Any]:
    try:
        return navigation_world.use_preset(name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/navigation/start")
def navigation_start() -> dict[str, Any]:
    return navigation_world.start()


@app.post("/api/navigation/pause")
def navigation_pause() -> dict[str, Any]:
    return navigation_world.pause()


@app.post("/api/navigation/reset")
def navigation_reset() -> dict[str, Any]:
    return navigation_world.reset()


@app.post("/api/navigation/step")
def navigation_step() -> dict[str, Any]:
    return navigation_world.step()


@app.get("/api/hand/training")
def hand_training_status() -> dict[str, Any]:
    return hand_trainer.snapshot()


@app.post("/api/hand/training/config")
def hand_training_config(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return hand_trainer.configure(payload)


@app.post("/api/hand/training/start")
def hand_training_start() -> dict[str, Any]:
    return hand_trainer.configure({"running": True})


@app.post("/api/hand/training/pause")
def hand_training_pause() -> dict[str, Any]:
    return hand_trainer.configure({"running": False})


@app.post("/api/hand/training/step")
def hand_training_step() -> dict[str, Any]:
    return hand_trainer.step()


@app.post("/api/hand/training/reset")
def hand_training_reset() -> dict[str, Any]:
    return hand_trainer.reset()


@app.get("/api/pickup")
def pickup_status() -> dict[str, Any]:
    return pickup_simulation.snapshot()


@app.post("/api/pickup/config")
def pickup_config(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        return pickup_simulation.configure(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/pickup/start")
def pickup_start() -> dict[str, Any]:
    return pickup_simulation.start()


@app.post("/api/pickup/pause")
def pickup_pause() -> dict[str, Any]:
    return pickup_simulation.pause()


@app.post("/api/pickup/step")
def pickup_step() -> dict[str, Any]:
    return pickup_simulation.step()


@app.post("/api/pickup/reset")
def pickup_reset() -> dict[str, Any]:
    return pickup_simulation.reset()


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
