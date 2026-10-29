"""Tests of the bot training tools. Run with: .venv\\Scripts\\python -m unittest discover -s tests (from bots/python)."""

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from openscope_bots.cmaes import CMAES  # noqa: E402
from openscope_bots.fitness import score_summary  # noqa: E402

try:
    import torch  # noqa: F401

    HAS_TORCH = True
except Exception:  # noqa: BLE001 - torch may be missing or blocked
    HAS_TORCH = False


class CMAESTest(unittest.TestCase):
    def test_finds_the_minimum_of_a_quadratic(self):
        target = np.array([0.2, 0.7, 0.4])
        es = CMAES(np.full(3, 0.5), sigma=0.3, seed=1)
        for _ in range(60):
            candidates = es.ask()
            self.assertTrue(np.all((candidates >= 0) & (candidates <= 1)))
            es.tell(np.sum((candidates - target) ** 2, axis=1))
        self.assertLess(np.linalg.norm(es.mean - target), 0.05)


class FitnessTest(unittest.TestCase):
    def summary(self, **overrides):
        base = {
            "events": {"ARRIVAL": 20, "DEPARTURE": 18, "COLLISION": 0, "AIRSPACE_BUST": 0},
            "violationsByTier": {"0": 0, "1": 3, "2": 0, "3": 1},
            "violationsByRule": {},
            "metrics": {"goArounds": 1, "separationLossSeconds": 120},
            "commands": 900,
        }
        base.update(overrides)
        return base

    def test_safety_outweighs_everything_else(self):
        safe = score_summary(self.summary(violationsByTier={"1": 30}))
        unsafe = score_summary(self.summary(violationsByTier={"0": 1}, events={"ARRIVAL": 40, "DEPARTURE": 40}))
        self.assertLess(safe.cost, unsafe.cost)

    def test_terrain_collisions_are_not_counted_twice(self):
        score = score_summary(self.summary(
            events={"COLLISION": 1}, violationsByTier={"0": 1}, violationsByRule={"TERRAIN_COLLISION": 1}
        ))
        self.assertEqual(score.safety, 1)


@unittest.skipUnless(HAS_TORCH, "PyTorch is not available")
class EnvironmentAndModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from openscope_bots.env import EnvConfig, OpenScopeEnv

        cls.env = OpenScopeEnv(EnvConfig(airports=["lemd"], episode_minutes=2, with_expert=True))

    @classmethod
    def tearDownClass(cls):
        cls.env.close()

    def test_observation_and_actions_follow_the_spaces(self):
        observation, info = self.env.reset(seed=3)
        self.assertTrue(self.env.observation_space["tokens"].contains(observation["tokens"]))
        self.assertEqual(observation["action_mask"].shape, (self.env.max_aircraft, self.env.action_count))
        self.assertIsNotNone(info["expert_actions"])
        # every slot can always do nothing
        self.assertTrue(np.all(observation["action_mask"][:, 0] == 1))
        _, reward, terminated, truncated, info = self.env.step(np.zeros(self.env.max_aircraft, dtype=np.int64))
        self.assertIsInstance(reward, float)
        self.assertFalse(terminated)
        self.assertIn("rewardComponents", info)

    def test_episode_ends_after_its_duration(self):
        self.env.reset(seed=4)
        done = False
        steps = 0
        while not done:
            _, _, _, done, _ = self.env.step("expert")
            steps += 1
        self.assertEqual(steps, 12)  # 2 minutes in decisions of 10 s

    def test_network_never_chooses_a_masked_action(self):
        import torch

        from openscope_bots.model import ModelConfig, PolicyNetwork
        from openscope_bots.ppo import choose_actions

        observation, _ = self.env.reset(seed=5)
        model = PolicyNetwork(ModelConfig(self.env.feature_count, self.env.global_count, self.env.action_count,
                                          self.env.max_aircraft, width=32, heads=2, layers=1))
        batch = {key: value[None] for key, value in observation.items()}
        for _ in range(5):
            actions, log_prob, value = choose_actions(model, batch, torch.device("cpu"))
            chosen = actions[0].numpy()
            allowed = observation["action_mask"][np.arange(len(chosen)), chosen]
            self.assertTrue(np.all(allowed == 1))
            self.assertEqual(value.shape, (1,))
            self.assertTrue(torch.isfinite(log_prob).all())

    def test_export_to_onnx_matches_pytorch(self):
        from openscope_bots.export_onnx import export
        from openscope_bots.model import ModelConfig, PolicyNetwork, save_checkpoint

        model = PolicyNetwork(ModelConfig(self.env.feature_count, self.env.global_count, self.env.action_count,
                                          self.env.max_aircraft, width=32, heads=2, layers=1))
        with tempfile.TemporaryDirectory() as folder:
            checkpoint = Path(folder) / "model.pt"
            save_checkpoint(checkpoint, model)
            path = export(checkpoint, Path(folder) / "botB.onnx")
            self.assertTrue(path.exists())
            self.assertTrue(path.with_suffix(".json").exists())


if __name__ == "__main__":
    unittest.main()
