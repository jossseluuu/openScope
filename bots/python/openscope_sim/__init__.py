"""Python access to the openScope headless simulator."""

from .client import SimulatorClient, SimulatorError

__all__ = ["SimulatorClient", "SimulatorError"]
