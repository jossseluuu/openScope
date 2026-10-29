"""Export Bot B to ONNX so the browser can run it (Phase 7).

Writes the network and a JSON file with the encoding it expects; the game loads
both from assets/bots/.

Example (from bots/python):
    .venv\\Scripts\\python -m openscope_bots.export_onnx --model ../runs/botB/best.pt
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from openscope_sim import SimulatorClient

from .model import load_checkpoint

ROOT = Path(__file__).resolve().parents[3]


class GreedyPolicy(torch.nn.Module):
    """Wraps the network so the exported graph returns logits only (no value head needed)."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, tokens, token_mask, action_mask, global_features):  # noqa: D102
        logits, _ = self.model(tokens, token_mask, action_mask, global_features)
        return logits


def export(model_path: Path, out_path: Path) -> Path:
    model, checkpoint = load_checkpoint(model_path, "cpu")
    model.eval()
    config = model.config
    n, f, k, g = config.max_aircraft, config.feature_count, config.action_count, config.global_count
    example = (
        torch.zeros(1, n, f),
        torch.ones(1, n),
        torch.ones(1, n, k),
        torch.zeros(1, g),
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        GreedyPolicy(model),
        example,
        out_path,
        input_names=["tokens", "token_mask", "action_mask", "global"],
        output_names=["logits"],
        dynamic_axes={name: {0: "batch"} for name in ("tokens", "token_mask", "action_mask", "global", "logits")},
        opset_version=17,
        dynamo=False,
    )

    with SimulatorClient() as client:
        spec = client.rl_spec()
    if (spec["maxAircraft"], spec["featureCount"], spec["actionCount"]) != (n, f, k):
        raise SystemExit("the model was trained with a different encoding than the current code")

    metadata = {
        "featureVersion": spec["featureVersion"],
        "maxAircraft": n,
        "featureCount": f,
        "globalFeatureCount": g,
        "actionCount": k,
        "actionNames": spec["actionNames"],
        "source": str(model_path),
        "evaluation": checkpoint.get("evaluation"),
    }
    out_path.with_suffix(".json").write_text(json.dumps(metadata, indent=2))
    verify(model, out_path, example)
    return out_path


def verify(model: torch.nn.Module, onnx_path: Path, example) -> None:
    """Check that ONNX Runtime gives the same logits as PyTorch."""
    import onnxruntime

    session = onnxruntime.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    random = torch.Generator().manual_seed(0)
    tokens = torch.randn(example[0].shape, generator=random)
    inputs = (tokens, example[1], example[2], torch.randn(example[3].shape, generator=random))
    with torch.no_grad():
        expected = model(*inputs)[0].numpy()
    actual = session.run(None, {
        "tokens": inputs[0].numpy(), "token_mask": inputs[1].numpy(),
        "action_mask": inputs[2].numpy(), "global": inputs[3].numpy(),
    })[0]
    difference = float(np.max(np.abs(expected - actual)))
    if difference > 1e-3:
        raise SystemExit(f"ONNX output differs from PyTorch by {difference}")
    print(f"ONNX verified (max difference {difference:.2e})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", type=Path, required=True, help="Bot B checkpoint (.pt)")
    parser.add_argument("--out", type=Path, default=ROOT / "assets" / "bots" / "botB.onnx")
    args = parser.parse_args()
    path = export(args.model, args.out)
    print(f"exported to {path} and {path.with_suffix('.json')}")


if __name__ == "__main__":
    main()
