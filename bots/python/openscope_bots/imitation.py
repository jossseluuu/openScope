"""Phase 5: learning from Bot A before reinforcement learning.

1. Behaviour cloning: Bot A flies episodes; every decision is a training example
   (observation -> Bot A's action for each aircraft).
2. DAgger: the network flies, Bot A labels the situations the network gets itself
   into, and the network is retrained on everything collected so far.

Starting PPO from this network saves a lot of training time: it already knows how
to taxi, take off, follow procedures and clear approaches.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import torch

from .env import ParallelEnvs
from .model import PolicyNetwork
from .ppo import choose_actions

# `weights`: how much each aircraft's label counts (1 for Bot A's own episodes, lower for audited
# decisions that ended badly, see `audit_data`)
KEYS = ("tokens", "token_mask", "action_mask", "global", "labels", "weights")


class Dataset:
    def __init__(self) -> None:
        self.parts: dict[str, list[np.ndarray]] = {key: [] for key in KEYS}

    def add(self, observation: dict[str, np.ndarray], labels: np.ndarray, weights: np.ndarray | None = None) -> None:
        self.parts["tokens"].append(observation["tokens"].astype(np.float16))
        self.parts["token_mask"].append(observation["token_mask"].astype(np.int8))
        self.parts["action_mask"].append(observation["action_mask"].astype(np.int8))
        self.parts["global"].append(observation["global"].astype(np.float32))
        self.parts["labels"].append(labels.astype(np.int16))
        self.parts["weights"].append((np.ones(labels.shape) if weights is None else weights).astype(np.float16))

    def arrays(self) -> dict[str, np.ndarray]:
        return {key: np.concatenate(values) for key, values in self.parts.items() if values}

    def __len__(self) -> int:
        return sum(len(part) for part in self.parts["labels"])

    def save(self, path: Path, feature_version: int | None = None) -> None:
        extra = {} if feature_version is None else {"feature_version": np.array(feature_version)}
        np.savez_compressed(path, **self.arrays(), **extra)

    @staticmethod
    def feature_version_of(path: Path) -> int | None:
        """Feature version the dataset was recorded with (None for files saved before it was stored)."""
        with np.load(path) as data:
            return int(data["feature_version"]) if "feature_version" in data.files else None

    @classmethod
    def load(cls, path: Path) -> "Dataset":
        data = np.load(path)
        dataset = cls()
        for key in KEYS:
            if key in data.files:
                dataset.parts[key].append(data[key])
            elif key == "weights":
                # recorded before weights existed
                dataset.parts[key].append(np.ones(data["labels"].shape, dtype=np.float16))
        return dataset

    def extend(self, other: "Dataset") -> None:
        for key in KEYS:
            self.parts[key].extend(other.parts[key])


def collect(envs: ParallelEnvs, decisions: int, model: PolicyNetwork | None = None,
            device: torch.device | None = None) -> Dataset:
    """Record Bot A's labels. Without a model Bot A flies; with a model the model flies (DAgger)."""
    dataset = Dataset()
    observation, _ = envs.reset()
    labels = envs.expert_actions()
    steps = max(1, decisions // envs.count)
    for step in range(steps):
        dataset.add(observation, labels)
        if model is None:
            observation, _, _, _ = envs.step("expert")
        else:
            actions, _, _ = choose_actions(model, observation, device)
            observation, _, _, _ = envs.step(actions.cpu().numpy())
        labels = envs.expert_actions()
        if (step + 1) % 50 == 0:
            print(f"  collected {len(dataset)} decisions")
    return dataset


def train_behaviour_cloning(
    model: PolicyNetwork,
    dataset: Dataset,
    device: torch.device,
    epochs: int = 10,
    batch_size: int = 64,
    learning_rate: float = 3e-4,
    noop_weight: float = 0.2,
) -> dict[str, float]:
    """Cross-entropy on the actions of every aircraft that had a choice.

    Bot A does nothing most of the time, so "no action" labels are down-weighted.
    """
    data = dataset.arrays()
    size = len(data["labels"])
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    model.train()
    last: dict[str, float] = {}
    for epoch in range(epochs):
        permutation = np.random.permutation(size)
        total_loss = total_correct = total_actions = 0.0
        for start in range(0, size, batch_size):
            index = permutation[start:start + batch_size]
            tokens = torch.as_tensor(data["tokens"][index], device=device, dtype=torch.float32)
            token_mask = torch.as_tensor(data["token_mask"][index], device=device, dtype=torch.float32)
            action_mask = torch.as_tensor(data["action_mask"][index], device=device, dtype=torch.float32)
            global_features = torch.as_tensor(data["global"][index], device=device)
            labels = torch.as_tensor(data["labels"][index], device=device, dtype=torch.long)
            sample_weights = torch.as_tensor(data["weights"][index], device=device, dtype=torch.float32)

            logits, _ = model(tokens, token_mask, action_mask, global_features)
            has_choice = (action_mask > 0.5).sum(-1) > 1
            label_allowed = action_mask.gather(-1, labels.unsqueeze(-1)).squeeze(-1) > 0.5
            selected = has_choice & label_allowed
            if not selected.any():
                continue
            weights = sample_weights.clone()
            weights[labels == 0] *= noop_weight
            weights = weights[selected]
            if weights.sum() <= 0:
                continue
            loss_per_slot = torch.nn.functional.cross_entropy(logits[selected], labels[selected], reduction="none")
            loss = (loss_per_slot * weights).sum() / weights.sum()

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            acting = selected & (labels != 0)
            total_loss += loss.item() * len(index)
            total_correct += (logits.argmax(-1)[acting] == labels[acting]).sum().item()
            total_actions += acting.sum().item()
        last = {
            "loss": total_loss / max(1, size),
            "action_accuracy": total_correct / max(1, total_actions),
        }
        print(f"  epoch {epoch + 1}/{epochs}: loss {last['loss']:.4f}, "
              f"accuracy on Bot A's actions {last['action_accuracy']:.1%}")
    return last


def run_imitation(model: PolicyNetwork, envs: ParallelEnvs, config: dict[str, Any], out_dir: Path,
                  device: torch.device, audit_paths: list[Path] | None = None) -> None:
    dataset_path = out_dir / "imitation_dataset.npz"
    # data encoded by another version of the bot code would teach the network the wrong features
    feature_version = envs.envs[0].spec_info["featureVersion"]
    if dataset_path.exists() and Dataset.feature_version_of(dataset_path) == feature_version:
        print(f"reusing {dataset_path}")
        dataset = Dataset.load(dataset_path)
    else:
        if dataset_path.exists():
            print(f"{dataset_path} was recorded with another feature version, collecting it again")
        print(f"collecting {config['collect_decisions']} decisions flown by Bot A")
        dataset = collect(envs, config["collect_decisions"])
        dataset.save(dataset_path, feature_version)

    if audit_paths:
        # games audited in the browser: Bot A's labels weighted by what happened to each aircraft
        from .audit_data import load_audits
        audited, stats = load_audits(audit_paths, feature_version)
        print(f"adding {stats['steps']} audited steps from {stats['files']} files")
        dataset.extend(audited)

    print(f"behaviour cloning on {len(dataset)} decisions")
    train_behaviour_cloning(model, dataset, device, config["epochs"], config["batch_size"],
                            config["learning_rate"], config["noop_weight"])
    torch.save({"model_config": model.config.as_dict(), "state_dict": model.state_dict()}, out_dir / "bc.pt")

    for iteration in range(config.get("dagger_iterations", 0)):
        print(f"DAgger iteration {iteration + 1}: the network flies, Bot A labels")
        model.eval()
        dataset.extend(collect(envs, config["dagger_decisions"], model, device))
        train_behaviour_cloning(model, dataset, device, max(1, config["epochs"] // 2), config["batch_size"],
                                config["learning_rate"], config["noop_weight"])
        torch.save({"model_config": model.config.as_dict(), "state_dict": model.state_dict()},
                   out_dir / f"dagger_{iteration + 1}.pt")
    torch.save({"model_config": model.config.as_dict(), "state_dict": model.state_dict()}, out_dir / "imitation.pt")
