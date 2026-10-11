"""Read v1 Smart Loader templates as structured presets without changing their files."""

from __future__ import annotations

import copy
import json
from pathlib import PurePosixPath

from .configuration import (
    DIMENSIONS,
    MAX_CONFIGURATION_BYTES,
    MODES,
    SAMPLER,
    SAMPLING,
    default_configuration,
    defaults,
    editor_spec,
    supports_flux,
    validate_configuration,
)

MODEL_FIELDS = {
    "Standard Checkpoint": ("checkpoint", "ckpt_name"),
    "UNet Model": ("unet", "unet_name"),
    "GGUF Model": ("gguf", "gguf_name"),
    "Nunchaku Flux": ("nunchaku-flux", "nunchaku_name"),
    "Nunchaku Qwen": ("nunchaku-qwen", "qwen_name"),
    "Nunchaku ZImage": ("nunchaku-zimage", "zimage_name"),
}


def convert_model(template: dict, *, spec: dict | None = None) -> dict:
    """Keep primary model settings and file-bound identity, excluding optional sections."""
    if not isinstance(template, dict):
        raise TypeError("Template must be an object")
    if "model" in template or "version" in template:
        raise ValueError("Expected a v1 Smart Loader template")
    model_type = template.get("model_type")
    if not isinstance(model_type, str) or model_type not in MODEL_FIELDS:
        raise ValueError("Unsupported v1 model type")
    kind, field = MODEL_FIELDS[model_type]
    config = default_configuration()
    config.pop("clip")
    config.pop("vae")
    config.pop("memory")
    config.pop("integrity")
    model = config["model"]
    model.update(kind=kind, resource=_resource(template, field, MODES[kind]["role"]),
                 options=defaults(MODES[kind]["options"]))
    model["attentionBackend"] = template.get(
        "attention_backend", template.get("model_attention", model["attentionBackend"]),
    )
    for option in model["options"]:
        old_key = f"gguf_{option}" if kind == "gguf" else option
        if old_key in template:
            value = copy.deepcopy(template[old_key])
            if option == "use_pin_memory" and value in ("enable", "disable"):
                value = value == "enable"
            model["options"][option] = value

    # air_or_hash and download_locators can describe a previous picker target.
    # They do not bind a reference to this model filename and are not copied.
    return validate_configuration(config, preset=True, spec=spec)


def convert_template(template: dict, *, spec: dict | None = None) -> dict:
    """Convert enabled v1 sections, keeping Latent, Advanced and seed node-local."""
    spec = spec or editor_spec()
    config = convert_model(template, spec=spec)
    selected = _selected(template)
    _components(template, selected, config)

    if "sampler" in selected:
        sampler = _fields(template, SAMPLER)
        sampler.update(sampler_name=template.get("sampler_name", "euler"),
                       scheduler=template.get("scheduler", "normal"))
        if supports_flux(config):
            sampler["flux_guidance"] = template.get("flux_guidance", 3.5)
        config["sampler"] = sampler

    if "model_sampling" in selected:
        method = template.get("sampling_method", "None")
        if not isinstance(method, str) or method not in SAMPLING:
            raise ValueError("Unsupported v1 model sampling method")
        sampling = {"method": method, "parameters": _fields(template, SAMPLING[method])}
        if method in {"Flux", "Qwen Image 2.1"} and "latent" not in selected:
            sampling["dimensions"] = _fields(template, DIMENSIONS, prefix="sampling_")
        config["modelSampling"] = sampling
    return validate_configuration(config, preset=True, spec=spec)


def _selected(template: dict) -> set:
    selected = template.get("features")
    if selected is not None:
        if not isinstance(selected, list) or not all(isinstance(item, str) for item in selected):
            raise ValueError("Template features must be a string array")
        selected = set(selected)
    else:
        flags = {"clip": "configure_clip", "vae": "configure_vae", "audio_vae": "configure_audio_vae",
                 "latent": "configure_latent", "sampler": "configure_sampler", "lora": "configure_model_only_lora",
                 "model_sampling": "configure_model_sampling"}
        selected = {key for key, flag in flags.items() if _flag(template, flag, key in {"clip", "vae"})}
    return selected


def _components(template: dict, selected: set, config: dict) -> None:
    if "clip" in selected:
        source = _source(template, "clip_source", "Baked", combined=True)
        # v1 applies its layer override only to baked encoders.
        skip = (template.get("stop_at_clip_layer", -2)
                if source == "baked" and _flag(template, "enable_clip_layer", True) else None)
        clip = {"source": source, "skip": skip}
        if source != "baked":
            clip.update(type=template.get("clip_type", "flux"), encoders=[
                {"id": f"clip-{index}", "resource": _resource(template, f"clip_name{index}", "clip")}
                for index in range(1, _count(template, "clip_count", 4) + 1)
            ])
        config["clip"] = clip

    for feature, key, prefix in (("vae", "vae", "vae"), ("audio_vae", "audioVae", "audio_vae")):
        if feature not in selected:
            continue
        source = _source(template, f"{prefix}_source", "Baked" if feature == "vae" else "External")
        config[key] = {"source": source}
        if source == "external":
            config[key]["resource"] = _resource(template, f"{prefix}_name", "vae")

    if "lora" in selected:
        config["loras"] = {"entries": _loras(template)}


def _loras(template: dict) -> list:
    entries = []
    for index in range(1, _count(template, "lora_count", 3) + 1):
        if not _flag(template, f"lora_switch_{index}", True):
            continue
        resource = _resource(template, f"lora_name_{index}", "loras")
        if resource["name"]:
            entries.append({"id": f"lora-{index}", "resource": resource,
                            "strength": template.get(f"lora_weight_{index}", 1.0)})
    return entries


def _fields(template: dict, fields: dict, *, prefix: str = "") -> dict:
    return {key: copy.deepcopy(template.get(f"{prefix}{key}", value)) for key, value in defaults(fields).items()}


def _flag(template: dict, field: str, default: bool) -> bool:
    value = template.get(field, default)
    if type(value) is not bool:
        raise ValueError(f"{field} must be boolean")
    return value


def _source(template: dict, field: str, default: str, *, combined: bool = False) -> str:
    choices = {"Baked": "baked", "External": "external"}
    if combined:
        choices["External + Model File"] = "combined"
    value = template.get(field, default)
    if not isinstance(value, str) or value not in choices:
        raise ValueError(f"Unsupported v1 {field}")
    return choices[value]


def _count(template: dict, field: str, maximum: int) -> int:
    value = template.get(field, 1)
    if isinstance(value, str) and value.isdecimal():
        value = int(value)
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError(f"{field} must be between 1 and {maximum}")
    return value


def _resource(template: dict, field: str, role: str) -> dict:
    name = template.get(field, "")
    if name in (None, "None"):
        name = ""
    if not isinstance(name, str):
        raise TypeError(f"{field} must be a string")
    name = name.replace("\\", "/")
    resource = {"name": name}
    identity = _bound_identity(template, name, field, role) if name else {}
    if identity.get("sha256") not in (None, ""):
        if not isinstance(identity["sha256"], str):
            raise TypeError("Expected SHA-256 must be a string")
        resource["sha256"] = identity["sha256"].lower()
    if identity.get("air") not in (None, ""):
        resource["source"] = {"provider": "civitai", "reference": identity["air"]}
    return resource


def _bound_identity(template: dict, name: str, field: str, role: str) -> dict:
    expected = template.get("expected_hashes", {})
    if isinstance(expected, str):
        if len(expected.encode("utf-8")) > MAX_CONFIGURATION_BYTES:
            raise ValueError("Template metadata exceeds its size limit")
        expected = json.loads(expected)
    if not isinstance(expected, dict) or not all(isinstance(key, str) for key in expected):
        raise TypeError("Template expected_hashes must be an object")
    expected = {key.replace("\\", "/"): value for key, value in expected.items()}
    keys = [f"{role}:{name}"]
    if role == "diffusion_models_gguf":
        keys.append(f"diffusion_models:{name}")
    elif role == "clip":
        keys.append(f"text_encoders:{name}")
    # Older templates used basenames. Only accept that identity when no other
    # selected file with the same basename has a different relative path.
    basename = PurePosixPath(name).name
    other_paths = [value.replace("\\", "/") for key, value in template.items()
                   if isinstance(value, str) and ("name" in key) and key != field]
    if "/" in name and name not in other_paths:
        keys.append(name)
    if not any(PurePosixPath(value).name == basename for value in other_paths):
        keys.extend([name, basename])
    identity = next((expected[key] for key in keys if key in expected), {})
    if not isinstance(identity, dict):
        raise TypeError("Expected model identity must be an object")
    return identity
