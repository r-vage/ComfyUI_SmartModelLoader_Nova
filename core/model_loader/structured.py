# Structured orchestration for the independent v2 loader contract.

from __future__ import annotations

import comfy.memory_management
import comfy.sd
import folder_paths
import torch

from ..common import cleanup_memory_before_load
from ..gguf_wrapper import load_gguf_clip, load_gguf_model
from ..model_loader_common import (
    GGUF_AVAILABLE,
    apply_blockswap,
    apply_loras,
    apply_model_sampling,
    detect_latent_channels,
    detect_latent_downscale,
    format_lora_string,
    load_audio_vae_from_path,
    load_custom_vae,
)
from ..nunchaku_wrapper import load_nunchaku_model
from .attention import apply_attention_backend
from .clip_configuration import ClipConfigurationRequest
from .configuration import ConfigurationRequest, supports_flux
from .integrity import read_expected, sha256_for, verify
from .lifecycle import with_loader_execution
from .loading import LoadResult
from .pipes import build_pipe
from .validation import resolve_clip_type


def _verify_resources(request):
    mode = request.config["integrity"]
    if mode == "off":
        return
    for key, selected in request.files.items():
        metadata = {"reference_type": selected.reference_type, "folder_role": selected.role,
                    "relative_path": selected.relative_path}
        expected = request.resources[key].get("sha256")
        if mode == "sidecar":
            if sha256_for(selected.path, **metadata) is None:
                raise ValueError(f"Could not record a digest for {selected.relative_path}")
        else:
            expected = expected or (read_expected(selected.path) or {}).get("sha256")
            if not expected:
                raise ValueError(f"Verification requires an expected SHA-256 for {selected.relative_path}")
            result = verify(selected.path, expected, on_mismatch="error", **metadata)
            if result["status"] != "ok":
                raise ValueError(f"Integrity verification failed for {selected.relative_path}: {result['status']}")


def _load_primary(request):
    config = request.config
    kind = config["model"]["kind"]
    options = config["model"]["options"]
    path = str(request.files["model"].path)
    baked_clip = config.get("clip", {}).get("source") == "baked"
    baked_vae = config.get("vae", {}).get("source") == "baked"
    if kind == "checkpoint" or (kind == "unet" and (baked_clip or baked_vae)):
        if kind == "unet" and options["weight_dtype"] != "default":
            raise ValueError("Baked UNet components require the default weight dtype; select external components")
        parts = comfy.sd.load_checkpoint_guess_config(
            path, output_clip=baked_clip, output_vae=baked_vae,
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )
        return parts[0], parts[1], parts[2]
    if kind == "unet":
        model_options = {}
        dtype = options["weight_dtype"]
        if dtype != "default":
            model_options["dtype"] = torch.float8_e5m2 if dtype == "fp8_e5m2" else torch.float8_e4m3fn
            if dtype == "fp8_e4m3fn_fast":
                model_options["fp8_optimizations"] = True
        return comfy.sd.load_diffusion_model(path, model_options=model_options), None, None
    if kind == "gguf":
        return load_gguf_model(model_path=path, **options), None, None
    converted = dict(options)
    if "cpu_offload" in converted and converted["cpu_offload"] != "auto":
        converted["cpu_offload"] = converted["cpu_offload"] == "enable"
    return load_nunchaku_model(model_path=path, device=None, dtype=None,
                               model_type=kind.removeprefix("nunchaku-"), **converted), None, None


def _load_encoder_files(paths, clip_type):
    resolved_type = resolve_clip_type(clip_type, comfy.sd.CLIPType)
    if any(path.lower().endswith(".gguf") for path in paths):
        return load_gguf_clip(clip_paths=paths, clip_type=resolved_type)
    return comfy.sd.load_clip(ckpt_paths=paths, clip_type=resolved_type,
                              embedding_directory=folder_paths.get_folder_paths("embeddings"))


@with_loader_execution
def execute_clip_configuration(configuration):
    request = ClipConfigurationRequest.parse(configuration)
    _verify_resources(request)
    clip = _load_encoder_files([str(file.path) for file in request.files.values()], request.config["clip"]["type"])
    if clip is None:
        raise ValueError("The selected files did not produce a compatible CLIP")
    return clip, ", ".join(file.relative_path for file in request.files.values())


def _load_clip(request, baked):
    section = request.config.get("clip")
    if section is None:
        return None
    clip = baked
    if section["source"] != "baked":
        paths = [str(request.files[f"clip:{entry['id']}"].path) for entry in section["encoders"]]
        if section["source"] == "combined":
            paths.append(str(request.files["model"].path))
        clip = _load_encoder_files(paths, section["type"])
    if clip is None:
        raise ValueError("The selected model has no compatible baked CLIP; select external encoders")
    if section["skip"] is not None:
        clip = clip.clone()
        clip.clip_layer(section["skip"])
    return clip


def _load_configuration(request):
    # Every entry point resolves active resources before cleanup or loading.
    config = request.config
    kind = config["model"]["kind"]
    if not GGUF_AVAILABLE and any(file.path.suffix.lower() == ".gguf" for file in request.files.values()):
        raise ValueError("GGUF support is not installed")
    if (kind == "unet" and config["model"]["options"]["weight_dtype"] != "default"
            and any(config.get(key, {}).get("source") == "baked" for key in ("clip", "vae"))):
        raise ValueError("Baked UNet components require the default weight dtype")
    _verify_resources(request)
    if config["memory"]["cleanup"]:
        cleanup_memory_before_load()
    model, baked_clip, baked_vae = _load_primary(request)
    if model is None:
        raise RuntimeError("The selected backend could not load this model")
    clip = _load_clip(request, baked_clip)
    vae = None
    if "vae" in config:
        section = config["vae"]
        vae = baked_vae if section["source"] == "baked" else load_custom_vae(section["resource"]["name"])
        if vae is None:
            raise ValueError("The selected model has no compatible baked VAE; select an external VAE")
    audio_vae = None
    if "audioVae" in config:
        section = config["audioVae"]
        path = str(request.files["model"].path)
        if section["source"] == "external":
            audio_vae = load_custom_vae(section["resource"]["name"])
        else:
            audio_vae = load_audio_vae_from_path(path)
        if audio_vae is None:
            raise ValueError("No compatible audio VAE was found; baked audio requires an LTX all-in-one model")

    loras = [(entry["resource"]["name"], entry["strength"]) for entry in config.get("loras", {}).get("entries", [])]
    # Existing application services accept ordered lists without a numbered-slot limit.
    model, clip = apply_loras(model, clip, loras)
    model = apply_attention_backend(model, config["model"]["attentionBackend"])
    if "modelSampling" in config:
        sampling = config["modelSampling"]
        parameters = {"shift": 3.0, **sampling["parameters"]}
        if sampling["method"] in {"Flux", "Qwen Image 2.1"}:
            dimensions = config.get("latent", sampling.get("dimensions"))
            parameters.update(width=dimensions["width"], height=dimensions["height"])
        model = apply_model_sampling(model, sampling_method=sampling["method"], **parameters)
    # Saved/API configurations can still contain settings from a non-dynamic session.
    if "blockSwap" in config["memory"] and not comfy.memory_management.aimdo_enabled:
        model = apply_blockswap(model, log_prefix="Smart Model Loader", **config["memory"]["blockSwap"])

    return LoadResult(model, clip, vae, audio_vae, config["model"]["resource"]["name"], format_lora_string(loras))


def _resource_pipe(config, result):
    pipe = build_pipe(model=result.model, model_name=result.model_name,
                      is_nunchaku=config["model"]["kind"] == "nunchaku-flux", lora_names=result.lora_names)
    for key, value in (("clip", result.clip), ("vae", result.vae), ("audio_vae", result.audio_vae)):
        if value is not None:
            pipe[key] = value
    if "clip" in config and config["clip"]["skip"] is not None:
        pipe["clip_skip"] = config["clip"]["skip"]
    return pipe


@with_loader_execution
def execute_configuration(configuration):
    request = ConfigurationRequest.parse(configuration)
    config = request.config
    result = _load_configuration(request)
    pipe = _resource_pipe(config, result)
    vae = result.vae
    pipe["configure_sampler"] = "sampler" in config
    pipe["vae_name"] = config.get("vae", {}).get("resource", {}).get("name", "")
    if "latent" in config:
        latent = config["latent"]
        channels, downscale = detect_latent_channels(vae), detect_latent_downscale(vae)
        if (not isinstance(channels, int) or not isinstance(downscale, int) or channels <= 0 or downscale <= 0
                or latent["width"] % downscale or latent["height"] % downscale):
            raise ValueError("Latent width and height must be divisible by the VAE's spatial scale")
        # Qwen/Krea image VAEs also use 3D layouts. As with EmptyLatentImage,
        # keep a 4D empty image here; ComfyUI adds a singleton frame at sampling
        # when the model's latent format needs it. Batch size stays image count.
        if getattr(vae, "latent_dim", 2) not in (2, 3):
            raise ValueError(
                "Latent creation here requires a spatial VAE; use a dedicated latent node for other layouts",
            )
        pipe.update(latent={"samples": torch.zeros(
            [latent["batch_size"], channels, latent["height"] // downscale, latent["width"] // downscale], device="cpu",
        ), "downscale_ratio_spacial": downscale},
            width=latent["width"], height=latent["height"], batch_size=latent["batch_size"])
    if "sampler" in config:
        pipe.update(config["sampler"], _allow_overwrite=False)
        if not supports_flux(config):
            pipe.pop("flux_guidance", None)
    if "seed" in config:
        pipe["seed"] = int(config["seed"]["value"])
    return pipe
