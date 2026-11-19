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


def _action_types(action_names: list[str] | None, action_count: int) -> np.ndarray:
    """Index -> action type id ("HEADING_-30" and "HEADING_30" share a type)."""
    if not action_names:
        return np.arange(action_count)
    types: dict[str, int] = {}
    ids = []
    for name in action_names:
        head, _, tail = name.rpartition("_")
        key = head if head and tail.lstrip("-").replace(".", "").isdigit() else name
        ids.append(types.setdefault(key, len(types)))
    return np.array(ids)


def _split_blocks(size: int, validation_fraction: float, block: int = 400) -> tuple[np.ndarray, np.ndarray]:
    """Train/validation split by blocks of consecutive decisions, so that almost identical decisions
    of the same moment of an episode don't end up on both sides."""
    starts = np.arange(0, size, block)
    count = int(round(len(starts) * validation_fraction)) if validation_fraction > 0 else 0
    if count == 0 or count >= len(starts):
        return np.arange(size), np.zeros(0, dtype=np.int64)
    chosen = np.random.default_rng(12345).choice(len(starts), size=count, replace=False)
    validation = np.concatenate([np.arange(starts[i], min(starts[i] + block, size)) for i in sorted(chosen)])
    train = np.setdiff1d(np.arange(size), validation)
    return train, validation


def train_behaviour_cloning(
    model: PolicyNetwork,
    dataset: Dataset,
    device: torch.device,
    epochs: int = 10,
    batch_size: int = 64,
    learning_rate: float = 3e-4,
    noop_weight: float = 1.0,
    validation_fraction: float = 0.1,
    action_names: list[str] | None = None,
) -> dict[str, float]:
    """Cross-entropy on the actions of every aircraft that had a choice.

    "No action" is most of Bot A's labels (about 84 %) and it is the right answer most of the
    time: down-weighting it (`noop_weight` < 1) teaches the network to give far more orders than
    Bot A does. Progress is measured on decisions held out from training, and the weights of the
    epoch with the lowest validation loss are kept.
    """
    model.set_noop_bias(0.0)
    data = dataset.arrays()
    size = len(data["labels"])
    train_index, validation_index = _split_blocks(size, validation_fraction)
    types = torch.as_tensor(_action_types(action_names, data["action_mask"].shape[-1]), device=device)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    steps_per_epoch = max(1, (len(train_index) + batch_size - 1) // batch_size)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=learning_rate,
                                                    total_steps=epochs * steps_per_epoch + 1,
                                                    pct_start=0.05, anneal_strategy="cos")

    def batch_loss(index: np.ndarray, stats: dict[str, float] | None = None):
        tokens = torch.as_tensor(data["tokens"][index], device=device, dtype=torch.float32)
        token_mask = torch.as_tensor(data["token_mask"][index], device=device, dtype=torch.float32)
        action_mask = torch.as_tensor(data["action_mask"][index], device=device, dtype=torch.float32)
        global_features = torch.as_tensor(data["global"][index], device=device)
        labels = torch.as_tensor(data["labels"][index], device=device, dtype=torch.long)
        sample_weights = torch.as_tensor(data["weights"][index], device=device, dtype=torch.float32)

        logits, _ = model(tokens, token_mask, action_mask, global_features)
        has_choice = ((action_mask > 0.5).sum(-1) > 1) & (token_mask > 0.5)
        label_allowed = action_mask.gather(-1, labels.unsqueeze(-1)).squeeze(-1) > 0.5
        selected = has_choice & label_allowed
        if not selected.any():
            return None
        weights = sample_weights.clone()
        weights[labels == 0] *= noop_weight
        weights = weights[selected]
        if weights.sum() <= 0:
            return None
        loss_per_slot = torch.nn.functional.cross_entropy(logits[selected], labels[selected], reduction="none")
        loss = (loss_per_slot * weights).sum() / weights.sum()
        if stats is not None:
            predicted = logits.argmax(-1)[selected]
            truth = labels[selected]
            acting, predicted_acting = truth != 0, predicted != 0
            stats["loss"] += loss.item() * len(index)
            stats["acting"] += acting.sum().item()
            stats["noop"] += (~acting).sum().item()
            stats["exact"] += (predicted[acting] == truth[acting]).sum().item()
            stats["same_type"] += (types[predicted[acting]] == types[truth[acting]]).sum().item()
            stats["noop_right"] += (~predicted_acting[~acting]).sum().item()
            stats["acted_when_acting"] += predicted_acting[acting].sum().item()
            stats["predicted_acting"] += predicted_acting.sum().item()
        return loss

    def summarize(stats: dict[str, float], count: int) -> dict[str, float]:
        acting = max(1.0, stats["acting"])
        return {
            "loss": stats["loss"] / max(1, count),
            "action_accuracy": stats["exact"] / acting,
            "type_accuracy": stats["same_type"] / acting,
            "noop_accuracy": stats["noop_right"] / max(1.0, stats["noop"]),
            "acts_when_bot_a_acts": stats["acted_when_acting"] / acting,
            # 1.0 = as many orders as Bot A; 3.0 = three times as many
            "command_ratio": stats["predicted_acting"] / acting,
        }

    best_loss, best_state, last = float("inf"), None, {}
    for epoch in range(epochs):
        model.train()
        permutation = np.random.permutation(train_index)
        for start in range(0, len(permutation), batch_size):
            loss = batch_loss(permutation[start:start + batch_size])
            if loss is None:
                continue
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

        model.eval()
        measured = validation_index if len(validation_index) else train_index
        stats = dict.fromkeys(("loss", "acting", "noop", "exact", "same_type", "noop_right", "acted_when_acting",
                               "predicted_acting"), 0.0)
        with torch.no_grad():
            for start in range(0, len(measured), 512):
                batch_loss(measured[start:start + 512], stats)
        last = summarize(stats, len(measured))
        marker = ""
        if last["loss"] < best_loss:
            best_loss, marker = last["loss"], " *"
            best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        print(f"  epoch {epoch + 1}/{epochs} ({'validation' if len(validation_index) else 'training'}): "
              f"loss {last['loss']:.4f}, Bot A's action {last['action_accuracy']:.1%} "
              f"(type {last['type_accuracy']:.1%}), quiet when Bot A is {last['noop_accuracy']:.1%}, "
              f"acts when Bot A acts {last['acts_when_bot_a_acts']:.1%}, "
              f"orders vs Bot A x{last['command_ratio']:.2f}{marker}", flush=True)
    if best_state is not None:
        model.load_state_dict(best_state)
    return last


def calibrate_noop_bias(model: PolicyNetwork, dataset: Dataset, device: torch.device, target_ratio: float = 1.0,
                        validation_fraction: float = 0.1) -> float:
    """Set `action_bias[0]` so that the network gives `target_ratio` times as many orders as Bot A on
    held-out decisions, and return it.

    Trained with a bias of 0, the network says "no action" whenever it is unsure, which is most of
    the moments Bot A acts (it gave about half of Bot A's orders and landed a third of its aircraft).
    """
    data = dataset.arrays()
    _, validation = _split_blocks(len(data["labels"]), validation_fraction)
    index = validation if len(validation) else np.arange(len(data["labels"]))
    model.eval()
    model.set_noop_bias(0.0)
    logit_parts, label_parts = [], []
    with torch.no_grad():
        for start in range(0, len(index), 512):
            i = index[start:start + 512]
            action_mask = torch.as_tensor(data["action_mask"][i], device=device, dtype=torch.float32)
            token_mask = torch.as_tensor(data["token_mask"][i], device=device, dtype=torch.float32)
            logits, _ = model(torch.as_tensor(data["tokens"][i], device=device, dtype=torch.float32), token_mask,
                              action_mask, torch.as_tensor(data["global"][i], device=device))
            selected = ((action_mask > 0.5).sum(-1) > 1) & (token_mask > 0.5)
            logit_parts.append(logits[selected].float().cpu())
            label_parts.append(torch.as_tensor(data["labels"][i], dtype=torch.long)[selected.cpu()])
    logits, labels = torch.cat(logit_parts), torch.cat(label_parts)
    bot_a_orders = max(1, int((labels != 0).sum()))

    def ratio(bias: float) -> float:
        shifted = logits.clone()
        shifted[:, 0] += bias
        return float((shifted.argmax(-1) != 0).sum()) / bot_a_orders

    # more negative bias -> more orders: bisect
    low, high = -8.0, 4.0
    for _ in range(30):
        middle = (low + high) / 2
        if ratio(middle) > target_ratio:
            low = middle
        else:
            high = middle
    bias = round((low + high) / 2, 3)
    model.set_noop_bias(bias)
    print(f"no-action bias {bias:+.2f}: orders vs Bot A x{ratio(0.0):.2f} -> x{ratio(bias):.2f} "
          f"(target x{target_ratio:.2f})", flush=True)
    return bias


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
    action_names = envs.envs[0].action_names
    train_behaviour_cloning(model, dataset, device, config["epochs"], config["batch_size"],
                            config["learning_rate"], config.get("noop_weight", 1.0),
                            config.get("validation_fraction", 0.1), action_names)
    target_ratio = config.get("noop_calibration_ratio", 1.0)
    calibrate = target_ratio is not None and target_ratio > 0
    if calibrate:
        calibrate_noop_bias(model, dataset, device, target_ratio, config.get("validation_fraction", 0.1))
    torch.save({"model_config": model.config.as_dict(), "state_dict": model.state_dict()}, out_dir / "bc.pt")

    for iteration in range(config.get("dagger_iterations", 0)):
        print(f"DAgger iteration {iteration + 1}: the network flies, Bot A labels")
        model.eval()
        # flies with the calibrated bias (the states it will really meet), trains with none
        dataset.extend(collect(envs, config["dagger_decisions"], model, device))
        model.set_noop_bias(0.0)
        train_behaviour_cloning(model, dataset, device, config.get("dagger_epochs", max(1, config["epochs"] // 2)),
                                config["batch_size"], config["learning_rate"], config.get("noop_weight", 1.0),
                                config.get("validation_fraction", 0.1), action_names)
        if calibrate:
            calibrate_noop_bias(model, dataset, device, target_ratio, config.get("validation_fraction", 0.1))
        torch.save({"model_config": model.config.as_dict(), "state_dict": model.state_dict()},
                   out_dir / f"dagger_{iteration + 1}.pt")
    torch.save({"model_config": model.config.as_dict(), "state_dict": model.state_dict()}, out_dir / "imitation.pt")


TIER0_RULES = ("RUNWAY_INCURSION", "TERRAIN_COLLISION", "MINIMUM_ALTITUDE")
TIER1_RULES = ("RADAR_SEPARATION", "FINAL_APPROACH_SEPARATION", "WAKE_ARRIVAL", "WAKE_DEPARTURE", "ARRIVAL_DEPARTURE")
DEFAULT_CHECK = {
    "airports": ["lemd", "lemg", "eddm"],
    "seeds": [7, 8],
    "minutes": 30,
    "traffic_scale": 0.5,
    "emergency_rate": 0.03,
    # the network must land at least this share of what Bot A lands on the same episodes...
    "min_landing_ratio": 0.8,
    # ...with no more than this many extra tier 1 conflicts per episode, and no extra tier 0
    "max_extra_tier1_per_episode": 1.0,
    "workers": 8,
}


def check_against_bot_a(model: PolicyNetwork, device: torch.device, settings: dict[str, Any] | None = None
                        ) -> dict[str, Any]:
    """Fly the same episodes with Bot A and with the network (greedy) and compare what matters:
    landings and serious conflicts. Decides whether imitation is good enough to start PPO."""
    from .env import EnvConfig, OpenScopeEnv
    from .workers import SimulatorPool

    check = {**DEFAULT_CHECK, **(settings or {})}
    model.eval()

    def fly(client, job):
        pilot, airport, seed = job
        env = OpenScopeEnv(EnvConfig(airports=[airport], episode_minutes=check["minutes"]), client=client)
        observation, info = env.reset(options={"airport": airport, "seed": seed, "traffic_scale": check["traffic_scale"],
                                               "emergency_rate": check["emergency_rate"]})
        done, orders = False, 0
        while not done:
            if pilot == "botA":
                action = "expert"
            else:
                actions, _, _ = choose_actions(model, {k: v[None] for k, v in observation.items()}, device, greedy=True)
                action = actions[0].cpu().numpy()
                orders += int((action[observation["token_mask"].astype(bool)] != 0).sum())
            observation, _, _, done, info = env.step(action)
            if pilot == "botA":
                orders += int(info.get("commands", 0))
        metrics, counts = info.get("metrics", {}), info.get("violationCounts", {})
        return {
            "pilot": pilot, "airport": airport, "seed": seed,
            "landings": metrics.get("landings", 0), "takeoffs": metrics.get("takeoffs", 0),
            "tier0": sum(counts.get(rule, 0) for rule in TIER0_RULES),
            "tier1": sum(counts.get(rule, 0) for rule in TIER1_RULES),
            "orders": orders,
        }

    jobs = [(pilot, airport, seed) for pilot in ("botA", "network") for airport in check["airports"]
            for seed in check["seeds"]]
    with SimulatorPool(min(len(jobs), check["workers"])) as pool:
        episodes = pool.map(fly, jobs)

    def total(pilot: str, key: str) -> int:
        return sum(e[key] for e in episodes if e["pilot"] == pilot)

    count = len(check["airports"]) * len(check["seeds"])
    totals = {pilot: {key: total(pilot, key) for key in ("landings", "takeoffs", "tier0", "tier1")}
              for pilot in ("botA", "network")}
    # episodes too short for Bot A to land anything don't say anything about landings
    landing_ratio = (totals["network"]["landings"] / totals["botA"]["landings"]) if totals["botA"]["landings"] else 1.0
    extra_tier1 = (totals["network"]["tier1"] - totals["botA"]["tier1"]) / count
    passed = (landing_ratio >= check["min_landing_ratio"]
              and totals["network"]["tier0"] <= totals["botA"]["tier0"]
              and extra_tier1 <= check["max_extra_tier1_per_episode"])

    print("check against Bot A (same episodes):")
    print("  pilot     airport seed landings takeoffs tier0 tier1 orders")
    for e in episodes:
        print(f"  {e['pilot']:<9} {e['airport']:<7} {e['seed']:>4} {e['landings']:>8} {e['takeoffs']:>8} "
              f"{e['tier0']:>5} {e['tier1']:>5} {e['orders']:>6}")
    print(f"  landings: network {totals['network']['landings']} / Bot A {totals['botA']['landings']} "
          f"({landing_ratio:.0%}, needs {check['min_landing_ratio']:.0%}); "
          f"tier 0: {totals['network']['tier0']} vs {totals['botA']['tier0']}; "
          f"extra tier 1 per episode: {extra_tier1:+.2f} (max {check['max_extra_tier1_per_episode']})")
    print(f"  {'PASSED: imitation is good enough to start PPO' if passed else 'NOT PASSED'}", flush=True)
    return {"passed": passed, "landing_ratio": landing_ratio, "extra_tier1_per_episode": extra_tier1,
            "totals": totals, "episodes": episodes, "settings": check}
