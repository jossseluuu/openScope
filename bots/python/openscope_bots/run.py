"""Let a bot control one episode in the simulator and print the result.

Examples (from bots/python):
    .venv\\Scripts\\python -m openscope_bots.run --bot A --airport lemd --minutes 60 --seed 1
    .venv\\Scripts\\python -m openscope_bots.run --bot B --model ../runs/botB/best.pt --airport eddm
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from openscope_sim import SimulatorClient

from .fitness import score_summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bot", choices=["A", "B", "a", "b"], default="A")
    parser.add_argument("--airport", default="lemd")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--minutes", type=float, default=60)
    parser.add_argument("--wind", help="direction/speed, e.g. 180/15")
    parser.add_argument("--model", type=Path, help="Bot B checkpoint (.pt)")
    parser.add_argument("--params", type=Path, help="Bot A parameters (JSON from tune_bot_a)")
    args = parser.parse_args()

    wind = tuple(float(v) for v in args.wind.split("/")) if args.wind else None
    with SimulatorClient() as client:
        if args.bot.upper() == "A":
            parameters = json.loads(args.params.read_text())["parameters"] if args.params else {}
            summary = client.run_bot_episode(bot="A", airport=args.airport, seed=args.seed, minutes=args.minutes,
                                             parameters=parameters, wind=wind)["summary"]
        else:
            if not args.model:
                raise SystemExit("Bot B needs --model (a checkpoint from openscope_bots.train)")
            import torch

            from .evaluate import run_bot_b_episode
            from .model import load_checkpoint

            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model, _ = load_checkpoint(args.model, device)
            summary = run_bot_b_episode(client, model, device, args.airport, args.seed, args.minutes, wind)

    print(json.dumps(summary, indent=2))
    print("score:", json.dumps(score_summary(summary).as_dict(), indent=2))


if __name__ == "__main__":
    main()
