"""A pool of headless simulators that run episodes in parallel.

Each simulator is its own Node.js process, so Python threads are enough: they
only wait on the pipes while the simulators compute.
"""

from __future__ import annotations

import queue
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Iterable, TypeVar

from openscope_sim import SimulatorClient

T = TypeVar("T")
R = TypeVar("R")


class SimulatorPool:
    def __init__(self, size: int) -> None:
        self.size = size
        self._clients: queue.Queue[SimulatorClient] = queue.Queue()
        self._all = [SimulatorClient() for _ in range(size)]
        for client in self._all:
            self._clients.put(client)
        self._executor = ThreadPoolExecutor(max_workers=size)

    def map(self, function: Callable[[SimulatorClient, T], R], items: Iterable[T]) -> list[R]:
        """Apply `function(client, item)` to every item, using a free simulator for each."""

        def run(item: T) -> R:
            client = self._clients.get()
            try:
                return function(client, item)
            finally:
                self._clients.put(client)

        return list(self._executor.map(run, items))

    def close(self, wait: bool = True) -> None:
        self._executor.shutdown(wait=wait, cancel_futures=not wait)
        for client in self._all:
            client.close()

    def __enter__(self) -> "SimulatorPool":
        return self

    def __exit__(self, exc_type: Any, *exc_info: Any) -> None:
        # On an error or Ctrl+C, don't wait for queued episodes.
        self.close(wait=exc_type is None)
