"""Bot A versus Bot B on the same episodes (same airports, seeds and winds).

Example (from bots/python):
    .venv\\Scripts\\python -m openscope_bots.evaluate --model ../runs/botB/best.pt --airports lemd eddm \\
        --seeds 101 102 103 --minutes 60
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from openscope_sim import SimulatorClient

from .fitness import EpisodeScore, score_summary
from .workers import SimulatorPool

ROOT = Path(__file__).resolve().parents[3]
TIER_OF_RULE = {
    "RUNWAY_INCURSION": 0, "TERRAIN_COLLISION": 0, "MINIMUM_ALTITUDE": 0,
    "RADAR_SEPARATION": 1, "FINAL_APPROACH_SEPARATION": 1, "WAKE_ARRIVAL": 1, "WAKE_DEPARTURE": 1,
    "ARRIVAL_DEPARTURE": 1, "RUNWAY_WIND_LIMIT": 2, "GO_AROUND": 3,
}


def run_bot_b_episode(client: SimulatorClient, model: Any, device: Any, airport: str, seed: int, minutes: float,
                      wind: Optional[tuple[float, float]] = None) -> dict[str, Any]:
    """Fly one episode with the network (greedy) and summarize it like a Bot A episode."""
    import torch  # noqa: WPS433 - torch is only needed for Bot B

    from .env import EnvConfig, OpenScopeEnv
    from .ppo import choose_actions

    env = OpenScopeEnv(EnvConfig(airports=[airport], episode_minutes=minutes), client=client)
    observation, info = env.reset(options={"airport": airport, "seed": seed, "wind": wind, "traffic_scale": 1.0})
    by_rule: dict[str, int] = {}
    commands = 0
    done = False
    model.eval()
    while not done:
        batch = {key: value[None] for key, value in observation.items()}
        with torch.no_grad():
            actions, _, _ = choose_actions(model, batch, device, greedy=True)
        observation, _, _, done, info = env.step(actions[0].cpu().numpy())
        commands += info.get("commands", 0)
        for violation in info.get("violations", []):
            by_rule[violation["rule"]] = by_rule.get(violation["rule"], 0) + 1
    by_tier: dict[str, int] = {}
    for rule, count in by_rule.items():
        tier = str(TIER_OF_RULE.get(rule, 4))
        by_tier[tier] = by_tier.get(tier, 0) + count
    return {
        "airport": airport.upper(),
        "events": info.get("events", {}),
        "violationsByRule": by_rule,
        "violationsByTier": by_tier,
        "commands": commands,
        "metrics": info.get("metrics", {}),
        "score": info.get("score"),
    }


def evaluate(episodes: list[dict[str, Any]], workers: int, bot_a_parameters: Optional[dict[str, float]] = None,
             model_path: Optional[Path] = None) -> dict[str, list[dict[str, Any]]]:
    results: dict[str, list[dict[str, Any]]] = {}
    with SimulatorPool(workers) as pool:
        results["A"] = pool.map(
            lambda client, ep: client.run_bot_episode(bot="A", parameters=bot_a_parameters or {}, **ep)["summary"],
            episodes,
        )
        if model_path:
            import torch

            from .model import load_checkpoint

            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model, _ = load_checkpoint(model_path, device)
            results["B"] = pool.map(
                lambda client, ep: run_bot_b_episode(client, model, device, ep["airport"], ep["seed"], ep["minutes"],
                                                     ep.get("wind")),
                episodes,
            )
    return results


def report(episodes: list[dict[str, Any]], results: dict[str, list[dict[str, Any]]]) -> str:
    lines = ["| Episode | Bot | Safety (tier 0) | Separation (tier 1) | Procedure | Landings | Departures | "
             "Go-arounds | Commands | Cost |", "|---|---|---|---|---|---|---|---|---|---|"]
    totals: dict[str, list[EpisodeScore]] = {}
    for index, episode in enumerate(episodes):
        name = f"{episode['airport'].upper()} seed {episode['seed']}"
        for bot, summaries in results.items():
            score = score_summary(summaries[index])
            totals.setdefault(bot, []).append(score)
            lines.append(
                f"| {name} | {bot} | {score.safety:.0f} | {score.separation:.1f} | {score.procedure:.0f} | "
                f"{score.landings} | {score.departures} | {score.go_arounds} | {score.commands} | {score.cost:.0f} |"
            )
    lines.append("")
    lines.append("| Bot | Mean cost | Safety | Separation | Landings | Departures |")
    lines.append("|---|---|---|---|---|---|")
    for bot, scores in totals.items():
        count = len(scores)
        lines.append(
            f"| {bot} | {sum(s.cost for s in scores) / count:.0f} | {sum(s.safety for s in scores) / count:.2f} | "
            f"{sum(s.separation for s in scores) / count:.1f} | {sum(s.landings for s in scores) / count:.1f} | "
            f"{sum(s.departures for s in scores) / count:.1f} |"
        )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--airports", nargs="+", default=["lemd", "eddm"])
    parser.add_argument("--seeds", nargs="+", type=int, default=[101, 102, 103])
    parser.add_argument("--minutes", type=float, default=60)
    parser.add_argument("--model", type=Path, help="Bot B checkpoint (.pt); without it only Bot A is evaluated")
    parser.add_argument("--bot-a-params", type=Path, help="tuned Bot A parameters (JSON from tune_bot_a)")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--out", type=Path, default=ROOT / "bots" / "runs" / "evaluation")
    args = parser.parse_args()

    episodes = [{"airport": a, "seed": s, "minutes": args.minutes} for a in args.airports for s in args.seeds]
    parameters = json.loads(args.bot_a_params.read_text())["parameters"] if args.bot_a_params else None
    results = evaluate(episodes, args.workers, parameters, args.model)
    table = report(episodes, results)
    print(table)

    args.out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    (args.out / f"comparison-{stamp}.md").write_text(table + "\n")
    (args.out / f"comparison-{stamp}.json").write_text(json.dumps({"episodes": episodes, "results": results}, indent=2))
    print(f"saved to {args.out}")


if __name__ == "__main__":
    main()
