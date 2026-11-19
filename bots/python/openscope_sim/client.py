"""Python client for the openScope headless simulator (tools/sim/server.js).

The simulator runs in a Node.js child process and is driven through a JSON-lines
protocol on stdin/stdout. Each `SimulatorClient` owns one independent simulator, so
several can run in parallel (one per CPU core) for training.

Example:
    with SimulatorClient() as sim:
        obs = sim.reset("lemd", seed=1)
        obs, results = sim.step(5.0, [("IBE3141", "fh 270 d 70")])
"""

from __future__ import annotations

import itertools
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SCRIPT = REPO_ROOT / "tools" / "sim" / "server.js"

Observation = dict[str, Any]
CommandResult = dict[str, Any]


def wind_param(wind: Any) -> dict[str, float]:
    """Accept (direction, speed) or {"angle", "speed"}."""
    if isinstance(wind, dict):
        return {"angle": float(wind["angle"]), "speed": float(wind["speed"])}
    return {"angle": float(wind[0]), "speed": float(wind[1])}


class SimulatorError(RuntimeError):
    """Raised when the simulator answers a request with an error."""


class SimulatorClient:
    """Owns one Node.js headless simulator process."""

    def __init__(
        self,
        step_seconds: float = 0.25,
        tower_controller: str = "USER",
        node_executable: str = "node",
    ) -> None:
        self._ids = itertools.count(1)
        # what Node writes to stderr is kept to explain why the simulator died (e.g. out of memory)
        self._stderr = tempfile.TemporaryFile()
        self._process = subprocess.Popen(
            [
                node_executable,
                str(SERVER_SCRIPT),
                "--step-seconds",
                str(step_seconds),
                "--tower",
                tower_controller,
            ],
            cwd=REPO_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        ready = self._read_message()
        if ready.get("result") != "ready":
            raise SimulatorError(f"simulator failed to start: {ready}")

    def reset(
        self,
        airport: str = "lemd",
        seed: int = 0,
        wind: Optional[tuple[float, float]] = None,
        traffic_scale: float = 1.0,
        emergency_rate: Optional[float] = None,
    ) -> Observation:
        """Start a new episode and return the first observation.

        `wind` is an optional (direction in degrees, speed in knots) surface wind that
        replaces the airport default; the runway configuration is chosen from it.
        `traffic_scale` multiplies the rate of every spawn pattern.
        `emergency_rate` is the probability that a flight declares an emergency (None: 0.01).
        """
        params: dict[str, Any] = {"airport": airport, "seed": seed, "trafficScale": traffic_scale,
                                  "emergencyRate": emergency_rate}
        if wind is not None:
            params["wind"] = wind_param(wind)
        return self._call("reset", params)

    def step(
        self, seconds: float, commands: Iterable[Sequence[str]] = ()
    ) -> tuple[Observation, list[CommandResult]]:
        """Issue `commands` as (callsign, text) pairs, then advance `seconds` of simulated time."""
        result = self._call(
            "step", {"seconds": seconds, "commands": [list(c) for c in commands]}
        )
        return result["observation"], result["commandResults"]

    def command(self, callsign: str, text: str) -> CommandResult:
        """Issue a single clearance without advancing time."""
        return self._call("command", {"callsign": callsign, "text": text})

    def observe(self) -> Observation:
        return self._call("observe")

    def airports(self) -> list[dict[str, Any]]:
        return self._call("airports")

    def run_bot_episode(
        self,
        bot: str = "A",
        airport: str = "lemd",
        seed: int = 0,
        minutes: float = 60,
        parameters: Optional[dict[str, float]] = None,
        wind: Optional[tuple[float, float]] = None,
        traffic_scale: float = 1.0,
        trace: bool = False,
        emergency_rate: Optional[float] = None,
    ) -> dict[str, Any]:
        """Let a JavaScript bot (Bot A) control a whole episode and return its summary."""
        return self._call(
            "runBotEpisode",
            {
                "bot": bot,
                "airport": airport,
                "seed": seed,
                "minutes": minutes,
                "parameters": parameters or {},
                "wind": wind_param(wind) if wind is not None else None,
                "trafficScale": traffic_scale,
                "emergencyRate": emergency_rate,
                "trace": trace,
            },
        )

    def bot_parameter_space(self) -> dict[str, dict[str, Any]]:
        """Bot A parameters with their default value and tuning range."""
        return self._call("botParameterSpace")

    def rl_spec(self) -> dict[str, Any]:
        """Sizes of the encoded observation and the action names."""
        return self._call("rlSpec")

    def rl_reset(self, **options: Any) -> dict[str, Any]:
        """Start a reinforcement learning episode; see `RlEnvironment.reset()`."""
        if options.get("wind") is not None:
            options["wind"] = wind_param(options["wind"])
        return self._call("rlReset", options)

    def rl_step(self, actions: Any) -> dict[str, Any]:
        """One action index per aircraft slot, or "expert" to let Bot A act."""
        return self._call("rlStep", {"actions": actions})

    def close(self) -> None:
        if self._process.poll() is None:
            try:
                self._call("close")
            except (SimulatorError, BrokenPipeError, OSError, ValueError):
                # the simulator is being shut down anyway; a garbled or missing goodbye doesn't matter
                pass
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait()
        for stream in (self._process.stdin, self._process.stdout, self._stderr):
            if stream is not None and not stream.closed:
                try:
                    stream.close()
                except OSError:
                    # Flushing into a dead process (e.g. after Ctrl+C reached it too) fails; nothing left to do.
                    pass

    def kill(self) -> None:
        """Stop the simulator without the protocol; safe while another thread is waiting on it."""
        if self._process.poll() is None:
            self._process.kill()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

    def __enter__(self) -> "SimulatorClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def _call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        request_id = next(self._ids)
        assert self._process.stdin is not None
        self._process.stdin.write(
            json.dumps({"id": request_id, "method": method, "params": params or {}}) + "\n"
        )
        self._process.stdin.flush()
        message = self._read_message()
        if message.get("id") != request_id:
            raise SimulatorError(f"out of order response: {message}")
        if "error" in message:
            raise SimulatorError(message["error"])
        return message["result"]

    def _read_message(self) -> dict[str, Any]:
        assert self._process.stdout is not None
        # Only protocol messages should arrive here, but a stray line (something in Node printing to
        # stdout) must not kill a training run that has been going for hours: skip it and report it.
        for _ in range(100):
            line = self._process.stdout.readline()
            if not line:
                raise SimulatorError(f"simulator process exited (code {self._process.poll()}){self._stderr_tail()}")
            try:
                message = json.loads(line)
            except ValueError:
                message = None
            if isinstance(message, dict):
                return message
            print(f"[openscope_sim] skipped non-protocol line from the simulator: {line[:300]!r}",
                  file=sys.stderr, flush=True)
        raise SimulatorError(f"simulator kept writing non-protocol lines{self._stderr_tail()}")

    def _stderr_tail(self, characters: int = 2000) -> str:
        """Last lines Node wrote to stderr, to explain why it stopped."""
        try:
            self._stderr.flush()
            self._stderr.seek(0, 2)
            size = self._stderr.tell()
            self._stderr.seek(max(0, size - characters))
            text = self._stderr.read().decode("utf-8", errors="replace").strip()
        except (OSError, ValueError):
            return ""
        return f":\n{text}" if text else ""
