"""Editable grid world with A* route planning and safe robot stepping."""

from __future__ import annotations

import threading
from typing import Any

from ai.training.navigation import ACTIONS, OBSTACLES, START, GOAL, occupied_cells


PRESETS = {
    "training-arena": {
        "cols": 16,
        "rows": 9,
        "robot": {"x": 0, "y": 6},
        "goal": {"x": 15, "y": 2},
        "obstacles": OBSTACLES,
    },
    "corridor": {
        "cols": 18,
        "rows": 10,
        "robot": {"x": 1, "y": 8},
        "goal": {"x": 16, "y": 1},
        "obstacles": [
            {"x": 4, "y": 0, "w": 1, "h": 7},
            {"x": 8, "y": 3, "w": 1, "h": 7},
            {"x": 12, "y": 0, "w": 1, "h": 7},
        ],
    },
    "open-lab": {
        "cols": 14,
        "rows": 10,
        "robot": {"x": 1, "y": 8},
        "goal": {"x": 12, "y": 1},
        "obstacles": [
            {"x": 4, "y": 6, "w": 2, "h": 3},
            {"x": 7, "y": 2, "w": 3, "h": 2},
            {"x": 11, "y": 5, "w": 1, "h": 3},
        ],
    },
}


class NavigationWorld:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.reset()

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self.cols, self.rows = 16, 9
            self.robot = {"x": START[0], "y": START[1]}
            self.goal = {"x": GOAL[0], "y": GOAL[1]}
            self.obstacles = [dict(item) for item in OBSTACLES]
            self.running = False
            self.collision = False
            self.decisions: list[str] = ["Route planned around five obstacles"]
            self._preset = "training-arena"
            return self.snapshot()

    def configure(self, values: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.cols = max(8, min(28, int(values.get("cols", self.cols))))
            self.rows = max(7, min(18, int(values.get("rows", self.rows))))
            self.obstacles = self._sanitize_obstacles(values.get("obstacles", self.obstacles))
            self.robot = self._sanitize_point(values.get("robot", self.robot))
            self.goal = self._sanitize_point(values.get("goal", self.goal))
            self._preset = str(values.get("preset", "custom"))
            self.collision = False
            self._log("Environment updated · route recalculated")
            return self.snapshot()

    def use_preset(self, name: str) -> dict[str, Any]:
        if name not in PRESETS:
            raise ValueError("Unknown environment preset")
        with self._lock:
            preset = PRESETS[name]
            self.cols, self.rows = preset["cols"], preset["rows"]
            self.robot = dict(preset["robot"])
            self.goal = dict(preset["goal"])
            self.obstacles = [dict(item) for item in preset["obstacles"]]
            self._preset = name
            self.running = False
            self.collision = False
            self._log("Loaded " + name.replace("-", " ") + " preset")
            return self.snapshot()

    def start(self) -> dict[str, Any]:
        with self._lock:
            self.running = True
            self.collision = False
            self._log("Navigation started · following A* path")
            return self.snapshot()

    def pause(self) -> dict[str, Any]:
        with self._lock:
            self.running = False
            self._log("Simulation paused")
            return self.snapshot()

    def step(self) -> dict[str, Any]:
        with self._lock:
            if self.running:
                path = self._path()
                if len(path) > 1:
                    self.robot = dict(path[1])
                    self.collision = False
                    self._log("Move " + self._direction(path[0], path[1]) + " · clear cell")
                elif self.robot == self.goal:
                    self.running = False
                    self._log("Destination reached · episode complete")
                else:
                    self.running = False
                    self.collision = True
                    self._log("Collision risk · no clear path")
            return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        cells = occupied_cells(self.obstacles)
        path = self._path(cells)
        return {
            "cols": self.cols,
            "rows": self.rows,
            "robot": dict(self.robot),
            "goal": dict(self.goal),
            "obstacles": [dict(item) for item in self.obstacles],
            "path": path,
            "running": self.running,
            "collision": self.collision,
            "preset": self._preset,
            "decisions": list(self.decisions),
            "distance": max(0, len(path) - 1),
            "at_goal": self.robot == self.goal,
        }

    def _path(self, blocked: set[tuple[int, int]] | None = None) -> list[dict[str, int]]:
        blocked = occupied_cells(self.obstacles) if blocked is None else blocked
        start = (self.robot["x"], self.robot["y"])
        goal = (self.goal["x"], self.goal["y"])
        queue = [start]
        came_from: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
        cost = {start: 0}
        while queue:
            current = queue.pop(0)
            if current == goal:
                break
            for dx, dy in ACTIONS:
                nxt = current[0] + dx, current[1] + dy
                if not (0 <= nxt[0] < self.cols and 0 <= nxt[1] < self.rows) or nxt in blocked:
                    continue
                next_cost = cost[current] + 1
                if nxt not in cost or next_cost < cost[nxt]:
                    cost[nxt] = next_cost
                    came_from[nxt] = current
                    queue.append(nxt)
            queue.sort(key=lambda point: cost[point] + abs(point[0] - goal[0]) + abs(point[1] - goal[1]))
        if goal not in came_from:
            return []
        route, cursor = [], goal
        while cursor is not None:
            route.append({"x": cursor[0], "y": cursor[1]})
            cursor = came_from[cursor]
        return list(reversed(route))

    def _sanitize_point(self, point: dict[str, Any]) -> dict[str, int]:
        return {
            "x": max(0, min(self.cols - 1, int(point.get("x", 0)))),
            "y": max(0, min(self.rows - 1, int(point.get("y", 0)))),
        }

    def _sanitize_obstacles(self, obstacles: list[dict[str, Any]]) -> list[dict[str, int]]:
        clean = []
        for item in obstacles[:100]:
            x = max(0, min(self.cols - 1, int(item.get("x", 0))))
            y = max(0, min(self.rows - 1, int(item.get("y", 0))))
            w = max(1, min(self.cols - x, int(item.get("w", 1))))
            h = max(1, min(self.rows - y, int(item.get("h", 1))))
            clean.append({"x": x, "y": y, "w": w, "h": h})
        return clean

    def _log(self, message: str) -> None:
        self.decisions.insert(0, message)
        del self.decisions[8:]

    @staticmethod
    def _direction(start: dict[str, int], end: dict[str, int]) -> str:
        if end["x"] > start["x"]:
            return "east"
        if end["x"] < start["x"]:
            return "west"
        return "south" if end["y"] > start["y"] else "north"
