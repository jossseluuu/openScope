"""Compact CMA-ES (Hansen, "The CMA Evolution Strategy: A Tutorial", 2016).

Works on the unit hypercube: candidates are clipped to [0, 1] and the caller maps
them to real parameter ranges.
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np


class CMAES:
    def __init__(
        self,
        mean: np.ndarray,
        sigma: float = 0.2,
        population_size: Optional[int] = None,
        seed: int = 0,
    ) -> None:
        self.dimension = n = len(mean)
        self.mean = np.clip(np.asarray(mean, dtype=float), 0.0, 1.0)
        self.sigma = sigma
        self.random = np.random.default_rng(seed)
        self.population_size = population_size or 4 + int(3 * math.log(n))
        self.parents = self.population_size // 2

        weights = math.log(self.parents + 0.5) - np.log(np.arange(1, self.parents + 1))
        self.weights = weights / weights.sum()
        self.mu_eff = 1.0 / np.sum(self.weights**2)

        self.c_sigma = (self.mu_eff + 2) / (n + self.mu_eff + 5)
        self.d_sigma = 1 + 2 * max(0.0, math.sqrt((self.mu_eff - 1) / (n + 1)) - 1) + self.c_sigma
        self.c_c = (4 + self.mu_eff / n) / (n + 4 + 2 * self.mu_eff / n)
        self.c_1 = 2 / ((n + 1.3) ** 2 + self.mu_eff)
        self.c_mu = min(1 - self.c_1, 2 * (self.mu_eff - 2 + 1 / self.mu_eff) / ((n + 2) ** 2 + self.mu_eff))
        self.chi_n = math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n))

        self.path_sigma = np.zeros(n)
        self.path_c = np.zeros(n)
        self.covariance = np.eye(n)
        self.generation = 0
        self._samples: Optional[np.ndarray] = None

    def ask(self) -> np.ndarray:
        """Candidates of the next generation, one per row, inside [0, 1]."""
        eigenvalues, eigenvectors = np.linalg.eigh(self.covariance)
        scale = eigenvectors @ np.diag(np.sqrt(np.maximum(eigenvalues, 1e-20)))
        z = self.random.standard_normal((self.population_size, self.dimension))
        self._samples = self.mean + self.sigma * z @ scale.T
        return np.clip(self._samples, 0.0, 1.0)

    def tell(self, costs: np.ndarray) -> None:
        """Update the distribution with the cost of each candidate (lower is better)."""
        assert self._samples is not None, "call ask() first"
        n = self.dimension
        order = np.argsort(costs)
        # the clipped candidates are the ones that were evaluated
        selected = np.clip(self._samples[order[: self.parents]], 0.0, 1.0)
        previous_mean = self.mean
        self.mean = self.weights @ selected

        eigenvalues, eigenvectors = np.linalg.eigh(self.covariance)
        inverse_sqrt = eigenvectors @ np.diag(1 / np.sqrt(np.maximum(eigenvalues, 1e-20))) @ eigenvectors.T
        step = (self.mean - previous_mean) / self.sigma

        self.path_sigma = (1 - self.c_sigma) * self.path_sigma + math.sqrt(
            self.c_sigma * (2 - self.c_sigma) * self.mu_eff
        ) * inverse_sqrt @ step
        norm = np.linalg.norm(self.path_sigma)
        stalled = norm / math.sqrt(1 - (1 - self.c_sigma) ** (2 * (self.generation + 1))) / self.chi_n < 1.4 + 2 / (n + 1)
        self.path_c = (1 - self.c_c) * self.path_c + (
            math.sqrt(self.c_c * (2 - self.c_c) * self.mu_eff) * step if stalled else 0
        )

        deviations = (selected - previous_mean) / self.sigma
        rank_mu = sum(w * np.outer(d, d) for w, d in zip(self.weights, deviations))
        self.covariance = (
            (1 - self.c_1 - self.c_mu) * self.covariance
            + self.c_1 * (np.outer(self.path_c, self.path_c) + (0 if stalled else self.c_c * (2 - self.c_c)) * self.covariance)
            + self.c_mu * rank_mu
        )
        self.covariance = (self.covariance + self.covariance.T) / 2
        self.sigma *= math.exp((self.c_sigma / self.d_sigma) * (norm / self.chi_n - 1))
        self.sigma = float(np.clip(self.sigma, 1e-4, 0.5))
        self.generation += 1
