"""Smoke tests for the simulator bridge. Run with: python -m unittest discover bots/python/tests"""

import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from openscope_sim import SimulatorClient, SimulatorError  # noqa: E402


def fingerprint(observation):
    stable = {k: v for k, v in observation.items() if k not in ("radio", "scoreEvents")}
    for aircraft in stable["aircraft"]:
        aircraft.pop("id", None)  # internal counter, not part of the simulated state
    return hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()


def run_episode(sim, seed, minutes=5):
    sim.reset("lemd", seed=seed)
    observation = None
    for _ in range(minutes):
        observation, _ = sim.step(60)
    return fingerprint(observation)


class SimulatorClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sim = SimulatorClient()

    @classmethod
    def tearDownClass(cls):
        cls.sim.close()

    def test_same_seed_is_reproducible(self):
        self.assertEqual(run_episode(self.sim, 3), run_episode(self.sim, 3))

    def test_different_seeds_differ(self):
        self.assertNotEqual(run_episode(self.sim, 3), run_episode(self.sim, 4))

    def test_departure_needs_clearance_and_obeys_it(self):
        observation = self.sim.reset("lemd", seed=1)
        departure = next(a for a in observation["aircraft"] if a["category"] == "departure")
        callsign = departure["callsign"]

        observation, _ = self.sim.step(60)
        self.assertEqual(self._find(observation, callsign)["flightPhase"], "APRON")

        _, results = self.sim.step(1, [(callsign, "caf"), (callsign, "taxi 36L"), (callsign, "cvs")])
        self.assertTrue(all(r["success"] for r in results), results)

        # LEMD taxi times are long: up to 12.5 minutes to 36L
        for _ in range(60):
            observation, _ = self.sim.step(15)
            if self._find(observation, callsign)["flightPhase"] == "WAITING":
                break
        _, results = self.sim.step(120, [(callsign, "cto")])
        self.assertTrue(results[0]["success"], results)
        observation = self.sim.observe()
        self.assertGreater(self._find(observation, callsign)["altitude"], 3000)

    def test_wind_selects_the_runway_configuration(self):
        observation = self.sim.reset("lemd", seed=1)
        self.assertEqual(observation["airport"]["runwayConfiguration"], "north")
        self.assertEqual(observation["airport"]["arrivalRunway"], "32L")

        observation = self.sim.reset("lemd", seed=1, wind=(180, 15))
        self.assertEqual(observation["airport"]["runwayConfiguration"], "south")
        self.assertEqual(observation["airport"]["arrivalRunway"], "18R")
        self.assertEqual(observation["airport"]["departureRunway"], "14L")
        departures = [a for a in observation["aircraft"] if a["category"] == "departure"]
        self.assertTrue(departures)
        self.assertTrue(all(a["route"].startswith("LEMD14") for a in departures))

    def test_observation_includes_realism(self):
        observation = self.sim.reset("lemd", seed=1)
        realism = observation["realism"]
        self.assertEqual(realism["regulatoryProfile"], "EASA")
        self.assertEqual(realism["wakeScheme"], "RECAT_EU")
        self.assertEqual(realism["separationMinima"]["finalApproachNm"], 2.5)
        self.assertIn("metrics", realism)
        self.assertEqual(observation["violations"], [])
        aircraft = observation["aircraft"][0]
        self.assertIn(aircraft["recatEu"], "ABCDEF")
        self.assertEqual(aircraft["wakeCategory"], aircraft["recatEu"])
        self.assertEqual(aircraft["minimumVectoringAltitude"] % 100, 0)

    def test_go_around_requires_an_approach(self):
        observation = self.sim.reset("lemd", seed=1)
        departure = next(a for a in observation["aircraft"] if a["category"] == "departure")
        result = self.sim.command(departure["callsign"], "ga")
        self.assertFalse(result["success"])
        self.assertIn("not on approach", result["message"])

    def test_invalid_command_is_reported(self):
        self.sim.reset("lemd", seed=1)
        self.assertFalse(self.sim.command("NOPE123", "fh 090")["success"])

    def test_unknown_method_raises(self):
        with self.assertRaises(SimulatorError):
            self.sim._call("bogus")

    @staticmethod
    def _find(observation, callsign):
        return next(a for a in observation["aircraft"] if a["callsign"] == callsign)


if __name__ == "__main__":
    unittest.main()
