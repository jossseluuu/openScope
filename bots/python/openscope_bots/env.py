"""Gymnasium environment over the headless simulator (Phase 5).

Observation: up to N aircraft tokens of F features, a token mask, the action mask
of the safety shield (N x K) and G global features. Action: one discrete action per
aircraft slot (MultiDiscrete). The encoding, the actions, the shield and the reward
all live in JavaScript (src/assets/scripts/client/bot), so the browser runs the
exact same logic.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Union

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from openscope_sim import SimulatorClient

# airports where Bot A runs headless, written by tools/sim/check-airports.js --write
AIRPORTS_FILE = Path(__file__).resolve().parents[2] / "configs" / "airports.json"


def resolve_airports(airports: Union[str, list[str]]) -> list[str]:
    """`"all"` (or `["all"]`) means every airport checked by tools/sim/check-airports.js."""
    if airports == "all" or airports == ["all"]:
        if not AIRPORTS_FILE.exists():
            raise FileNotFoundError(f"{AIRPORTS_FILE} not found: run node tools/sim/check-airports.js --write")
        return list(json.loads(AIRPORTS_FILE.read_text())["airports"])
    return list(airports)


@dataclass
class EnvConfig:
    """What kind of episodes to fly. Lists are sampled uniformly at every reset; ranges
    (traffic_scale, emergency_rate) uniformly between their two values."""

    airports: list[str] = field(default_factory=lambda: ["lemd", "eddm"])
    traffic_scale: tuple[float, float] = (1.0, 1.0)
    # probability that a flight declares an emergency (squawk 7700); the game's default is 0.01,
    # training uses more so the network sees enough of them
    emergency_rate: tuple[float, float] = (0.01, 0.01)
    episode_minutes: float = 60
    decision_seconds: float = 10
    # probability of a random surface wind instead of the airport's default
    random_wind_probability: float = 0.0
    max_wind_kt: float = 20
    with_expert: bool = False
    reward_weights: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EnvConfig":
        known = {key: value for key, value in data.items() if key in cls.__dataclass_fields__}
        for key in ("traffic_scale", "emergency_rate"):
            if key in known and not isinstance(known[key], (list, tuple)):
                known[key] = (known[key], known[key])
        if "airports" in known:
            known["airports"] = resolve_airports(known["airports"])
        return cls(**known)


class OpenScopeEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, config: Optional[EnvConfig] = None, client: Optional[SimulatorClient] = None) -> None:
        self.config = config or EnvConfig()
        self.client = client or SimulatorClient()
        self._owns_client = client is None
        spec = self.client.rl_spec()
        self.spec_info = spec
        self.max_aircraft = n = spec["maxAircraft"]
        self.feature_count = f = spec["featureCount"]
        self.global_count = g = spec["globalFeatureCount"]
        self.action_count = k = spec["actionCount"]
        self.action_names = spec["actionNames"]
        self.observation_space = spaces.Dict({
            "tokens": spaces.Box(-5.0, 5.0, (n, f), np.float32),
            "token_mask": spaces.MultiBinary(n),
            "action_mask": spaces.MultiBinary((n, k)),
            "global": spaces.Box(-5.0, 5.0, (g,), np.float32),
        })
        self.action_space = spaces.MultiDiscrete([k] * n)
        self.last_expert_actions: Optional[np.ndarray] = None
        self.last_callsigns: list[Optional[str]] = []

    def reset(self, *, seed: Optional[int] = None, options: Optional[dict[str, Any]] = None):
        super().reset(seed=seed)
        options = options or {}
        rng = self.np_random
        cfg = self.config
        airport = options.get("airport") or cfg.airports[int(rng.integers(len(cfg.airports)))]
        episode_seed = int(options.get("seed", rng.integers(1, 2**31 - 1)))
        low, high = cfg.traffic_scale
        emergency_low, emergency_high = cfg.emergency_rate
        wind = options.get("wind")
        if wind is None and rng.random() < cfg.random_wind_probability:
            wind = (float(rng.uniform(0, 360)), float(rng.uniform(0, cfg.max_wind_kt)))

        result = self.client.rl_reset(
            airport=airport,
            seed=episode_seed,
            wind=wind,
            trafficScale=float(options.get("traffic_scale", rng.uniform(low, high))),
            emergencyRate=float(options.get("emergency_rate", rng.uniform(emergency_low, emergency_high))),
            decisionSeconds=cfg.decision_seconds,
            episodeSeconds=cfg.episode_minutes * 60,
            withExpert=bool(options.get("with_expert", cfg.with_expert)),
            rewardWeights=cfg.reward_weights,
        )
        observation, info = self._convert(result)
        info.update({"airport": airport, "seed": episode_seed})
        return observation, info

    def step(self, action: Union[np.ndarray, str]):
        actions = action if isinstance(action, str) else [int(a) for a in np.asarray(action).reshape(-1)]
        result = self.client.rl_step(actions)
        observation, info = self._convert(result)
        return observation, float(result["reward"]), False, bool(result["done"]), info

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def _convert(self, result: dict[str, Any]):
        n, f, k, g = self.max_aircraft, self.feature_count, self.action_count, self.global_count
        observation = {
            "tokens": np.asarray(result["tokens"], dtype=np.float32).reshape(n, f),
            "token_mask": np.asarray(result["tokenMask"], dtype=np.int8),
            "action_mask": np.asarray(result["actionMask"], dtype=np.int8).reshape(n, k),
            "global": np.asarray(result["global"], dtype=np.float32).reshape(g),
        }
        expert = result.get("expertActions")
        self.last_expert_actions = np.asarray(expert, dtype=np.int64) if expert is not None else None
        self.last_callsigns = result["callsigns"]
        info = dict(result["info"])
        info["expert_actions"] = self.last_expert_actions
        return observation, info


class ParallelEnvs:
    """Several environments stepped at the same time (each owns a simulator process).

    Finished episodes are reset automatically; the finished episode's last info is
    returned under `final_info`.
    """

    def __init__(self, count: int, config: EnvConfig, seed: int = 0) -> None:
        self.envs = [OpenScopeEnv(config) for _ in range(count)]
        self.count = count
        self._executor = ThreadPoolExecutor(max_workers=count)
        self._seed = seed
        first = self.envs[0]
        self.max_aircraft, self.feature_count = first.max_aircraft, first.feature_count
        self.global_count, self.action_count = first.global_count, first.action_count

    def reset(self) -> tuple[dict[str, np.ndarray], list[dict[str, Any]]]:
        results = list(self._executor.map(
            lambda pair: pair[1].reset(seed=self._seed + pair[0]), enumerate(self.envs)
        ))
        return stack([obs for obs, _ in results]), [info for _, info in results]

    def step(self, actions: Union[np.ndarray, str]):
        def run(index: int):
            env = self.envs[index]
            action = actions if isinstance(actions, str) else actions[index]
            observation, reward, terminated, truncated, info = env.step(action)
            if terminated or truncated:
                final_info = info
                observation, info = env.reset()
                info["final_info"] = final_info
            return observation, reward, terminated or truncated, info

        results = list(self._executor.map(run, range(self.count)))
        observations = stack([r[0] for r in results])
        rewards = np.array([r[1] for r in results], dtype=np.float32)
        dones = np.array([r[2] for r in results], dtype=np.float32)
        return observations, rewards, dones, [r[3] for r in results]

    def expert_actions(self) -> np.ndarray:
        return np.stack([env.last_expert_actions for env in self.envs])

    def set_config(self, config: EnvConfig) -> None:
        for env in self.envs:
            env.config = config

    def close(self) -> None:
        self._executor.shutdown(wait=True)
        for env in self.envs:
            env.close()


def stack(observations: list[dict[str, np.ndarray]]) -> dict[str, np.ndarray]:
    return {key: np.stack([obs[key] for obs in observations]) for key in observations[0]}
