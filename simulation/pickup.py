"""Object detection, grasp, and storage state machine for the hand demo."""

from __future__ import annotations

import threading
import time
from typing import Any


OBJECT_SEED = [
    {"id": "OBJ-01", "color": "cyan", "label": "Bearing", "size": "S", "weight": 0.18, "x": 0.12, "y": 0.25},
    {"id": "OBJ-02", "color": "violet", "label": "Adapter", "size": "M", "weight": 0.42, "x": 0.31, "y": 0.5},
    {"id": "OBJ-03", "color": "amber", "label": "Gear", "size": "L", "weight": 0.71, "x": 0.55, "y": 0.32},
    {"id": "OBJ-04", "color": "green", "label": "Sensor", "size": "S", "weight": 0.24, "x": 0.63, "y": 0.62},
    {"id": "OBJ-05", "color": "rose", "label": "Coupler", "size": "M", "weight": 0.53, "x": 0.2, "y": 0.72},
    {"id": "OBJ-06", "color": "blue", "label": "Housing", "size": "L", "weight": 0.88, "x": 0.48, "y": 0.76},
]

OBJECT_COLORS = {"cyan", "violet", "amber", "green", "rose", "blue"}


class PickupSimulation:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.reset()

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self.objects = [dict(item, scale=1.0, detected=False, picked=False, stored=False) for item in OBJECT_SEED]
            self.current_index = 0
            self.phase = 0
            self.arm_x = OBJECT_SEED[0]["x"]
            self.running = False
            self.successful_pickups = 0
            self.failed_attempts = 0
            self.attempts = 0
            self._times: list[float] = []
            self._cycle_started = time.monotonic()
            self.log = [{"time": self._clock(), "message": "Simulation ready · six objects in queue", "kind": "info"}]
            return self.snapshot()

    def configure(self, values: dict[str, Any]) -> dict[str, Any]:
        """Apply paused-world edits made in the interactive pickup canvas."""
        with self._lock:
            if self.running:
                raise ValueError("Pause the simulation before editing the workspace")

            if "arm_x" in values:
                self.arm_x = self._clamp(values["arm_x"], 0.04, 0.98)

            if "objects" in values:
                submitted = values["objects"]
                if not isinstance(submitted, list) or not submitted or len(submitted) > 16:
                    raise ValueError("Keep between 1 and 16 objects in the workspace")

                previous = {item["id"]: item for item in self.objects}
                current_id = self.objects[self.current_index]["id"] if self.objects else None
                updated: list[dict[str, Any]] = []
                seen_ids: set[str] = set()
                for entry in submitted:
                    if not isinstance(entry, dict):
                        continue
                    object_id = str(entry.get("id", ""))[:16]
                    if not object_id or object_id in seen_ids:
                        continue
                    seen_ids.add(object_id)
                    old = previous.get(object_id, {})
                    size = entry.get("size") if entry.get("size") in {"S", "M", "L"} else "M"
                    color = entry.get("color") if entry.get("color") in OBJECT_COLORS else "violet"
                    updated.append({
                        "id": object_id,
                        "label": str(entry.get("label", "Part"))[:24],
                        "color": color,
                        "size": size,
                        "weight": self._clamp(entry.get("weight", 0.35), 0.08, 1.5),
                        "scale": self._clamp(entry.get("scale", 1.0), 0.65, 1.55),
                        "x": self._clamp(entry.get("x", 0.35), 0.05, 0.67),
                        "y": self._clamp(entry.get("y", 0.45), 0.12, 0.78),
                        "detected": bool(old.get("detected", False)),
                        "picked": bool(old.get("picked", False)),
                        "stored": bool(old.get("stored", False)),
                    })
                if not updated:
                    raise ValueError("The workspace must contain at least one object")
                self.objects = updated
                target_index = next((i for i, item in enumerate(updated) if item["id"] == current_id and not item["stored"]), None)
                self.current_index = target_index if target_index is not None else 0
                self._ensure_target()
                self._add_log(f"Workspace edited · {len(updated)} objects", "info")

            return self.snapshot()

    def start(self) -> dict[str, Any]:
        with self._lock:
            if not self.objects or all(item["stored"] for item in self.objects):
                return self.snapshot()
            self.running = True
            self._add_log("Autonomy enabled · scanning workspace", "info")
            return self.snapshot()

    def pause(self) -> dict[str, Any]:
        with self._lock:
            self.running = False
            self._add_log("Simulation paused", "info")
            return self.snapshot()

    def step(self) -> dict[str, Any]:
        with self._lock:
            if not self.running:
                return self.snapshot()
            self._ensure_target()
            if not self.running or not self.objects:
                return self.snapshot()
            obj = self.objects[self.current_index]
            if self.phase == 0:
                obj["detected"] = True
                self._add_log("Object detected · " + obj["id"] + " " + obj["label"], "cyan")
                self._cycle_started = time.monotonic()
                self.phase = 1
            elif self.phase == 1:
                delta = obj["x"] - self.arm_x
                if abs(delta) <= 0.035:
                    self.arm_x = obj["x"]
                    self._add_log("Hand aligned · grasp pose calibrated", "blue")
                    self.phase = 2
                else:
                    self.arm_x += max(-0.14, min(0.14, delta))
            elif self.phase == 2:
                self.attempts += 1
                if self.attempts % 9 == 5:
                    self.failed_attempts += 1
                    obj["detected"] = False
                    self._add_log("Pickup failed · grip adjusted for next attempt", "amber")
                    self.phase = 0
                    self._times.append(time.monotonic() - self._cycle_started)
                else:
                    obj["picked"] = True
                    self._add_log("Object picked · grip force " + str(round(obj["weight"] * 1.12, 2)) + " N", "green")
                    self.phase = 3
            else:
                bin_index = self.successful_pickups % 4
                bin_x = 0.748 + bin_index * 0.069
                delta = bin_x - self.arm_x
                if abs(delta) > 0.035:
                    self.arm_x += max(-0.14, min(0.14, delta))
                else:
                    self.arm_x = bin_x
                    obj["stored"] = True
                    obj["picked"] = False
                    self.successful_pickups += 1
                    self._times.append(time.monotonic() - self._cycle_started)
                    self._add_log("Stored successfully · bin " + str(bin_index + 1), "green")
                    self.phase = 0
                    self.current_index = (self.current_index + 1) % len(self.objects)
                    self._ensure_target()
            return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        average = sum(self._times) / len(self._times) if self._times else 0.0
        return {
            "objects": [dict(item) for item in self.objects],
            "current_id": self.objects[self.current_index]["id"],
            "phase": self.phase,
            "arm_x": round(self.arm_x, 3),
            "running": self.running,
            "successful_pickups": self.successful_pickups,
            "failed_attempts": self.failed_attempts,
            "average_completion_time": round(average, 1),
            "objects_stored": sum(1 for item in self.objects if item["stored"]),
            "log": list(self.log),
        }

    def _ensure_target(self) -> None:
        if not self.objects:
            self.running = False
            return
        for offset in range(len(self.objects)):
            index = (self.current_index + offset) % len(self.objects)
            if not self.objects[index]["stored"]:
                self.current_index = index
                return
        self._add_log(f"Queue complete · all {len(self.objects)} objects stored", "green")
        self.running = False

    @staticmethod
    def _clamp(value: Any, low: float, high: float) -> float:
        return round(max(low, min(high, float(value))), 3)

    def _add_log(self, message: str, kind: str) -> None:
        self.log.insert(0, {"time": self._clock(), "message": message, "kind": kind})
        del self.log[12:]

    @staticmethod
    def _clock() -> str:
        return time.strftime("%H:%M:%S")
