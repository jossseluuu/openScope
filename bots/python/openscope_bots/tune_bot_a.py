"""Phase 4: tune Bot A's parameters with CMA-ES.

Every candidate set of parameters flies the same episodes (airports x seeds);
its cost is the mean lexicographic cost of those episodes (see fitness.py).

Example (from bots/python):
    .venv\\Scripts\\python -m openscope_bots.tune_bot_a --airports lemd eddm --seeds 1 2 --minutes 45 \\
        --generations 40 --workers 8 --out ../params/botA_tuned.json
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from openscope_sim import SimulatorClient

from .cmaes import CMAES
from .fitness import mean_cost, score_summary
from .workers import SimulatorPool

ROOT = Path(__file__).resolve().parents[3]


def tunable_space(space: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Parameters with a range to explore."""
    return {name: spec for name, spec in space.items() if spec["max"] > spec["min"]}


def to_unit(space: dict[str, dict[str, Any]], parameters: dict[str, float]) -> np.ndarray:
    return np.array([(parameters[n] - s["min"]) / (s["max"] - s["min"]) for n, s in space.items()])


def from_unit(space: dict[str, dict[str, Any]], vector: np.ndarray) -> dict[str, float]:
    parameters = {}
    for value, (name, spec) in zip(vector, space.items()):
        real = spec["min"] + float(np.clip(value, 0, 1)) * (spec["max"] - spec["min"])
        parameters[name] = int(round(real)) if spec.get("integer") else round(real, 3)
    return parameters


def evaluate(
    pool: SimulatorPool, parameter_sets: list[dict[str, float]], episodes: list[dict[str, Any]]
) -> list[float]:
    """Mean cost of each parameter set. All (set, episode) runs share the pool at once,
    so no worker idles while a set waits for its slowest episode."""

    def run(client: SimulatorClient, job: tuple[int, dict[str, Any]]) -> Any:
        index, episode = job
        result = client.run_bot_episode(bot="A", parameters=parameter_sets[index], **episode)
        return score_summary(result["summary"])

    jobs = [(index, episode) for index in range(len(parameter_sets)) for episode in episodes]
    scores = pool.map(run, jobs)
    count = len(episodes)
    return [mean_cost(scores[i * count:(i + 1) * count]) for i in range(len(parameter_sets))]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--airports", nargs="+", default=["lemd", "eddm"])
    parser.add_argument("--seeds", nargs="+", type=int, default=[1, 2])
    parser.add_argument("--minutes", type=float, default=45)
    parser.add_argument("--traffic", type=float, default=1.0, help="traffic scale")
    parser.add_argument("--generations", type=int, default=40)
    parser.add_argument("--population", type=int, default=0, help="0: CMA-ES default")
    parser.add_argument("--sigma", type=float, default=0.2)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--start", type=Path, help="parameters JSON to start from (default: Bot A defaults)")
    parser.add_argument("--out", type=Path, default=ROOT / "bots" / "params" / "botA_tuned.json")
    args = parser.parse_args()

    episodes = [
        {"airport": airport, "seed": seed, "minutes": args.minutes, "traffic_scale": args.traffic}
        for airport in args.airports
        for seed in args.seeds
    ]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    log_path = args.out.with_suffix(".csv")

    with SimulatorPool(args.workers) as pool:
        full_space = pool.map(lambda client, _: client.bot_parameter_space(), [0])[0]
        space = tunable_space(full_space)
        defaults = {name: spec["value"] for name, spec in full_space.items()}
        start = dict(defaults)
        if args.start:
            start.update(json.loads(args.start.read_text())["parameters"])

        [baseline_cost] = evaluate(pool, [start], episodes)
        print(f"start: cost {baseline_cost:.1f} over {len(episodes)} episodes")

        es = CMAES(to_unit(space, start), sigma=args.sigma, population_size=args.population or None, seed=args.seed)
        best = {"cost": baseline_cost, "parameters": start}

        with open(log_path, "w", newline="") as log_file:
            writer = csv.writer(log_file)
            writer.writerow(["generation", "best_cost", "generation_best", "generation_mean", "sigma", "seconds"])

            for generation in range(args.generations):
                started = time.time()
                candidates = [{**defaults, **from_unit(space, vector)} for vector in es.ask()]
                print(
                    f"generation {generation + 1}/{args.generations}: "
                    f"{len(candidates)} candidates x {len(episodes)} episodes...",
                    flush=True,
                )
                costs = evaluate(pool, candidates, episodes)
                for parameters, cost in zip(candidates, costs):
                    if cost < best["cost"]:
                        best = {"cost": cost, "parameters": parameters}
                        args.out.write_text(json.dumps({
                            "bot": "A",
                            "cost": cost,
                            "baselineCost": baseline_cost,
                            "episodes": episodes,
                            "parameters": parameters,
                        }, indent=2))
                es.tell(np.array(costs))
                elapsed = time.time() - started
                writer.writerow([generation, best["cost"], min(costs), float(np.mean(costs)), es.sigma, round(elapsed)])
                log_file.flush()
                print(
                    f"generation {generation + 1}/{args.generations}: best {best['cost']:.1f} "
                    f"(this generation {min(costs):.1f}, sigma {es.sigma:.3f}, {elapsed:.0f} s)"
                )

    print(f"cost: start {baseline_cost:.1f} -> best {best['cost']:.1f}, saved to {args.out}")


if __name__ == "__main__":
    main()
