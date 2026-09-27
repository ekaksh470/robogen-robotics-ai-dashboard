"""Object detection, grasp, and storage state machine for the hand demo."""

from __future__ import annotations

import threading
import time
from typing import Any


OBJECT_SEED = [
    {"id": "OBJ-01", "color": "cyan", "label": "Bearing", "size": "S", "weight": 0.18, "x": 0.15, "y": 0.25},
    {"id": "OBJ-02", "color": "violet", "label": "Adapter", "size": "M", "weight": 0.42, "x": 0.37, "y": 0.5},
    {"id": "OBJ-03", "color": "amber", "label": "Gear", "size": "L", "weight": 0.71, "x": 0.62, "y": 0.32},
    {"id": "OBJ-04", "color": "green", "label": "Sensor", "size": "S", "weight": 0.24, "x": 0.82, "y": 0.62},
    {"id": "OBJ-05", "color": "rose", "label": "Coupler", "size": "M", "weight": 0.53, "x": 0.26, "y": 0.72},
    {"id": "OBJ-06", "color": "blue", "label": "Housing", "size": "L", "weight": 0.88, "x": 0.7, "y": 0.76},
]


class PickupSimulation:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.reset()

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self.objects = [dict(item, detected=False, picked=False, stored=False) for item in OBJECT_SEED]
            self.current_index = 0
            self.phase = 0
            self.running = False
            self.successful_pickups = 0
            self.failed_attempts = 0
            self.attempts = 0
            self._times: list[float] = []
            self._cycle_started = time.monotonic()
            self.log = [{"time": self._clock(), "message": "Simulation ready · six objects in queue", "kind": "info"}]
            return self.snapshot()

    def start(self) -> dict[str, Any]:
        with self._lock:
            if all(item["stored"] for item in self.objects):
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
            obj = self.objects[self.current_index]
            if self.phase == 0:
                obj["detected"] = True
                self._add_log("Object detected · " + obj["id"] + " " + obj["label"], "cyan")
                self._cycle_started = time.monotonic()
                self.phase = 1
            elif self.phase == 1:
                self._add_log("Hand aligned · grasp pose calibrated", "blue")
                self.phase = 2
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
                obj["stored"] = True
                obj["picked"] = False
                self.successful_pickups += 1
                self._times.append(time.monotonic() - self._cycle_started)
                self._add_log("Stored successfully · bin " + str((self.successful_pickups - 1) % 4 + 1), "green")
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
            "running": self.running,
            "successful_pickups": self.successful_pickups,
            "failed_attempts": self.failed_attempts,
            "average_completion_time": round(average, 1),
            "objects_stored": sum(1 for item in self.objects if item["stored"]),
            "log": list(self.log),
        }

    def _ensure_target(self) -> None:
        for offset in range(len(self.objects)):
            index = (self.current_index + offset) % len(self.objects)
            if not self.objects[index]["stored"]:
                self.current_index = index
                return
        self._add_log("Queue complete · all six objects stored", "green")
        self.running = False

    def _add_log(self, message: str, kind: str) -> None:
        self.log.insert(0, {"time": self._clock(), "message": message, "kind": kind})
        del self.log[12:]

    @staticmethod
    def _clock() -> str:
        return time.strftime("%H:%M:%S")
