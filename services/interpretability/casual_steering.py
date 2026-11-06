"""
Week 3 milestone: proving the known-direction is CAUSAL, not merely
correlational. This is the single most important result in your part of
the project — it's what separates "we found a pattern" from "we found the
mechanism." Save transcripts from this module for the demo.

Method: add a forward hook that adds (or subtracts) alpha * direction to the
residual stream at the calibrated layer, for every token position, during
generation. Then compare generations with and without the intervention.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import torch

from model_loader import LoadedModel
from sae_probe import _load_known_direction  # reuse the same normalization logic
from config import get_settings

logger = logging.getLogger("interpretability.causal_steering")


@dataclass
class SteeringResult:
    prompt: str
    alpha: float
    baseline_generation: str
    steered_generation: str


class _ResidualSteeringHook:
    """
    Callable hook object (rather than a closure) so it's trivially
    inspectable/testable and so multiple hooks never accidentally share
    mutable state.
    """

    def __init__(self, direction: torch.Tensor, alpha: float):
        self.direction = direction
        self.alpha = alpha

    def __call__(self, resid, hook):  # transformer_lens hook signature
        return resid + self.alpha * self.direction


def _generate(model, prompt: str, max_new_tokens: int, hook_name: str | None = None, hook_fn=None) -> str:
    tokens = model.to_tokens(prompt)
    if hook_name is not None and hook_fn is not None:
        with model.hooks(fwd_hooks=[(hook_name, hook_fn)]):
            output = model.generate(tokens, max_new_tokens=max_new_tokens, do_sample=False, verbose=False)
    else:
        output = model.generate(tokens, max_new_tokens=max_new_tokens, do_sample=False, verbose=False)
    return model.to_string(output[0])


def run_steering_experiment(
    loaded: LoadedModel,
    prompt: str,
    alpha: float,
    max_new_tokens: int = 60,
) -> SteeringResult:
    """
    Positive alpha pushes the model toward "I know this" on an entity it
    doesn't actually know — watch it start hallucinating confidently.
    Negative alpha does the reverse on an entity it does know — watch it
    become uncertain or refuse. Try both directions and keep the transcripts.
    """
    settings = get_settings()
    direction_np = _load_known_direction(settings.probe_artifact_path)
    direction = torch.tensor(direction_np, device=loaded.device, dtype=torch.float32)
    hook_name = f"blocks.{loaded.layer}.hook_resid_post"

    baseline = _generate(loaded.model, prompt, max_new_tokens)
    hook = _ResidualSteeringHook(direction=direction, alpha=alpha)
    steered = _generate(loaded.model, prompt, max_new_tokens, hook_name=hook_name, hook_fn=hook)

    return SteeringResult(prompt=prompt, alpha=alpha, baseline_generation=baseline, steered_generation=steered)


if __name__ == "__main__":
    import argparse
    from model_loader import load_model_and_sae

    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Run a causal steering experiment and print before/after.")
    parser.add_argument("--prompt", required=True, help='e.g. "Tell me about Corvin Thistlewood."')
    parser.add_argument("--alpha", type=float, required=True, help="Positive to induce, negative to suppress.")
    parser.add_argument("--max-new-tokens", type=int, default=60)
    args = parser.parse_args()

    loaded_model = load_model_and_sae()
    result = run_steering_experiment(loaded_model, args.prompt, args.alpha, args.max_new_tokens)

    print("=" * 60)
    print(f"PROMPT: {result.prompt}")
    print(f"ALPHA:  {result.alpha}")
    print("-" * 60)
    print("BASELINE:\n", result.baseline_generation)
    print("-" * 60)
    print("STEERED:\n", result.steered_generation)
    print("=" * 60)