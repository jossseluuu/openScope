"""Training data from the games audited in the browser (the `audit` panel, "Exportar" button).

Every exported training step holds, for each aircraft, its features as Bot B sees them, the
actions it was allowed, Bot A's action (real when Bot A was in control, from a shadow Bot A
otherwise) and what happened to that aircraft in the following minutes. Labels are weighted
by that outcome, so Bot B learns Bot A's choices without copying the ones that ended badly.

Examples (from bots/python):
    .venv\\Scripts\\python -m openscope_bots.audit_data ../audits            # summary of the files
    .venv\\Scripts\\python -m openscope_bots.train --config ../configs/default.json --audit ../audits
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Iterable

import numpy as np

from .imitation import Dataset

# weight of a label by the outcome of its aircraft (see OUTCOME in AuditController.js)
OUTCOME_WEIGHTS = {
    "ok": 1.0,
    "landed": 1.0,
    "departed": 1.0,
    "procedure": 0.5,
    "pending": 0.5,
    "separation": 0.1,
    "safety": 0.0,
    "lost": 0.0,
}


def audit_files(paths: Iterable[Path]) -> list[Path]:
    """`.jsonl` files given directly or found in the given directories."""
    files: list[Path] = []
    for path in paths:
        path = Path(path)
        files.extend(sorted(path.glob("*.jsonl")) if path.is_dir() else [path])
    return files


def load_audits(paths: Iterable[Path], feature_version: int | None = None) -> tuple[Dataset, Counter]:
    """Dataset of every training step in the files; files of another feature version are skipped."""
    dataset = Dataset()
    stats: Counter = Counter()
    for path in audit_files(paths):
        with open(path, encoding="utf-8") as handle:
            header = json.loads(handle.readline())
            if header.get("type") != "header":
                print(f"skipping {path}: not an audit export")
                stats["skipped files"] += 1
                continue
            if feature_version is not None and header["featureVersion"] != feature_version:
                print(f"skipping {path}: feature version {header['featureVersion']}, the bots use {feature_version}")
                stats["skipped files"] += 1
                continue
            n, f, k = header["maxAircraft"], header["featureCount"], header["actionCount"]
            stats["files"] += 1
            for line in handle:
                record = json.loads(line)
                if record["type"] != "step":
                    stats[f"{record['type']} lines"] += 1
                    continue
                tokens = np.zeros((1, n, f), np.float32)
                token_mask = np.zeros((1, n), np.float32)
                action_mask = np.zeros((1, n, k), np.float32)
                action_mask[0, :, 0] = 1  # empty slots can only do nothing
                labels = np.zeros((1, n), np.int16)
                weights = np.zeros((1, n), np.float32)
                for slot, aircraft in enumerate(record["aircraft"][:n]):
                    tokens[0, slot] = aircraft["features"]
                    token_mask[0, slot] = 1
                    action_mask[0, slot] = [character == "1" for character in aircraft["allowed"]]
                    labels[0, slot] = aircraft["label"]
                    weights[0, slot] = OUTCOME_WEIGHTS.get(aircraft["outcome"], 0.5)
                    stats[f"outcome {aircraft['outcome']}"] += 1
                    stats["labels (not 'do nothing')"] += aircraft["label"] != 0
                observation = {
                    "tokens": tokens,
                    "token_mask": token_mask,
                    "action_mask": action_mask,
                    "global": np.asarray([record["global"]], np.float32),
                }
                dataset.add(observation, labels, weights)
                stats["steps"] += 1
                stats[f"steps by {record['source']}"] += 1
    return dataset, stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path, help="exported .jsonl files or directories with them")
    args = parser.parse_args()
    dataset, stats = load_audits(args.paths)
    for key in sorted(stats):
        print(f"{key:32} {stats[key]}")
    print(f"{'training examples (aircraft)':32} {int(dataset.arrays()['token_mask'].sum()) if len(dataset) else 0}")


if __name__ == "__main__":
    main()
