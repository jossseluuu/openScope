"""Phase 6: Proximal Policy Optimization for Bot B.

The policy chooses one action per aircraft at every decision. Rollouts are
collected from several simulators at once; the curriculum moves from light traffic
at one airport to full traffic at both reference airports with random winds.
"""

from __future__ import annotations

import csv
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
import torch

from .env import EnvConfig, ParallelEnvs
from .model import PolicyNetwork, distribution_terms, save_checkpoint


@dataclass
class PPOConfig:
    rollout_steps: int = 128
    learning_rate: float = 2.5e-4
    gamma: float = 0.99
    gae_lambda: float = 0.95
    clip: float = 0.2
    epochs: int = 4
    minibatches: int = 4
    entropy: float = 0.01
    value: float = 0.5
    max_grad_norm: float = 0.5
    checkpoint_every: int = 10
    evaluate_every: int = 25

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PPOConfig":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


def to_tensors(observation: dict[str, np.ndarray], device: torch.device) -> tuple[torch.Tensor, ...]:
    return (
        torch.as_tensor(observation["tokens"], device=device),
        torch.as_tensor(observation["token_mask"], device=device, dtype=torch.float32),
        torch.as_tensor(observation["action_mask"], device=device, dtype=torch.float32),
        torch.as_tensor(observation["global"], device=device),
    )


@torch.no_grad()
def choose_actions(model: PolicyNetwork, observation: dict[str, np.ndarray], device: torch.device, greedy: bool = False):
    tokens, token_mask, action_mask, global_features = to_tensors(observation, device)
    logits, value = model(tokens, token_mask, action_mask, global_features)
    if greedy:
        actions = logits.argmax(-1)
    else:
        actions = torch.distributions.Categorical(logits=logits).sample()
    log_prob, _, _ = distribution_terms(logits, actions, action_mask)
    return actions, log_prob, value


class PPOTrainer:
    def __init__(
        self,
        model: PolicyNetwork,
        envs: ParallelEnvs,
        config: PPOConfig,
        out_dir: Path,
        device: torch.device,
        evaluate: Optional[Callable[[PolicyNetwork], dict[str, Any]]] = None,
    ) -> None:
        self.model = model
        self.envs = envs
        self.config = config
        self.out_dir = out_dir
        self.device = device
        self.evaluate = evaluate
        self.optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate, eps=1e-5)
        self.update = 0
        self.decisions = 0
        self.best_cost = float("inf")
        self._episode_returns: list[float] = []
        self._episode_stats: list[dict[str, Any]] = []
        self._returns = np.zeros(envs.count)
        self._observation: Optional[dict[str, np.ndarray]] = None
        self._log_path = out_dir / "ppo_log.csv"

    # ------------------------------------------------------------ persistence

    def save(self, name: str = "ppo_checkpoint.pt", extra: Optional[dict[str, Any]] = None) -> Path:
        path = self.out_dir / name
        save_checkpoint(path, self.model, {
            "optimizer": self.optimizer.state_dict(),
            "update": self.update,
            "decisions": self.decisions,
            "best_cost": self.best_cost,
            **(extra or {}),
        })
        return path

    def restore(self, checkpoint: dict[str, Any]) -> None:
        if "optimizer" in checkpoint:
            self.optimizer.load_state_dict(checkpoint["optimizer"])
        self.update = checkpoint.get("update", 0)
        self.decisions = checkpoint.get("decisions", 0)
        self.best_cost = checkpoint.get("best_cost", float("inf"))

    # ---------------------------------------------------------------- training

    def train(self, curriculum: list[dict[str, Any]], base_env: dict[str, Any]) -> None:
        """Run the curriculum stages in order, skipping the updates already done (resume)."""
        stage_start = 0
        for stage in curriculum:
            stage_end = stage_start + int(stage["updates"])
            if self.update >= stage_end:
                stage_start = stage_end
                continue
            print(f"stage '{stage.get('name', '')}': updates {self.update + 1}-{stage_end}")
            self.envs.set_config(EnvConfig.from_dict({**base_env, **stage.get("env", {}), "with_expert": False}))
            self._observation, _ = self.envs.reset()
            self._returns[:] = 0
            while self.update < stage_end:
                self._train_one_update(stage.get("name", ""))
            stage_start = stage_end
        self.save()

    def _train_one_update(self, stage_name: str) -> None:
        started = time.time()
        batch = self._collect_rollout()
        losses = self._optimize(batch)
        self.update += 1
        elapsed = time.time() - started

        recent = self._episode_returns[-20:]
        stats = self._episode_stats[-20:]
        row = {
            "update": self.update,
            "stage": stage_name,
            "decisions": self.decisions,
            "mean_reward": float(batch["rewards"].mean()),
            "episode_return": float(np.mean(recent)) if recent else "",
            "landings": float(np.mean([s["landings"] for s in stats])) if stats else "",
            "tier0": float(np.mean([s["tier0"] for s in stats])) if stats else "",
            "tier1": float(np.mean([s["tier1"] for s in stats])) if stats else "",
            **losses,
            "seconds": round(elapsed, 1),
        }
        self._log(row)
        print(
            f"update {self.update} [{stage_name}] reward/step {row['mean_reward']:.3f} "
            f"episode return {row['episode_return'] if row['episode_return'] == '' else round(row['episode_return'], 1)} "
            f"entropy {losses['entropy']:.2f} ({elapsed:.1f} s)"
        )

        if self.update % self.config.checkpoint_every == 0:
            self.save()

        if self.evaluate and self.update % self.config.evaluate_every == 0:
            result = self.evaluate(self.model)
            print(f"evaluation at update {self.update}: cost {result['cost']:.1f}")
            if result["cost"] < self.best_cost:
                self.best_cost = result["cost"]
                self.save("best.pt", {"evaluation": result})
            self.model.train()

    def _collect_rollout(self) -> dict[str, torch.Tensor]:
        cfg = self.config
        steps, count = cfg.rollout_steps, self.envs.count
        storage: dict[str, list] = {key: [] for key in ("tokens", "token_mask", "action_mask", "global", "actions",
                                                       "log_probs", "values", "rewards", "dones")}
        self.model.eval()
        observation = self._observation
        for _ in range(steps):
            actions, log_probs, values = choose_actions(self.model, observation, self.device)
            next_observation, rewards, dones, infos = self.envs.step(actions.cpu().numpy())
            for key in ("tokens", "token_mask", "action_mask", "global"):
                storage[key].append(observation[key])
            storage["actions"].append(actions.cpu().numpy())
            storage["log_probs"].append(log_probs.cpu().numpy())
            storage["values"].append(values.cpu().numpy())
            storage["rewards"].append(rewards)
            storage["dones"].append(dones)
            self._track_episodes(rewards, dones, infos)
            observation = next_observation
            self.decisions += count
        self._observation = observation

        with torch.no_grad():
            _, _, last_value = choose_actions(self.model, observation, self.device)
        last_value = last_value.cpu().numpy()

        rewards = np.array(storage["rewards"])
        values = np.array(storage["values"])
        dones = np.array(storage["dones"])
        advantages = np.zeros_like(rewards)
        gae = np.zeros(count)
        for t in reversed(range(steps)):
            next_value = last_value if t == steps - 1 else values[t + 1]
            not_done = 1.0 - dones[t]
            delta = rewards[t] + cfg.gamma * next_value * not_done - values[t]
            gae = delta + cfg.gamma * cfg.gae_lambda * not_done * gae
            advantages[t] = gae
        returns = advantages + values

        flat = lambda array: torch.as_tensor(np.asarray(array).reshape(steps * count, *np.asarray(array).shape[2:]),
                                             device=self.device)
        return {
            "tokens": flat(storage["tokens"]),
            "token_mask": flat(storage["token_mask"]).float(),
            "action_mask": flat(storage["action_mask"]).float(),
            "global": flat(storage["global"]),
            "actions": flat(storage["actions"]).long(),
            "log_probs": flat(storage["log_probs"]),
            "advantages": flat(advantages),
            "returns": flat(returns),
            "rewards": flat(rewards),
        }

    def _optimize(self, batch: dict[str, torch.Tensor]) -> dict[str, float]:
        cfg = self.config
        self.model.train()
        size = batch["actions"].shape[0]
        minibatch = max(1, size // cfg.minibatches)
        totals = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "clip_fraction": 0.0}
        count = 0
        for _ in range(cfg.epochs):
            permutation = torch.randperm(size, device=self.device)
            for start in range(0, size, minibatch):
                index = permutation[start:start + minibatch]
                logits, values = self.model(batch["tokens"][index], batch["token_mask"][index],
                                            batch["action_mask"][index], batch["global"][index])
                log_probs, entropy, _ = distribution_terms(logits, batch["actions"][index], batch["action_mask"][index])
                advantages = batch["advantages"][index]
                advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
                ratio = torch.exp(log_probs - batch["log_probs"][index])
                policy_loss = -torch.min(
                    ratio * advantages, torch.clamp(ratio, 1 - cfg.clip, 1 + cfg.clip) * advantages
                ).mean()
                value_loss = 0.5 * (values - batch["returns"][index]).pow(2).mean()
                entropy_mean = entropy.mean()
                loss = policy_loss + cfg.value * value_loss - cfg.entropy * entropy_mean

                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), cfg.max_grad_norm)
                self.optimizer.step()

                totals["policy_loss"] += policy_loss.item()
                totals["value_loss"] += value_loss.item()
                totals["entropy"] += entropy_mean.item()
                totals["clip_fraction"] += ((ratio - 1).abs() > cfg.clip).float().mean().item()
                count += 1
        return {key: value / max(1, count) for key, value in totals.items()}

    def _track_episodes(self, rewards: np.ndarray, dones: np.ndarray, infos: list[dict[str, Any]]) -> None:
        self._returns += rewards
        for index, done in enumerate(dones):
            if not done:
                continue
            final = infos[index].get("final_info", {})
            counts = final.get("violationCounts", {})
            metrics = final.get("metrics", {})
            self._episode_returns.append(float(self._returns[index]))
            self._episode_stats.append({
                "landings": metrics.get("landings", 0),
                "tier0": sum(counts.get(rule, 0) for rule in ("RUNWAY_INCURSION", "TERRAIN_COLLISION", "MINIMUM_ALTITUDE")),
                "tier1": sum(counts.get(rule, 0) for rule in ("RADAR_SEPARATION", "FINAL_APPROACH_SEPARATION",
                                                                "WAKE_ARRIVAL", "WAKE_DEPARTURE", "ARRIVAL_DEPARTURE")),
            })
            self._returns[index] = 0.0

    def _log(self, row: dict[str, Any]) -> None:
        is_new = not self._log_path.exists()
        with open(self._log_path, "a", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(row.keys()))
            if is_new:
                writer.writeheader()
            writer.writerow(row)
