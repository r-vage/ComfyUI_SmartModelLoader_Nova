# Versioned configuration and form specification for Smart Model Loader v2.

from __future__ import annotations

import copy
import json
import math
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from .clip_validation import validate_ltx_projection
from .validation import ResolvedModelFile, resolve_clip_file, resolve_model_file

MAX_CONFIGURATION_BYTES = 1024 * 1024
MAX_LATENT_PIXELS = 256 * 1024 * 1024
MAX_SEED = 2**64 - 1
MAX_LORAS = 256
MAX_ENCODERS = 4
WIDGET_TYPE = "SML2_LOADER_CONFIGURATION"
FEATURES = {
    "clip": "CLIP", "vae": "VAE", "audioVae": "Audio VAE", "loras": "LoRA",
    "latent": "Latent", "sampler": "Sampler", "modelSampling": "Model sampling", "seed": "Seed",
}


def validate_profile(profile, *, preset=False):
    if not isinstance(profile, str) or profile not in {"smart", "clip", "lora"}:
        raise ValueError("Unsupported loader profile")
    if preset and profile == "clip":
        raise ValueError("CLIP Loader does not use presets")
    return profile


def component_sources(kind, key):
    embedded = kind in {"checkpoint", "unet"}
    return (["baked", "external", "combined"] if embedded else ["external"]) if key == "clip" else (
        ["baked", "external"] if embedded else ["external"]
    )


def choice(label, values, default=None):
    return {"label": label, "type": "choice", "values": values, "default": default or values[0]}


def number(label, default, minimum, maximum, step=1):
    return {"label": label, "type": "number", "default": default,
            "min": minimum, "max": maximum, "step": step}


def boolean(label, default=False):
    return {"label": label, "type": "boolean", "default": default}


DTYPES = ["default", "target", "float32", "float16", "bfloat16"]
OFFLOAD = choice("CPU offload", ["auto", "enable", "disable"])
MODES = {
    "checkpoint": {"label": "Checkpoint", "role": "checkpoints", "options": {}},
    "unet": {"label": "UNet", "role": "diffusion_models", "options": {
        "weight_dtype": choice("Weight dtype", ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"]),
    }},
    "gguf": {"label": "GGUF", "role": "diffusion_models_gguf", "options": {
        "dequant_dtype": choice("Dequant dtype", DTYPES),
        "patch_dtype": choice("Patch dtype", DTYPES),
        "patch_on_device": boolean("Patch on device"),
    }},
    "nunchaku-flux": {"label": "Nunchaku Flux", "role": "diffusion_models", "options": {
        "data_type": choice("Data type", ["bfloat16", "float16"]),
        "cache_threshold": number("Cache threshold", 0.0, 0, 1, 0.1),
        "attention": choice("Nunchaku attention", ["flash-attention2", "nunchaku-fp16"]),
        "i2f_mode": choice("i2f mode", ["enabled", "always"]),
        "cpu_offload": OFFLOAD,
    }},
    "nunchaku-qwen": {"label": "Nunchaku Qwen", "role": "diffusion_models", "options": {
        "cpu_offload": OFFLOAD,
        "num_blocks_on_gpu": number("Blocks on GPU", 30, 1, 60),
        "use_pin_memory": boolean("Pinned memory", True),
    }},
    "nunchaku-zimage": {"label": "Nunchaku ZImage", "role": "diffusion_models", "options": {}},
}

SHIFT = number("Shift", 3.0, 0, 100, 0.1)
BASE_SHIFT = number("Base shift", 0.5, 0, 100, 0.1)
SIGMA = {
    "sigma_min": number("Sigma minimum", 0.002, 0, 1000, 0.001),
    "sigma_max": number("Sigma maximum", 120.0, 0, 1000, 0.001),
}
SAMPLING = {
    "None": {},
    "SD3": {"shift": SHIFT},
    "AuraFlow": {"shift": number("Shift", 1.73, 0, 100, 0.01)},
    "Stable Cascade": {"shift": number("Shift", 2.0, 0, 100, 0.1)},
    "Flux": {"base_shift": BASE_SHIFT, "shift": number("Max shift", 1.15, 0, 100, 0.01)},
    "Qwen Image 2.1": {"base_shift": BASE_SHIFT, "shift": number("Max shift", 0.9, 0, 100, 0.1)},
    "LCM": {"original_timesteps": number("Original timesteps", 50, 1, 1000), "zsnr": boolean("Zero-terminal SNR")},
    "ContinuousEDM": {
        "sampling_subtype": choice("Subtype", ["eps", "v_prediction", "edm", "edm_playground_v2.5", "cosmos_rflow"]),
        **SIGMA,
    },
    "ContinuousV": SIGMA,
    "LTXV": {"base_shift": number("Base shift", 0.95, 0, 100, 0.01),
             "shift": number("Max shift", 2.05, 0, 100, 0.01)},
    "MiniMax H3": {"shift_video": number("Video shift", 12.0, 0.01, 100, 0.01),
                   "shift_audio": number("Audio shift", 3.0, 0.01, 100, 0.01)},
}
DIMENSIONS = {"width": number("Width", 1024, 16, 32768), "height": number("Height", 1024, 16, 32768)}
LATENT = {**DIMENSIONS, "batch_size": number("Batch size", 1, 1, 4096)}
LATENT_SIZING = {
    "aspects": {name: [int(part) for part in name.split(":")] for name in
                ["1:1", "16:9", "21:9", "2:1", "3:2", "4:3", "5:4", "9:16", "9:21", "1:2", "2:3", "3:4", "4:5"]},
    "resolutions": {
        **{f"square-{side}": {"label": f"{side}²", "area": side * side, "group": "Base size"}
           for side in [512, 768, 1024, 1536, 2048]},
        **{f"mp-{mp}": {"label": f"{mp} MP", "area": int(mp * 1_000_000), "group": "Megapixels"}
           for mp in [0.25, 0.5, 1, 2, 4, 8]},
    },
    "divisors": [8, 16, 32, 64],
    "divisor": number("Divisible by", 32, 1, 32768),
    "ratio": number("Ratio", 1, 0.01, 10000, 0.01),
    "megapixels": number("Megapixels", 1, 0.000256, MAX_LATENT_PIXELS / 1_000_000, 0.000001),
    "default": {"mode": "preset", "resolution": "square-1024", "aspect": "1:1", "divisor": 32},
    "maxPixels": MAX_LATENT_PIXELS,
}
SAMPLER = {
    "steps": number("Steps", 20, 1, 10000), "cfg": number("CFG", 8.0, 0, 1000, 0.1),
    "denoise": number("Denoise", 1.0, 0, 1, 0.1),
}
BLOCK_SWAP = {"blocks_to_swap": number("Blocks to swap", 10, 0, 100),
              "offload_embeddings": boolean("Offload embeddings")}


def defaults(fields):
    return {name: copy.deepcopy(field["default"]) for name, field in fields.items()}


def default_configuration(*, profile="smart"):
    validate_profile(profile)
    if profile == "lora":
        from .lora_configuration import default_lora_configuration
        return default_lora_configuration()
    if profile == "clip":
        from .clip_configuration import default_clip_configuration
        return default_clip_configuration()
    return {
        "version": 1,
        "model": {"kind": "checkpoint", "resource": {"name": ""}, "options": {},
                  "attentionBackend": "pytorch attention"},
        "clip": {"source": "baked", "skip": -2},
        "vae": {"source": "baked"},
        "memory": {"cleanup": True},
        "integrity": "off",
    }


def editor_spec(*, profile="smart"):
    validate_profile(profile)
    if profile == "lora":
        from .lora_configuration import lora_editor_spec
        return lora_editor_spec()
    if profile == "clip":
        from .clip_configuration import clip_editor_spec
        return clip_editor_spec()
    # Installed capabilities are shared by validation and the form, not inferred by JS.
    import comfy.memory_management
    import comfy.samplers
    import comfy.sd

    from .. import RESOLUTION_MAP, nunchaku_wrapper
    from ..model_loader_common import GGUF_AVAILABLE
    from .attention import get_attention_backend_options
    from .validation import get_clip_type_options

    validate_profile(profile)
    available = {"checkpoint": True, "unet": True, "gguf": GGUF_AVAILABLE}
    nunchaku_components = {
        "flux": ["ComfyFluxWrapper", "NunchakuFluxTransformer2dModel"],
        "qwen": ["QwenConfig", "QwenModelBase", "NunchakuModelPatcher", "NunchakuQwenImageTransformer2DModel"],
        "zimage": ["ZImageModelPatcher", "ZImageConfig", "patch_zimage_model"],
    }
    for kind, components in nunchaku_components.items():
        available[f"nunchaku-{kind}"] = nunchaku_wrapper.NUNCHAKU_AVAILABLE and all(
            getattr(nunchaku_wrapper, component, None) is not None for component in components
        )
    return {
        "profile": profile,
        "features": dict(FEATURES),
        "componentSources": {kind: {key: component_sources(kind, key) for key in ("clip", "vae", "audioVae")}
                             for kind in MODES},
        "modes": MODES,
        "sampling": dict(SAMPLING),
        "dimensions": DIMENSIONS,
        "latent": LATENT, "latentSizing": LATENT_SIZING, "sampler": SAMPLER, "blockSwap": BLOCK_SWAP,
        "attention": list(get_attention_backend_options()),
        "clipTypes": list(get_clip_type_options(comfy.sd.CLIPType)),
        "samplers": list(comfy.samplers.KSampler.SAMPLERS),
        "schedulers": list(comfy.samplers.KSampler.SCHEDULERS),
        "resolutions": RESOLUTION_MAP,
        "available": available,
        # Set only after ComfyUI successfully initializes DynamicVRAM.
        "dynamicVram": bool(comfy.memory_management.aimdo_enabled),
        "maxEncoders": MAX_ENCODERS, "maxLoras": MAX_LORAS,
    }


def object_fields(value, required, optional=(), *, path):
    if not isinstance(value, dict):
        raise TypeError(f"{path} must be an object")
    missing = set(required) - value.keys()
    unknown = value.keys() - set(required) - set(optional)
    if missing or unknown:
        raise ValueError(f"{path}: missing {sorted(missing)}; unknown {sorted(unknown)}")


def validate_fields(value, fields, *, path):
    object_fields(value, fields, path=path)
    for name, field in fields.items():
        item = value[name]
        label = f"{path}.{name}"
        if field["type"] == "boolean":
            if type(item) is not bool:
                raise ValueError(f"{label} must be boolean")
        elif field["type"] == "choice":
            if not isinstance(item, str) or item not in field["values"]:
                raise ValueError(f"{label} is not a supported option")
        elif (type(item) not in (int, float) or not math.isfinite(item)
              or not field["min"] <= item <= field["max"]
              or (field["step"] == 1 and type(item) is not int)):
            raise ValueError(f"{label} must be between {field['min']} and {field['max']}")


def resource(value, *, path, require_name):
    object_fields(value, ["name"], ["sha256", "source"], path=path)
    name = value["name"]
    if not isinstance(name, str) or len(name) > 4096 or "\0" in name:
        raise ValueError(f"{path}.name is invalid")
    if require_name and not name:
        raise ValueError(f"Select a local file for {path}")
    normalized = name.replace("\\", "/")
    if name and (PurePosixPath(normalized).is_absolute() or ":" in normalized
                 or any(part in {"", ".", ".."} for part in normalized.split("/"))):
        raise ValueError(f"{path}.name must be a safe relative model path")
    value["name"] = normalized
    if "sha256" in value and (not isinstance(value["sha256"], str)
                               or not re.fullmatch(r"[a-fA-F0-9]{64}", value["sha256"])):
        raise ValueError(f"{path}.sha256 must contain 64 hexadecimal characters")
    if "source" in value:
        source = value["source"]
        object_fields(source, ["provider", "reference"], ["revision"], path=f"{path}.source")
        validate_fields({"provider": source["provider"]},
                        {"provider": choice("Provider", ["civitai", "huggingface"])}, path=path)
        for key in ("reference", "revision"):
            if key in source and (not isinstance(source[key], str) or len(source[key]) > 2048
                                  or any(ord(char) < 32 for char in source[key])):
                raise ValueError(f"{path}.source.{key} is invalid")
        reference = source["reference"]
        pattern = (r"urn:air:[^:\s]+:[^:\s]+:civitai:[0-9]+@[0-9]+(?:\+[0-9]+)?"
                   if source["provider"] == "civitai" else r"[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+")
        if reference and re.fullmatch(pattern, reference) is None:
            raise ValueError(f"{path}.source requires an AIR or HF owner/repository reference")


def resolve_latent_dimensions(latent):
    # Exact dimensions are also a valid API request. Sizing intent, when supplied,
    # must describe those same dimensions; execution never silently resizes them.
    if "sizing" not in latent:
        return latent["width"], latent["height"]
    sizing = latent["sizing"]
    object_fields(sizing, ["mode", "divisor"], ["aspect", "ratioWidth", "ratioHeight", "resolution", "megapixels"],
                  path="latent.sizing")
    mode = sizing["mode"]
    if mode not in ("preset", "megapixels", "fixed"):
        raise ValueError("Unsupported latent sizing mode")
    fields = {"mode": choice("Size mode", [mode]), "divisor": LATENT_SIZING["divisor"]}
    if mode != "fixed":
        fields["aspect"] = choice("Aspect", [*LATENT_SIZING["aspects"], "custom"])
        if sizing.get("aspect") == "custom":
            fields.update(ratioWidth=LATENT_SIZING["ratio"], ratioHeight=LATENT_SIZING["ratio"])
        if mode == "preset":
            fields["resolution"] = choice("Resolution", list(LATENT_SIZING["resolutions"]))
        else:
            fields["megapixels"] = LATENT_SIZING["megapixels"]
    validate_fields(sizing, fields, path="latent.sizing")
    if mode == "fixed":
        width, height = latent["width"], latent["height"]
    else:
        ratio_w, ratio_h = ([sizing["ratioWidth"], sizing["ratioHeight"]] if sizing["aspect"] == "custom"
                            else LATENT_SIZING["aspects"][sizing["aspect"]])
        area = (LATENT_SIZING["resolutions"][sizing["resolution"]]["area"] if mode == "preset"
                else sizing["megapixels"] * 1_000_000)
        width, height = math.sqrt(area * ratio_w / ratio_h), math.sqrt(area * ratio_h / ratio_w)
    divisor = sizing["divisor"]

    def snap(value, field):
        # Explicit half-up rounding agrees with the JavaScript sizing controls.
        result = max(math.ceil(field["min"] / divisor), math.floor(value / divisor + 0.5)) * divisor
        if result > field["max"]:
            raise ValueError("Latent dimensions exceed the supported size")
        return result

    return snap(width, DIMENSIONS["width"]), snap(height, DIMENSIONS["height"])


def configuration_value(raw):
    if isinstance(raw, str):
        if len(raw.encode("utf-8")) > MAX_CONFIGURATION_BYTES:
            raise ValueError("Configuration exceeds 1 MiB")
        try:
            config = json.loads(raw)
        except (ValueError, RecursionError) as error:
            raise ValueError("Configuration must be valid JSON") from error
    else:
        config = copy.deepcopy(raw)
    return config


def validate_configuration(raw, *, spec=None, require_files=False, preset=False, profile="smart"):
    validate_profile(profile, preset=preset)
    if profile == "lora":
        from .lora_configuration import validate_lora_configuration
        return validate_lora_configuration(raw, require_files=require_files, preset=preset)
    if profile == "clip":
        from .clip_configuration import validate_clip_configuration
        return validate_clip_configuration(raw, spec=spec, require_files=require_files)
    config = configuration_value(raw)
    required = ["version", "model"]
    optional = ["clip", "vae", "audioVae", "loras", "latent", "sampler", "modelSampling"]
    if not preset:
        required += ["memory", "integrity"]
        optional.append("seed")
    object_fields(config, required, optional, path="preset" if preset else "configuration")
    if type(config["version"]) is not int or config["version"] != 1:
        raise ValueError("Unsupported configuration version; expected version 1")
    spec = spec or editor_spec(profile=profile)
    model = config["model"]
    object_fields(model, ["kind", "resource", "options", "attentionBackend"], path="model")
    validate_fields({"kind": model["kind"], "attentionBackend": model["attentionBackend"]},
                    {"kind": choice("Mode", list(MODES)),
                     "attentionBackend": choice("Attention", spec["attention"])}, path="model")
    kind = model["kind"]
    validate_fields(model["options"], MODES[kind]["options"], path="model.options")
    resource(model["resource"], path="model", require_name=require_files)
    if require_files and not spec["available"][kind]:
        raise ValueError(f"{MODES[kind]['label']} backend is not installed")
    for key in ("clip", "vae", "audioVae"):
        if key not in config:
            continue
        section = config[key]
        object_fields(section, ["source"], ["resource", "encoders", "type", "skip"], path=key)
        source = section["source"]
        allowed = component_sources(kind, key)
        if not isinstance(source, str) or source not in allowed:
            raise ValueError(f"{key}.source is unsupported")
        if source in {"baked", "combined"} and kind not in {"checkpoint", "unet"}:
            raise ValueError(f"{key}: {MODES[kind]['label']} requires external files")
        expected = ["source"]
        if key == "clip":
            expected.append("skip")
            if section.get("skip") is not None:
                validate_fields({"skip": section["skip"]}, {"skip": number("CLIP skip", -2, -24, -1)}, path=key)
            if source != "baked":
                expected += ["encoders", "type"]
                validate_fields({"type": section.get("type")},
                                {"type": choice("CLIP type", spec["clipTypes"])}, path=key)
                entries = section.get("encoders")
                if source == "combined" and section["type"] == "ltxv" and (
                    not isinstance(entries, list) or len(entries) != 1
                ):
                    raise ValueError("LTX External + Model File requires exactly one external Gemma encoder "
                                     "(the model supplies the text projections)")
                maximum = MAX_ENCODERS
                if not isinstance(entries, list) or not 1 <= len(entries) <= maximum:
                    raise ValueError(f"CLIP requires 1 to {maximum} encoders")
                validate_rows(entries, path="clip.encoders", require_files=require_files)
        elif source == "external":
            expected.append("resource")
            resource(section.get("resource"), path=key, require_name=require_files)
        object_fields(section, expected, path=key)
    if "loras" in config:
        object_fields(config["loras"], ["entries"], path="loras")
        entries = config["loras"]["entries"]
        if not isinstance(entries, list) or len(entries) > MAX_LORAS:
            raise ValueError(f"LoRA supports at most {MAX_LORAS} rows")
        validate_rows(entries, path="loras", require_files=require_files, loras=True)
    if "latent" in config:
        latent = config["latent"]
        object_fields(latent, LATENT, ["sizing"], path="latent")
        validate_fields({key: latent[key] for key in LATENT}, LATENT, path="latent")
        if resolve_latent_dimensions(latent) != (latent["width"], latent["height"]):
            raise ValueError("Latent dimensions do not match the selected aspect, resolution or divisor")
        if latent["width"] * latent["height"] * latent["batch_size"] > MAX_LATENT_PIXELS:
            raise ValueError("Latent size exceeds the supported pixel batch")
        if "vae" not in config:
            raise ValueError("Enable VAE to create a compatible latent")
    if "sampler" in config:
        fields = {**SAMPLER, "sampler_name": choice("Sampler", spec["samplers"]),
                  "scheduler": choice("Scheduler", spec["schedulers"])}
        if supports_flux(config):
            fields["flux_guidance"] = number("Flux guidance", 3.5, 0, 1000, 0.1)
        if preset and isinstance(config["sampler"], dict) and "denoise" not in config["sampler"]:
            fields.pop("denoise")
        validate_fields(config["sampler"], fields, path="sampler")
        if preset:
            # Validate older presets, but denoise is node-local runtime state.
            config["sampler"].pop("denoise", None)
    if "modelSampling" in config:
        sampling = config["modelSampling"]
        object_fields(sampling, ["method", "parameters"], ["dimensions"], path="modelSampling")
        method = sampling["method"]
        if not isinstance(method, str) or method not in spec["sampling"]:
            raise ValueError("Unsupported model sampling method")
        validate_fields(sampling["parameters"], SAMPLING[method], path="modelSampling.parameters")
        if method in {"Flux", "Qwen Image 2.1"} and "latent" not in config:
            # Presets saved with node-local Latent enabled have no independent
            # sampling size. The editor supplies it when applying to a node.
            if not preset or "dimensions" in sampling:
                validate_fields(sampling.get("dimensions"), DIMENSIONS, path="modelSampling.dimensions")
        elif "dimensions" in sampling:
            raise ValueError("Model sampling dimensions are derived from latent or not used by this method")
        parameters = sampling["parameters"]
        if "sigma_min" in parameters and parameters["sigma_min"] >= parameters["sigma_max"]:
            raise ValueError("Sigma minimum must be smaller than sigma maximum")
    if preset:
        # Read earlier structured presets without changing their on-disk bytes.
        # Validate their latent above, but never apply or save that runtime state.
        config.pop("latent", None)
        return config
    memory = config["memory"]
    object_fields(memory, ["cleanup"], ["blockSwap"], path="memory")
    validate_fields({"cleanup": memory["cleanup"]}, {"cleanup": boolean("Cleanup")}, path="memory")
    if "blockSwap" in memory:
        if kind.startswith("nunchaku-"):
            raise ValueError("Nunchaku uses its own offload options; disable block swap")
        validate_fields(memory["blockSwap"], BLOCK_SWAP, path="memory.blockSwap")
    if config["integrity"] not in ("off", "sidecar", "verify"):
        raise ValueError("Unsupported local integrity policy")
    if "seed" in config:
        seed = config["seed"]
        object_fields(seed, ["value", "policy"], path="seed")
        if (not isinstance(seed["value"], str) or not re.fullmatch(r"0|[1-9][0-9]{0,19}", seed["value"])
                or int(seed["value"]) > MAX_SEED):
            raise ValueError("Seed must be a decimal string from 0 to 18446744073709551615")
        if seed["policy"] not in ("fixed", "random", "increment", "decrement"):
            raise ValueError("Unsupported seed policy")
    return config


def validate_rows(entries, *, path, require_files, loras=False):
    ids = set()
    for index, entry in enumerate(entries):
        label = f"{path}[{index + 1}]"
        object_fields(entry, ["id", "resource", *(["strength"] if loras else [])], path=label)
        row_id = entry["id"]
        if not isinstance(row_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", row_id) or row_id in ids:
            raise ValueError(f"{label} needs a unique stable ID")
        ids.add(row_id)
        resource(entry["resource"], path=label, require_name=require_files)
        if loras:
            validate_fields({"strength": entry["strength"]},
                            {"strength": number("Strength", 1.0, -100, 100, 0.1)}, path=label)


def supports_flux(config):
    kind = config["model"]["kind"]
    return kind == "nunchaku-flux" or (kind in {"unet", "gguf"}
                                       and config.get("clip", {}).get("type") in {"flux", "flux2"})


@dataclass(frozen=True)
class ConfigurationRequest:
    config: dict[str, Any]
    files: dict[str, ResolvedModelFile]
    resources: dict[str, dict[str, Any]]

    @classmethod
    def parse(cls, raw, *, spec=None, profile="smart"):
        config = validate_configuration(raw, spec=spec, require_files=True, profile=profile)
        files, resources = {}, {}

        def resolve(key, item, role, reference_type):
            resources[key] = item
            files[key] = (resolve_clip_file(item["name"]) if reference_type == "clip" else
                          resolve_model_file(role, item["name"], reference_type=reference_type))

        kind = config["model"]["kind"]
        resolve("model", config["model"]["resource"], MODES[kind]["role"], "model_gguf" if kind == "gguf" else "model")
        for key in ("vae", "audioVae"):
            section = config.get(key, {})
            if section.get("source") == "external":
                resolve(key, section["resource"], "vae", "vae")
        for entry in config.get("clip", {}).get("encoders", []):
            resolve(f"clip:{entry['id']}", entry["resource"], "clip", "clip")
        for entry in config.get("loras", {}).get("entries", []):
            resolve(f"lora:{entry['id']}", entry["resource"], "loras", "lora")
        clip = config.get("clip", {})
        if clip.get("source") == "combined" and clip.get("type") == "ltxv":
            validate_ltx_projection(files["model"])
        return cls(config, files, resources)
