"""Policy and value network of Bot B.

Each aircraft is a token. A transformer encoder lets every aircraft attend to
every other one (traffic, sequence, conflicts); a per-token head scores the
actions of that aircraft and a pooled head estimates the value of the state.
Forbidden actions (safety shield) get a very low logit, so they are never chosen.

The network has fixed-size inputs, so it exports to ONNX for the browser.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import torch
from torch import nn

MASKED_LOGIT = -1e9


@dataclass
class ModelConfig:
    feature_count: int
    global_count: int
    action_count: int
    max_aircraft: int
    width: int = 128
    heads: int = 4
    layers: int = 3

    def as_dict(self) -> dict:
        return asdict(self)


class PolicyNetwork(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        self.config = config
        width = config.width
        self.token_embedding = nn.Sequential(
            nn.Linear(config.feature_count, width), nn.ReLU(), nn.Linear(width, width)
        )
        self.global_embedding = nn.Linear(config.global_count, width)
        layer = nn.TransformerEncoderLayer(
            width, config.heads, dim_feedforward=2 * width, dropout=0.0, batch_first=True
        )
        self.encoder = nn.TransformerEncoder(layer, config.layers, enable_nested_tensor=False)
        self.policy_head = nn.Sequential(nn.Linear(width, width), nn.ReLU(), nn.Linear(width, config.action_count))
        self.value_head = nn.Sequential(nn.Linear(2 * width, width), nn.ReLU(), nn.Linear(width, 1))

    def forward(
        self,
        tokens: torch.Tensor,
        token_mask: torch.Tensor,
        action_mask: torch.Tensor,
        global_features: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        tokens [B, N, F], token_mask [B, N], action_mask [B, N, K], global_features [B, G]
        returns logits [B, N, K] and value [B]
        """
        present = token_mask > 0.5
        # a sequence with no aircraft at all would make attention undefined: keep slot 0
        padding = ~present
        padding[:, 0] = False
        global_embedded = self.global_embedding(global_features)
        hidden = self.token_embedding(tokens) + global_embedded.unsqueeze(1)
        hidden = self.encoder(hidden, src_key_padding_mask=padding)

        logits = self.policy_head(hidden)
        logits = logits.masked_fill(action_mask < 0.5, MASKED_LOGIT)

        weights = present.float().unsqueeze(-1)
        pooled = (hidden * weights).sum(1) / weights.sum(1).clamp(min=1.0)
        value = self.value_head(torch.cat([pooled, global_embedded], dim=-1)).squeeze(-1)
        return logits, value


def distribution_terms(logits: torch.Tensor, actions: torch.Tensor, action_mask: torch.Tensor):
    """Joint log-probability and mean entropy over the aircraft that have a real choice.

    The joint action of a state is one action per aircraft, chosen independently
    given the shared encoding, so its log-probability is the sum over aircraft.
    """
    log_probs = torch.log_softmax(logits, dim=-1)
    chosen = log_probs.gather(-1, actions.unsqueeze(-1)).squeeze(-1)
    has_choice = (action_mask > 0.5).sum(-1) > 1
    joint_log_prob = (chosen * has_choice).sum(-1)
    probs = log_probs.exp()
    entropy = -(probs * log_probs.clamp(min=-30)).sum(-1)
    mean_entropy = (entropy * has_choice).sum(-1) / has_choice.sum(-1).clamp(min=1)
    return joint_log_prob, mean_entropy, has_choice


def save_checkpoint(path, model: PolicyNetwork, extra: dict | None = None) -> None:
    torch.save({"model_config": model.config.as_dict(), "state_dict": model.state_dict(), **(extra or {})}, path)


def load_checkpoint(path, device: str | torch.device = "cpu") -> tuple[PolicyNetwork, dict]:
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    model = PolicyNetwork(ModelConfig(**checkpoint["model_config"])).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    return model, checkpoint
