"""Lexicographic cost of an episode, shared by Bot A tuning and the A vs B comparison.

The tiers of the Rulebook are kept apart by large weights, so no amount of
efficiency can compensate for a safety or separation violation.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable

TIER_WEIGHTS = {"safety": 1e6, "separation": 1e4, "procedure": 1e2, "efficiency": 1.0}


@dataclass
class EpisodeScore:
    safety: float
    separation: float
    procedure: float
    efficiency: float
    landings: int
    departures: int
    go_arounds: int
    commands: int

    @property
    def cost(self) -> float:
        return (
            TIER_WEIGHTS["safety"] * self.safety
            + TIER_WEIGHTS["separation"] * self.separation
            + TIER_WEIGHTS["procedure"] * self.procedure
            + TIER_WEIGHTS["efficiency"] * self.efficiency
        )

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "cost": self.cost}


def score_summary(summary: dict[str, Any]) -> EpisodeScore:
    """Score the summary of a bot episode (`runBotEpisode` or `evaluate`)."""
    events = summary.get("events", {})
    tiers = {int(k): v for k, v in summary.get("violationsByTier", {}).items()}
    metrics = summary.get("metrics", {})
    # engine collisions between aircraft are not in the Rulebook; terrain ones are in both
    rule_counts = summary.get("violationsByRule", {})
    aircraft_collisions = max(0, events.get("COLLISION", 0) - rule_counts.get("TERRAIN_COLLISION", 0))
    landings = events.get("ARRIVAL", 0)
    departures = events.get("DEPARTURE", 0)
    go_arounds = metrics.get("goArounds", 0)

    safety = tiers.get(0, 0) + aircraft_collisions + events.get("AIRSPACE_BUST", 0)
    separation = tiers.get(1, 0) + metrics.get("separationLossSeconds", 0) / 600
    procedure = (
        tiers.get(2, 0)
        + events.get("NOT_CLEARED_ON_ROUTE", 0)
        + events.get("LOCALIZER_INTERCEPT_ABOVE_GLIDESLOPE", 0)
    )
    efficiency = (
        20 * go_arounds
        - 30 * (landings + departures)
        + (metrics.get("averageArrivalTimeInAirspaceSeconds") or 0) / 60
        + (metrics.get("averageHoldingPointWaitSeconds") or 0) / 60
        + 0.01 * summary.get("commands", 0)
    )

    return EpisodeScore(
        safety=safety,
        separation=separation,
        procedure=procedure,
        efficiency=efficiency,
        landings=landings,
        departures=departures,
        go_arounds=go_arounds,
        commands=summary.get("commands", 0),
    )


def mean_cost(scores: Iterable[EpisodeScore]) -> float:
    scores = list(scores)
    return sum(score.cost for score in scores) / max(1, len(scores))
