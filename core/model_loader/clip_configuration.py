"""Configuration for the standalone CLIP editor; no diffusion-model options."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import comfy.sd

from ..gguf_wrapper import GGUF_AVAILABLE
from .configuration import (
    choice,
    configuration_value,
    object_fields,
    validate_fields,
    validate_rows,
)
from .validation import ResolvedModelFile, get_clip_type_options, resolve_clip_file


def clip_editor_spec():
    return {
        "profile": "clip", "clipTypes": list(get_clip_type_options(comfy.sd.CLIPType)),
        "ggufAvailable": GGUF_AVAILABLE,
    }


def default_clip_configuration():
    types = get_clip_type_options(comfy.sd.CLIPType)
    return {
        "version": 1, "clip": {"type": "flux" if "flux" in types else types[0],
                             "encoders": [{"id": "encoder-1", "resource": {"name": ""}}]},
        "integrity": "off",
    }


def validate_clip_configuration(raw, *, spec=None, require_files=False):
    config = configuration_value(raw)
    object_fields(config, ["version", "clip", "integrity"], path="CLIP configuration")
    if type(config["version"]) is not int or config["version"] != 1:
        raise ValueError("Unsupported CLIP configuration version; expected version 1")
    spec = spec or clip_editor_spec()
    clip = config["clip"]
    object_fields(clip, ["type", "encoders"], path="clip")
    validate_fields({"type": clip["type"]}, {"type": choice("Encoder type", spec["clipTypes"])}, path="clip")
    entries = clip["encoders"]
    if not isinstance(entries, list) or not entries:
        raise ValueError("CLIP requires at least one encoder")
    validate_rows(entries, path="clip.encoders", require_files=require_files)
    if require_files and not spec["ggufAvailable"] and any(
        entry["resource"]["name"].lower().endswith(".gguf") for entry in entries
    ):
        raise ValueError("GGUF text encoder support is not installed")
    if config["integrity"] not in ("off", "verify", "sidecar"):
        raise ValueError("Unsupported local integrity policy")
    return config


@dataclass(frozen=True)
class ClipConfigurationRequest:
    config: dict[str, Any]
    files: dict[str, ResolvedModelFile]
    resources: dict[str, dict[str, Any]]

    @classmethod
    def parse(cls, raw):
        config = validate_clip_configuration(raw, require_files=True)
        resources = {f"clip:{row['id']}": row["resource"] for row in config["clip"]["encoders"]}
        files = {key: resolve_clip_file(resource["name"]) for key, resource in resources.items()}
        return cls(config, files, resources)
