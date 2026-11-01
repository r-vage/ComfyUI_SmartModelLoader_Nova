"""Compose native settings with templates and the existing loader configuration."""

import copy
import json

from .configuration import (
    DIMENSIONS,
    MAX_SEED,
    MODES,
    SAMPLER,
    SAMPLING,
    component_sources,
    defaults,
    editor_spec,
    object_fields,
    resource,
    supports_flux,
    validate_configuration,
    validate_fields,
)
from .native_controls import INHERIT, NONE, native_fields
from .templates import is_safe_template_name, load_configuration_preset
from .validation import resolve_clip_file, resolve_model_file

UNCONNECTED = object()
LOCAL_SECTIONS = ("memory", "integrity", "seed", "latent", "localDenoise")


def validate_parameters(parameters, *, spec=None):
    fields = native_fields(spec)
    object_fields(parameters, [], fields, path="settings.parameters")
    result = {}
    for key, value in parameters.items():
        field = fields[key]
        kind = field["type"]
        if kind == "seed":
            if value is None:
                continue
            if type(value) is not int or not 0 <= value <= MAX_SEED:
                raise ValueError("Seed input must be an unsigned 64-bit integer")
        elif kind == "number":
            if type(value) in (int, float) and value == field["inherit"]:
                continue
            validate_fields({key: value}, {key: field}, path="settings")
        elif not isinstance(value, str):
            raise TypeError(f"{field['label']} must be text")
        elif value == INHERIT:
            continue
        elif kind == "file":
            if not (field["removable"] and value == NONE):
                selected = {"name": value}
                resource(selected, path=key, require_name=True)
                result[key] = selected["name"]
                continue
        elif kind == "template":
            if not is_safe_template_name(value):
                raise ValueError("Invalid template name")
        else:
            validate_fields({key: value}, {key: field}, path="settings")
        result[key] = value
    return result


def settings_parameters(value, *, spec=None):
    while isinstance(value, (list, tuple)):
        if len(value) > 1:
            raise ValueError("pipe_opt accepts one loader settings envelope per execution")
        value = value[0] if value else None
    if value is None:
        return {}
    object_fields(value, ("version", "kind", "parameters"), path="pipe_opt")
    if type(value["version"]) is not int or value["version"] != 1 or value["kind"] != "smart":
        raise ValueError("pipe_opt requires version 1 Smart Model Loader settings")
    return validate_parameters(value["parameters"], spec=spec)


def settings_payload(parameters):
    values = validate_parameters(parameters)
    if "template" in values:
        # Validate the selected document without rewriting/converting its file.
        load_configuration_preset(values["template"])
    return {"version": 1, "kind": "smart", "parameters": values}


def _replace_resource(previous, name):
    # Source/digest metadata belongs to one file identity, not to its widget slot.
    return copy.deepcopy(previous) if previous and previous["name"] == name else {"name": name}


def _components(config, values, spec):
    kind = config["model"]["kind"]
    for key, prefix in (("clip", "clip"), ("vae", "vae"), ("audioVae", "audio_vae")):
        old = config.get(key)
        source = values.get(f"{prefix}_source", old.get("source") if old else "disabled")
        if source == "disabled":
            config.pop(key, None)
            continue
        allowed = component_sources(kind, key)
        if source not in allowed:
            if f"{prefix}_source" in values:
                raise ValueError(f"{prefix}_source is unsupported for {kind}")
            source = "external"
        section = copy.deepcopy(old) if old and old["source"] == source else {"source": source}
        if key == "clip":
            section["skip"] = (old or {}).get("skip")
            if "clip_skip" in values:
                section["skip"] = None if values["clip_skip"] == "disabled" else int(values["clip_skip"])
            if source != "baked":
                section["type"] = values.get("clip_type", section.get("type", "ltxv" if source == "combined"
                                            else "flux" if "flux" in spec["clipTypes"] else spec["clipTypes"][0]))
                previous = section.get("encoders", [])
                used_ids = {row["id"] for row in previous}
                rows = []
                for index in range(4):
                    row = copy.deepcopy(previous[index]) if index < len(previous) else None
                    name = values.get(f"clip_name{index + 1}")
                    if name == NONE:
                        continue
                    if name is not None:
                        identity = f"native-encoder-{index + 1}"
                        while identity in used_ids:
                            identity += "-new"
                        row = {"id": row["id"] if row else identity,
                               "resource": _replace_resource(row["resource"] if row else None, name)}
                        used_ids.add(row["id"])
                    if row:
                        rows.append(row)
                section["encoders"] = rows or [{"id": "native-encoder-1", "resource": {"name": ""}}]
        elif source == "external":
            section["resource"] = _replace_resource(section.get("resource"), values[f"{prefix}_name"]) if (
                f"{prefix}_name" in values
            ) else section.get("resource", {"name": ""})
        config[key] = section


def _runtime_sections(config, values, spec, local):
    fresh = {
        "sampler": {**defaults(SAMPLER), "sampler_name": spec["samplers"][0], "scheduler": spec["schedulers"][0],
                    "denoise": local.get("sampler", {}).get("denoise", local.get("localDenoise", 1.))},
    }
    for key, section in fresh.items():
        if values.get(key) == "disabled":
            config.pop(key, None)
        elif values.get(key) == "enabled":
            config.setdefault(key, section)
    if values.get("loras") == "disabled":
        config.pop("loras", None)
    if "sampler" in config:
        sampler = config["sampler"]
        sampler.update({key: values[key] for key in (*SAMPLER, "sampler_name", "scheduler") if key in values})
        if supports_flux(config):
            sampler["flux_guidance"] = values.get("flux_guidance", sampler.get("flux_guidance", 3.5))
        else:
            sampler.pop("flux_guidance", None)
    method = values.get("model_sampling")
    if method == "None":
        config.pop("modelSampling", None)
    elif method and method != config.get("modelSampling", {}).get("method"):
        config["modelSampling"] = {"method": method, "parameters": defaults(SAMPLING[method])}
    if "modelSampling" in config:
        sampling = config["modelSampling"]
        sampling["parameters"].update({key: values[key] for key in SAMPLING[sampling["method"]] if key in values})
        if sampling["method"] in {"Flux", "Qwen Image 2.1"} and "latent" not in config:
            dimensions = sampling.get("dimensions", local.get("modelSampling", {}).get(
                "dimensions", defaults(DIMENSIONS),
            ))
            sampling["dimensions"] = dimensions
        else:
            sampling.pop("dimensions", None)
    if "seed" in values:
        config["seed"] = {"value": str(values["seed"]), "policy": "fixed"}


def merge_settings(configuration, pipe_opt=None, *, spec=None):
    spec = spec or editor_spec()
    local = validate_configuration(configuration, spec=spec)
    values = settings_parameters(pipe_opt, spec=spec)
    config = copy.deepcopy(local)
    if "template" in values:
        config = load_configuration_preset(values["template"])
        config.update({key: copy.deepcopy(local[key]) for key in LOCAL_SECTIONS if key in local})
        if "sampler" in config:
            config["sampler"]["denoise"] = local.get("sampler", {}).get(
                "denoise", local.get("localDenoise", SAMPLER["denoise"]["default"]),
            )
    model = config["model"]
    kind = values.get("model_mode", model["kind"])
    if kind != model["kind"]:
        previous_role = MODES[model["kind"]]["role"]
        model.update(kind=kind, options=defaults(MODES[kind]["options"]))
        if MODES[kind]["role"] != previous_role:
            model["resource"] = {"name": model["resource"]["name"]}
    if "model_name" in values:
        model["resource"] = _replace_resource(model["resource"], values["model_name"])
    if kind == "unet" and "weight_dtype" in values:
        model["options"]["weight_dtype"] = values["weight_dtype"]
    _components(config, values, spec)
    _runtime_sections(config, values, spec, local)
    if kind.startswith("nunchaku-"):
        config["memory"].pop("blockSwap", None)
    return validate_configuration(config, spec=spec)


def resource_fingerprint(config, *, all_model_roles=False):
    selections = []
    model = config.get("model", {})
    if model.get("resource", {}).get("name"):
        roles = ("checkpoints", "diffusion_models", "diffusion_models_gguf") if all_model_roles else (
            MODES[model["kind"]]["role"],
        )
        selections.extend((role, model["resource"]["name"]) for role in roles)
    for key in ("vae", "audioVae"):
        item = config.get(key, {})
        if item.get("source") == "external":
            selections.append(("vae", item["resource"]["name"]))
    selections.extend(("clip", row["resource"]["name"]) for row in config.get("clip", {}).get("encoders", []))
    selections.extend(("loras", row["resource"]["name"]) for row in config.get("loras", {}).get("entries", []))
    identities = []
    for role, name in selections:
        try:
            selected = resolve_clip_file(name) if role == "clip" else resolve_model_file(
                role, name, reference_type="model_gguf" if role == "diffusion_models_gguf" else
                "vae" if role == "vae" else "lora" if role == "loras" else "model",
            )
            stat = selected.path.stat()
            identities.append((role, name, str(selected.path), stat.st_ino,
                               stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
        except (OSError, ValueError):
            identities.append((role, name, "unavailable"))
    return tuple(identities)


def native_fingerprint(parameters):
    if any(value is None for key, value in parameters.items() if key != "seed"):
        return float("nan")  # ComfyUI has not resolved a connected widget yet.
    values = validate_parameters(parameters)
    preset = load_configuration_preset(values["template"]) if "template" in values else {}
    # Include template dependencies and explicit overrides. Local panel fallbacks
    # are fingerprinted by the consumer; no model loading or hashing occurs here.
    explicit = {"model": {"kind": values.get("model_mode", preset.get("model", {}).get("kind", "checkpoint")),
                          "resource": {"name": values.get("model_name", "")}},
                "clip": {"encoders": [{"resource": {"name": values[key]}}
                                       for key in (f"clip_name{i}" for i in range(1, 5))
                                       if key in values and values[key] != NONE]}}
    for key, prefix in (("vae", "vae"), ("audioVae", "audio_vae")):
        if f"{prefix}_name" in values:
            explicit[key] = {"source": "external", "resource": {"name": values[f"{prefix}_name"]}}
    return (json.dumps(preset, sort_keys=True), resource_fingerprint(preset),
            resource_fingerprint(explicit, all_model_roles="model_mode" not in values and not preset))
