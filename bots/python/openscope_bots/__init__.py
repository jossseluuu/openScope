"""Bots for the openScope headless simulator.

- Bot A (expert + metaheuristics) runs in JavaScript; this package tunes and evaluates it.
- Bot B (reinforcement learning) is trained here with PyTorch and exported to ONNX.

Modules that need PyTorch import it lazily, so tuning Bot A works with numpy only.
"""
