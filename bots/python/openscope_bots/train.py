"""Train Bot B: imitation of Bot A, then PPO with a curriculum.

Everything is written to bots/runs/<name>/ and can be resumed after a stop.

Examples (from bots/python):
    # quick check that everything works (a few minutes)
    .venv\\Scripts\\python -m openscope_bots.train --quick

    # full training: imitation, then PPO
    .venv\\Scripts\\python -m openscope_bots.train --config ../configs/default.json

    # continue an interrupted PPO training
    .venv\\Scripts\\python -m openscope_bots.train --config ../configs/default.json --stage ppo --resume

    # also learn from games audited in the browser (audit panel, "Exportar")
    .venv\\Scripts\\python -m openscope_bots.train --config ../configs/default.json --audit ../audits
"""

from __future__ import annotations

import argparse
import copy
import json
import random
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .env import EnvConfig, ParallelEnvs, resolve_airports
from .evaluate import run_bot_b_episode
from .fitness import mean_cost, score_summary
from .imitation import check_against_bot_a, run_imitation
from .model import ModelConfig, PolicyNetwork, load_checkpoint
from .ppo import PPOConfig, PPOTrainer
from .workers import SimulatorPool

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = ROOT / "bots" / "configs" / "default.json"

QUICK_OVERRIDES = {
    "name": "quick-check",
    "envs": 2,
    "imitation": {"collect_decisions": 200, "epochs": 1, "dagger_iterations": 1, "dagger_decisions": 100, "dagger_epochs": 1,
                  "check": {"airports": ["lemd"], "seeds": [1], "minutes": 3},
                  "episode_minutes": 10},
    "ppo": {"rollout_steps": 16, "epochs": 1, "minibatches": 2, "checkpoint_every": 1, "evaluate_every": 2,
            "value_warmup_updates": 1},
    "env": {"airports": ["lemd", "lemg"], "emergency_rate": [0.1, 0.1]},
    "curriculum": [{"name": "quick", "updates": 2, "env": {"airports": ["lemd", "lemg"], "traffic_scale": [0.5, 0.5],
                                                           "emergency_rate": [0.1, 0.1], "episode_minutes": 5}}],
    "evaluation": {"airports": ["lemd"], "seeds": [101], "minutes": 5, "emergency_rate": 0.1},
}


def merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(base)
    for key, value in override.items():
        result[key] = merge(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else value
    return result


def pick_device(name: str) -> torch.device:
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(name)


def make_evaluator(config: dict[str, Any], device: torch.device):
    evaluation = config["evaluation"]
    airports = resolve_airports(evaluation["airports"])
    valid = set(resolve_airports("all"))
    invalid = [airport for airport in airports if airport not in valid]
    if invalid:
        raise ValueError(f"evaluation airports not in configs/airports.json (they don't load headless): {invalid}")
    episodes = [{"airport": a, "seed": s} for a in airports for s in evaluation["seeds"]]

    def evaluate(model: PolicyNetwork) -> dict[str, Any]:
        with SimulatorPool(min(len(episodes), config["envs"])) as pool:
            summaries = pool.map(
                lambda client, ep: run_bot_b_episode(client, model, device, ep["airport"], ep["seed"],
                                                     evaluation["minutes"],
                                                     emergency_rate=evaluation.get("emergency_rate")),
                episodes,
            )
        scores = [score_summary(summary) for summary in summaries]
        return {"cost": mean_cost(scores), "episodes": [score.as_dict() for score in scores]}

    return evaluate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--stage", choices=["all", "imitation", "ppo"], default="all")
    parser.add_argument("--resume", action="store_true", help="continue from the last PPO checkpoint")
    parser.add_argument("--init", type=Path, help="start PPO from this checkpoint instead of the imitation result")
    parser.add_argument("--quick", action="store_true", help="tiny run to check the installation")
    parser.add_argument("--stage-check", dest="check_only", action="store_true",
                        help="only compare the imitation network with Bot A (the check that gates PPO)")
    parser.add_argument("--check-seeds", nargs="+", type=int,
                        help="seeds of the check against Bot A (default: the configuration's; more seeds, less noise)")
    parser.add_argument("--max-updates", type=int, help="stop PPO after this many updates (a bounded trial)")
    parser.add_argument("--skip-check", action="store_true",
                        help="start PPO even if the imitation network doesn't pass the check against Bot A")
    parser.add_argument("--audit", nargs="+", type=Path,
                        help="audit exports (.jsonl files or directories) added to the imitation data")
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    if args.check_seeds:
        config["imitation"].setdefault("check", {})["seeds"] = args.check_seeds
    if args.quick:
        config = merge(config, QUICK_OVERRIDES)

    random.seed(config["seed"])
    np.random.seed(config["seed"])
    torch.manual_seed(config["seed"])
    device = pick_device(config.get("device", "auto"))
    out_dir = ROOT / "bots" / "runs" / config["name"]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "config.json").write_text(json.dumps(config, indent=2))
    print(f"device: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else ""))
    print(f"output: {out_dir}")

    env_config = EnvConfig.from_dict(config["env"])
    envs = ParallelEnvs(config["envs"], env_config, seed=config["seed"])
    try:
        model_config = ModelConfig(
            feature_count=envs.feature_count,
            global_count=envs.global_count,
            action_count=envs.action_count,
            max_aircraft=envs.max_aircraft,
            **config["model"],
        )
        model = PolicyNetwork(model_config).to(device)
        print(f"network: {sum(p.numel() for p in model.parameters()):,} parameters")

        if args.check_only:
            # the training simulators aren't needed: free their memory for the check's own
            envs.close()
            checked_path = args.init or out_dir / "imitation.pt"
            checked, _ = load_checkpoint(checked_path, device)
            print(f"checking {checked_path}")
            result = check_against_bot_a(checked, device, config["imitation"].get("check"))
            name = "imitation_check.json" if checked_path.name == "imitation.pt" else f"check_{checked_path.stem}.json"
            (out_dir / name).write_text(json.dumps(result, indent=2))
            return

        if args.stage in ("all", "imitation") and not args.resume:
            imitation = config["imitation"]
            envs.set_config(EnvConfig.from_dict({**config["env"], "episode_minutes": imitation["episode_minutes"],
                                                 "with_expert": True}))
            run_imitation(model, envs, imitation, out_dir, device, args.audit)

        if args.stage in ("all", "ppo") and not args.resume and not args.skip_check and not args.quick:
            start = args.init or out_dir / "imitation.pt"
            checked, _ = load_checkpoint(start, device)
            result = check_against_bot_a(checked, device, config["imitation"].get("check"))
            (out_dir / "imitation_check.json").write_text(json.dumps(result, indent=2))
            if not result["passed"]:
                print(f"PPO not started: {start.name} doesn't fly like Bot A yet (see imitation_check.json). "
                      "Improve the imitation, or pass --skip-check to start PPO anyway.")
                sys.exit(3)

        if args.stage in ("all", "ppo"):
            reference_path = args.init or out_dir / "imitation.pt"
            reference = load_checkpoint(reference_path, device)[0] if reference_path.exists() else None
            trainer = PPOTrainer(model, envs, PPOConfig.from_dict(config["ppo"]), out_dir, device,
                                 evaluate=make_evaluator(config, device), reference=reference)
            checkpoint_path = out_dir / "ppo_checkpoint.pt"
            if args.resume and checkpoint_path.exists():
                model, checkpoint = load_checkpoint(checkpoint_path, device)
                trainer.model = model
                trainer.optimizer = torch.optim.Adam(model.parameters(), lr=trainer.config.learning_rate, eps=1e-5)
                trainer.restore(checkpoint)
                print(f"resuming at update {trainer.update}")
            else:
                start = args.init or out_dir / "imitation.pt"
                if start.exists():
                    loaded, _ = load_checkpoint(start, device)
                    model.load_state_dict(loaded.state_dict())
                    print(f"PPO starts from {start}")
            trainer.train(config["curriculum"], config["env"], max_updates=args.max_updates)
            print(f"done. Latest: {out_dir / 'ppo_checkpoint.pt'}; best evaluated: {out_dir / 'best.pt'}")
    finally:
        envs.close()


if __name__ == "__main__":
    main()
