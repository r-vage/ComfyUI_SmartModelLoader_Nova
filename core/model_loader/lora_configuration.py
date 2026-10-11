"""Ordered LoRA rows with a shared patch mode and independent strengths."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .configuration import (
    boolean,
    choice,
    configuration_value,
    number,
    object_fields,
    resource,
    validate_fields,
    validate_rows,
)
from .validation import ResolvedModelFile, resolve_model_file

MAX_STACK_ROWS = 60
STACK_TYPE = "SML2_LORA_STACK"


def lora_editor_spec():
    return {"profile": "lora", "maxLoras": MAX_STACK_ROWS,
            "modes": {"model": "Model", "clip": "CLIP split", "audio": "Audio (LTX)"}}


def default_lora_configuration():
    return {"version": 1, "mode": "model", "entries": [], "integrity": "off"}


def validate_lora_configuration(raw, *, require_files=False, preset=False):
    config = configuration_value(raw)
    object_fields(config, ["version", "mode", "entries", *([] if preset else ["integrity"])], path="LoRA configuration")
    if type(config["version"]) is not int or config["version"] != 1:
        raise ValueError("Unsupported LoRA configuration version; expected version 1")
    validate_fields({"mode": config["mode"]}, {"mode": choice("Mode", list(lora_editor_spec()["modes"]))},
                    path="LoRA configuration")
    rows = config["entries"]
    if not isinstance(rows, list) or len(rows) > MAX_STACK_ROWS:
        raise ValueError(f"LoRA Stack supports at most {MAX_STACK_ROWS} rows per node")
    for index, row in enumerate(rows):
        label = f"LoRA {index + 1}"
        fields = {"enabled": boolean("Enabled", True),
                  **{key: number("Strength", 1.0, -100, 100, .01)
                     for key in ("strength", "clipStrength", "audioStrength")}}
        object_fields(row, ["id", "resource", *fields], path=label)
        validate_fields({key: row[key] for key in fields}, fields, path=label)
        empty_slot = isinstance(row["resource"], dict) and row["resource"].get("name") == ""
        resource(row["resource"], path=label, require_name=require_files and row["enabled"] and not empty_slot)
    validate_rows([{"id": row["id"], "resource": row["resource"]} for row in rows],
                  path="entries", require_files=False)
    if not preset and config["integrity"] not in ("off", "verify", "sidecar"):
        raise ValueError("Unsupported local integrity policy")
    return config


@dataclass(frozen=True)
class LoraConfigurationRequest:
    config: dict[str, Any]
    files: dict[str, ResolvedModelFile]
    resources: dict[str, dict[str, Any]]

    @classmethod
    def parse(cls, raw):
        config = validate_lora_configuration(raw, require_files=True)
        resources = {row["id"]: row["resource"] for row in config["entries"]
                     if row["enabled"] and row["resource"]["name"]}
        files = {key: resolve_model_file("loras", value["name"], reference_type="lora")
                 for key, value in resources.items()}
        return cls(config, files, resources)


@dataclass(frozen=True)
class LoraStackEntry:
    """Runtime-only payload; distinct socket type prevents lossy three-tuple consumers."""

    row: dict[str, Any]
    mode: str
    integrity: str


def runtime_row(row, mode):
    """Project the shared mode into the existing application target contract."""
    return {"id": row["id"], "resource": row["resource"], "enabled": row["enabled"],
            "mode": "ltx" if mode == "audio" else "standard", "targets": {
                "model": {"enabled": True, "strength": row["strength"]},
                "clip": {"enabled": mode == "clip", "strength": row["clipStrength"]},
                "audio": {"enabled": mode == "audio", "strength": row["audioStrength"]},
            }}


def build_lora_stack(configuration):
    request = LoraConfigurationRequest.parse(configuration)
    return [LoraStackEntry(row, request.config["mode"], request.config["integrity"])
            for row in request.config["entries"] if row["id"] in request.files]
