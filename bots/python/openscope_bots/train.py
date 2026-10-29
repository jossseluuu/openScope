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
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .env import EnvConfig, ParallelEnvs
from .evaluate import run_bot_b_episode
from .fitness import mean_cost, score_summary
from .imitation import run_imitation
from .model import ModelConfig, PolicyNetwork, load_checkpoint
from .ppo import PPOConfig, PPOTrainer
from .workers import SimulatorPool

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = ROOT / "bots" / "configs" / "default.json"

QUICK_OVERRIDES = {
    "name": "quick-check",
    "envs": 2,
    "imitation": {"collect_decisions": 200, "epochs": 1, "dagger_iterations": 1, "dagger_decisions": 100,
                  "episode_minutes": 10},
    "ppo": {"rollout_steps": 16, "epochs": 1, "minibatches": 2, "checkpoint_every": 1, "evaluate_every": 2},
    "curriculum": [{"name": "quick", "updates": 2, "env": {"airports": ["lemd"], "traffic_scale": [0.5, 0.5],
                                                           "episode_minutes": 5}}],
    "evaluation": {"airports": ["lemd"], "seeds": [101], "minutes": 5},
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
    episodes = [{"airport": a, "seed": s} for a in evaluation["airports"] for s in evaluation["seeds"]]

    def evaluate(model: PolicyNetwork) -> dict[str, Any]:
        with SimulatorPool(min(len(episodes), config["envs"])) as pool:
            summaries = pool.map(
                lambda client, ep: run_bot_b_episode(client, model, device, ep["airport"], ep["seed"],
                                                     evaluation["minutes"]),
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
    parser.add_argument("--audit", nargs="+", type=Path,
                        help="audit exports (.jsonl files or directories) added to the imitation data")
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
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

        if args.stage in ("all", "imitation") and not args.resume:
            imitation = config["imitation"]
            envs.set_config(EnvConfig.from_dict({**config["env"], "episode_minutes": imitation["episode_minutes"],
                                                 "with_expert": True}))
            run_imitation(model, envs, imitation, out_dir, device, args.audit)

        if args.stage in ("all", "ppo"):
            trainer = PPOTrainer(model, envs, PPOConfig.from_dict(config["ppo"]), out_dir, device,
                                 evaluate=make_evaluator(config, device))
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
            trainer.train(config["curriculum"], config["env"])
            print(f"done. Latest: {out_dir / 'ppo_checkpoint.pt'}; best evaluated: {out_dir / 'best.pt'}")
    finally:
        envs.close()


if __name__ == "__main__":
    main()
