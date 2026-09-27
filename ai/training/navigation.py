"""A small tabular Q-learning agent for grid-world navigation.

The trainer is intentionally dependency-light. Its state and metrics are
returned as plain JSON-friendly data, so a future Gym/PyTorch trainer can
replace this implementation without changing the dashboard contract.
"""

from __future__ import annotations

import random
import threading
import time
from collections import defaultdict, deque
from typing import Any


COLS = 16
ROWS = 9
OBSTACLES = [
    {"x": 4, "y": 1, "w": 2, "h": 2},
    {"x": 8, "y": 4, "w": 2, "h": 3},
    {"x": 12, "y": 0, "w": 1, "h": 2},
    {"x": 1, "y": 2, "w": 1, "h": 2},
    {"x": 11, "y": 6, "w": 3, "h": 1},
]
START = (0, 6)
GOAL = (15, 2)
ACTIONS = ((0, -1), (1, 0), (0, 1), (-1, 0))


def occupied_cells(obstacles: list[dict[str, int]]) -> set[tuple[int, int]]:
    return {
        (x, y)
        for item in obstacles
        for x in range(item["x"], item["x"] + item["w"])
        for y in range(item["y"], item["y"] + item["h"])
    }


class NavigationTrainer:
    """Thread-safe Q-learning trainer with start, pause, reset and status APIs."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._run = threading.Event()
        self._worker: threading.Thread | None = None
        self._q: defaultdict[tuple[int, int], list[float]] = defaultdict(lambda: [0.0] * 4)
        self._history: deque[dict[str, float | int]] = deque(maxlen=120)
        self._successes: deque[int] = deque(maxlen=100)
        self._episode = 0
        self._total_episodes = 3000
        self._epsilon = 0.72
        self._reward = 0.0
        self._loss = 0.0
        self._state = "ready"
        self._seed = 42
        self._random = random.Random(self._seed)
        self._blocked = occupied_cells(OBSTACLES)

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._episode >= self._total_episodes:
                return self._snapshot()
            self._state = "running"
            self._run.set()
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._train, name="q-navigation-trainer", daemon=True)
                self._worker.start()
            return self._snapshot()

    def pause(self) -> dict[str, Any]:
        self._run.clear()
        with self._lock:
            if self._state == "running":
                self._state = "paused"
            return self._snapshot()

    def reset(self) -> dict[str, Any]:
        self._run.clear()
        with self._lock:
            self._q = defaultdict(lambda: [0.0] * 4)
            self._history.clear()
            self._successes.clear()
            self._episode = 0
            self._epsilon = 0.72
            self._reward = 0.0
            self._loss = 0.0
            self._random = random.Random(self._seed)
            self._state = "ready"
            return self._snapshot()

    def configure(self, values: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if "total_episodes" in values:
                self._total_episodes = max(100, min(20_000, int(values["total_episodes"])))
            if "epsilon" in values:
                self._epsilon = max(0.05, min(0.9, float(values["epsilon"])))
            return self._snapshot()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return self._snapshot()

    def _train(self) -> None:
        alpha, gamma = 0.16, 0.96
        while True:
            if not self._run.wait(timeout=0.5):
                continue
            with self._lock:
                if self._episode >= self._total_episodes:
                    self._state = "complete"
                    self._run.clear()
                    break
                epsilon = self._epsilon
            state = START
            total_reward = 0.0
            squared_errors = 0.0
            steps = 0
            reached_goal = False

            while steps < 150:
                if not self._run.is_set():
                    break
                if self._random.random() < epsilon:
                    action = self._random.randrange(4)
                else:
                    action = max(range(4), key=lambda index: self._q[state][index])
                dx, dy = ACTIONS[action]
                next_state = (state[0] + dx, state[1] + dy)
                reward = -0.035
                if not (0 <= next_state[0] < COLS and 0 <= next_state[1] < ROWS):
                    next_state, reward = state, -0.35
                elif next_state in self._blocked:
                    next_state, reward = state, -0.45
                elif next_state == GOAL:
                    reward = 10.0
                    reached_goal = True

                old_value = self._q[state][action]
                future = 0.0 if reached_goal else max(self._q[next_state])
                td_error = reward + gamma * future - old_value
                self._q[state][action] = old_value + alpha * td_error
                squared_errors += td_error * td_error
                total_reward += reward
                state = next_state
                steps += 1
                if reached_goal:
                    break

            if not self._run.is_set():
                continue

            with self._lock:
                self._episode += 1
                self._reward = round(total_reward, 3)
                self._loss = round(squared_errors / max(steps, 1), 5)
                self._successes.append(1 if reached_goal else 0)
                self._epsilon = max(0.055, self._epsilon * 0.999)
                self._history.append({"episode": self._episode, "reward": self._reward, "loss": self._loss})
                if self._episode >= self._total_episodes:
                    self._state = "complete"
                    self._run.clear()
            time.sleep(0.035)

    def _policy_route(self) -> list[dict[str, int]]:
        """Follow the learned policy; use an A* hint until it has a useful route."""
        state = START
        route = [state]
        seen = {state}
        for _ in range(COLS * ROWS):
            action = max(range(4), key=lambda index: self._q[state][index])
            dx, dy = ACTIONS[action]
            nxt = (state[0] + dx, state[1] + dy)
            if not (0 <= nxt[0] < COLS and 0 <= nxt[1] < ROWS) or nxt in self._blocked or nxt in seen:
                break
            route.append(nxt)
            if nxt == GOAL:
                return [{"x": x, "y": y} for x, y in route]
            seen.add(nxt)
            state = nxt
        return [{"x": x, "y": y} for x, y in _astar(START, GOAL, COLS, ROWS, self._blocked)]

    def _snapshot(self) -> dict[str, Any]:
        success_rate = (sum(self._successes) / len(self._successes) * 100) if self._successes else 0.0
        recent_rewards = [float(item["reward"]) for item in list(self._history)[-100:]]
        return {
            "episode": self._episode,
            "total_episodes": self._total_episodes,
            "reward": self._reward,
            "average_reward": round(sum(recent_rewards) / len(recent_rewards), 2) if recent_rewards else 0.0,
            "loss": self._loss,
            "epsilon": round(self._epsilon, 3),
            "success_rate": round(success_rate, 1),
            "progress": round(min(100, self._episode / self._total_episodes * 100), 1),
            "state": self._state,
            "running": self._state == "running",
            "history": list(self._history),
            "map": {
                "cols": COLS,
                "rows": ROWS,
                "start": {"x": START[0], "y": START[1]},
                "goal": {"x": GOAL[0], "y": GOAL[1]},
                "obstacles": OBSTACLES,
                "path": self._policy_route(),
            },
        }


def _astar(start: tuple[int, int], goal: tuple[int, int], cols: int, rows: int, blocked: set[tuple[int, int]]) -> list[tuple[int, int]]:
    frontier = [start]
    came_from: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
    cost = {start: 0}
    while frontier:
        current = frontier.pop(0)
        if current == goal:
            break
        for dx, dy in ACTIONS:
            nxt = current[0] + dx, current[1] + dy
            if not (0 <= nxt[0] < cols and 0 <= nxt[1] < rows) or nxt in blocked:
                continue
            new_cost = cost[current] + 1
            if nxt not in cost or new_cost < cost[nxt]:
                cost[nxt] = new_cost
                came_from[nxt] = current
                frontier.append(nxt)
        frontier.sort(key=lambda point: cost[point] + abs(point[0] - goal[0]) + abs(point[1] - goal[1]))
    if goal not in came_from:
        return [start]
    route, cursor = [], goal
    while cursor is not None:
        route.append(cursor)
        cursor = came_from[cursor]
    return list(reversed(route))
