"""Lightweight vertical alignment trainer for the robotic hand demo."""

from __future__ import annotations

import random
import threading
from collections import deque
from typing import Any


class VerticalHandTrainer:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._random = random.Random(17)
        self.reset()

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self.object_height = 0.68
            self.hand_y = 0.16
            self.speed = 0.055
            self.difficulty = "standard"
            self.running = False
            self.episodes = 0
            self.alignments = 0
            self.reward = 0.0
            self._rewards: deque[float] = deque(maxlen=60)
            self._random = random.Random(17)
            return self.snapshot()

    def configure(self, values: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if "object_height" in values:
                self.object_height = self._clamp(values["object_height"], 0.12, 0.9)
            if "speed" in values:
                self.speed = self._clamp(values["speed"], 0.015, 0.16)
            if "difficulty" in values and values["difficulty"] in {"easy", "standard", "hard"}:
                self.difficulty = values["difficulty"]
            if "running" in values:
                self.running = bool(values["running"])
            return self.snapshot()

    def step(self) -> dict[str, Any]:
        with self._lock:
            if not self.running:
                return self.snapshot()
            difficulty_noise = {"easy": 0.0, "standard": 0.004, "hard": 0.012}[self.difficulty]
            target = self.object_height + self._random.uniform(-difficulty_noise, difficulty_noise)
            delta = target - self.hand_y
            self.hand_y += max(-self.speed, min(self.speed, delta))
            error = abs(target - self.hand_y)
            self.reward = max(-1.0, round(1.0 - error * 2.6, 3))
            self._rewards.append(self.reward)
            self.episodes += 1
            if error <= 0.045:
                self.alignments += 1
                self.hand_y = max(0.08, min(0.94, self.object_height - 0.14))
            return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        recent = list(self._rewards)
        return {
            "object_height": round(self.object_height, 3),
            "hand_y": round(self.hand_y, 3),
            "speed": round(self.speed, 3),
            "difficulty": self.difficulty,
            "running": self.running,
            "episodes": self.episodes,
            "alignments": self.alignments,
            "reward": self.reward,
            "average_reward": round(sum(recent) / len(recent), 3) if recent else 0.0,
            "history": recent[-36:],
        }

    @staticmethod
    def _clamp(value: Any, low: float, high: float) -> float:
        return round(max(low, min(high, float(value))), 3)
