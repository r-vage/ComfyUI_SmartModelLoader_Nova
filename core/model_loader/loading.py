# Shared result contract for structured diffusion loading.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class LoadResult:
    model: Any
    clip: Any
    vae: Any
    audio_vae: Any
    model_name: str
    lora_names: str
    pipe: dict[str, Any] | None = None
