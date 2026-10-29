# Headless simulator

Runs the openScope engine in Node.js without a browser, faster than real time
and deterministically for a given seed. It is the base for the automated
controllers (bots) and for training them.

## Quick start

```sh
npm install --ignore-scripts
node tools/sim/demo.js lemd 30 1       # airport, minutes, seed
```

## Bots

```sh
node tools/sim/run-bot.js --bot A --airport lemd --minutes 60 --seed 1 [--wind 180/15] [--traffic 1.5] [--verbose]
```

Bot B (reinforcement learning) runs from Python; see
[documentation/bot-information.md](../../documentation/bot-information.md) and
[documentation/bot-training.md](../../documentation/bot-training.md).

## Bridge for Python

`server.js` exposes the simulator through a JSON-lines protocol on stdin/stdout
(one request per line, one response per line). See the header of `server.js`
for the list of methods.

```sh
node tools/sim/server.js --step-seconds 0.25 --tower USER
```

The Python client lives in `bots/python/openscope_sim`:

```python
from openscope_sim import SimulatorClient

with SimulatorClient() as sim:
    observation = sim.reset("lemd", seed=1)
    observation, results = sim.step(5.0, [("IBE3141", "fh 270 d 70")])

    # wind from 180 at 15 kt: LEMD switches to its south configuration
    observation = sim.reset("lemd", seed=1, wind=(180, 15))
```

Tests: `python -m unittest discover -s bots/python/tests`

## Notes

- Commands use the same syntax as the in-game command bar and go through the
  same `AircraftCommander`, so bots have exactly the abilities of a human.
- `--tower USER` (default) leaves taxi and takeoff clearances to the controller;
  `--tower SYSTEM` lets the game handle departures automatically.
- Observations use nautical miles, feet, knots and degrees; positions are
  relative to the airport reference point (x east, y north).
- Each physics step defaults to 0.25 s of simulated time.

## Observation

Besides the aircraft and the airport, every observation has:

- `realism`: regulatory profile and separation minima, runway configuration,
  runway occupancy, last takeoff per runway, violation counts and metrics
  (throughput, delays, track miles, fuel, CO2)
- `violations`: rules broken since the previous observation, with their tier
  (0 safety, 1 separation, 2 procedure, 3 efficiency), the aircraft involved
  and the regulatory reference
- `scoreEvents` and `radio`: scored events and radio messages since the
  previous observation

Each aircraft also reports its wake categories (`wakeCategory` in the airport's
scheme, `recatEu`, `wakeFaa`), its clearances, the remaining taxi time and the
minimum vectoring altitude at its position (airports with terrain data only).

The rules are described in [documentation/realism.md](../../documentation/realism.md).
