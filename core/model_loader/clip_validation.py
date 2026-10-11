# Metadata-only validation for LTX model-supplied text projections.

from __future__ import annotations

import pickle

from .integrity import read_safetensors_header
from .validation import SAFE_TENSOR_EXTENSIONS, ResolvedModelFile

_LTX_PROJECTIONS = (
    ("text_embedding_projection.weight",),
    ("text_embedding_projection.aggregate_embed.weight",),
    ("text_embedding_projection.video_aggregate_embed.weight",
     "text_embedding_projection.audio_aggregate_embed.weight"),
)


def validate_ltx_projection(selected: ResolvedModelFile) -> None:
    """Check the resolved model without allocating or reading its weight payloads."""
    try:
        if selected.path.suffix.lower() in SAFE_TENSOR_EXTENSIONS:
            header = read_safetensors_header(selected.path)
            shapes = {key: entry.get("shape") for key, entry in header.items() if isinstance(entry, dict)}
        else:
            # Resolution already enforces the administrator's trusted-format policy.
            # Fake tensors preserve metadata inspection for those opt-in files.
            import comfy.utils
            import torch
            from torch._subclasses.fake_tensor import FakeTensorMode

            with FakeTensorMode():
                weights = comfy.utils.load_torch_file(str(selected.path), safe_load=True, device=torch.device("meta"))
                shapes = {key: list(tensor.shape) for key, tensor in weights.items()
                          if isinstance(tensor, torch.Tensor)}
        matrices = {key for key, shape in shapes.items()
                    if isinstance(shape, list) and len(shape) == 2
                    and all(type(size) is int and size > 0 for size in shape)}
    except (OSError, TypeError, ValueError, RuntimeError, pickle.UnpicklingError) as error:
        raise ValueError(f"Could not inspect LTX projection weights in {selected.relative_path}: {error}") from error
    if not any(all(key in matrices for key in group) for group in _LTX_PROJECTIONS):
        raise ValueError(
            f"LTX External + Model File: {selected.relative_path} has no complete text projection weights. "
            "Select an LTX model containing its text projections, or use External with a separate projection file.",
        )
