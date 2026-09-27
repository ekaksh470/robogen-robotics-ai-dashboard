# ROBOGEN Robotics AI Training Dashboard

A robotics AI training and simulation dashboard for learning, exploring, and editing navigation and robotic manipulation tasks. It combines a Python reinforcement-learning model, FastAPI simulation services, and an interactive HTML, CSS, and JavaScript control interface.

## Start the dashboard

Python 3.10 or newer is recommended.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn backend.app:app --reload
```

The navigation Q-learning demo starts training when the API starts. Use the left navigation to switch between the four simulations.

On macOS or Linux, activate the environment with `source .venv/bin/activate` instead.

## Simulations

1. **AI Navigation Training** — a Python tabular Q-learning agent learns a route through a 16 × 9 grid. Live episode return, TD loss, exploration rate, rolling success rate, training progress, and a policy route are shown in the dashboard. Training can be paused, resumed, reset, and configured.
2. **Robot Navigation Playground** — edit a grid, drag the robot and goal, add obstacles, move or resize blocks, remove a selected obstacle with the toolbar or Delete key, change map dimensions, select a preset, and run or pause the A* path-following simulation.
3. **Robotic Hand Vertical Training** — adjust object height, hand speed, and difficulty while a simple alignment trainer updates its reward and successful-alignment history.
4. **Robotic Hand Pickup and Storage** — add, move, resize, and remove parts; reposition the hand; and run a simulated detect → align → pick → store sequence with varied objects, recovery events, action history, and pickup statistics.

The hand views are simulated demonstrations. They do not connect to physical robot hardware. The navigation learner is real Q-learning; object handling and vertical alignment use lightweight stateful simulation logic so a hardware or model integration can replace them later.

## Project layout

```text
ai/training/       Q-learning and vertical alignment trainer
backend/           FastAPI application and JSON endpoints
simulation/        Editable navigation world and pickup state machine
frontend/          Responsive HTML, CSS, and JavaScript dashboard
assets/            Optional static assets (the current UI draws its visuals)
```

## API overview

- `GET /api/health`
- `GET /api/training/status`; `POST /api/training/start`, `/pause`, `/reset`, `/config`
- `GET /api/navigation`; `POST /api/navigation/config`, `/start`, `/pause`, `/reset`, `/step`
- `POST /api/navigation/preset/{training-arena|corridor|open-lab}`
- `GET /api/hand/training`; `POST /api/hand/training/config`, `/start`, `/pause`, `/step`, `/reset`
- `GET /api/pickup`; `POST /api/pickup/start`, `/pause`, `/step`, `/reset`

The dashboard design is available at [ROBOGEN — Robotics Control Center](https://www.figma.com/design/vevG2WzzBMU9P233Y2dQBn).
