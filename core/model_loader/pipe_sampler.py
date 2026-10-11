"""Structured settings and execution for KSampler Pipe v2."""

import json
import re
import secrets

import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
import nodes

from ..common import get_workflow_node
from .configuration import (
    MAX_SEED,
    SAMPLER,
    boolean,
    choice,
    configuration_value,
    defaults,
    number,
    object_fields,
    validate_fields,
)

SAMPLER_FIELDS = {**SAMPLER, "steps": {**SAMPLER["steps"], "default": 8},
                  "cfg": {**SAMPLER["cfg"], "default": 1.0}}
DECODE_FIELDS = {"tiled": boolean("Tiled decode"), "tileSize": number("Tile size", 512, 64, 4096, 32),
                 "alpha": boolean("Alpha")}


def editor_spec():
    return {"profile": "sampler", "sampler": SAMPLER_FIELDS, "decode": DECODE_FIELDS,
            "samplers": list(comfy.samplers.KSampler.SAMPLERS),
            "schedulers": list(comfy.samplers.KSampler.SCHEDULERS)}


def default_configuration():
    return {"version": 1, "usePipe": False, "preview": True, "decode": defaults(DECODE_FIELDS),
            "sampler": {**defaults(SAMPLER_FIELDS), "sampler_name": "res_multistep", "scheduler": "simple"},
            "seed": {"value": "42", "policy": "fixed"}}


def _sampler_fields():
    return {**SAMPLER_FIELDS, "sampler_name": choice("Sampler", comfy.samplers.KSampler.SAMPLERS),
            "scheduler": choice("Scheduler", comfy.samplers.KSampler.SCHEDULERS)}


def _validate_seed(seed):
    object_fields(seed, ["value", "policy"], path="seed")
    if (not isinstance(seed["value"], str) or not re.fullmatch(r"0|[1-9][0-9]{0,19}", seed["value"])
            or int(seed["value"]) > MAX_SEED):
        raise ValueError("Seed must be an unsigned 64-bit decimal value")
    if seed["policy"] not in ("fixed", "random", "increment", "decrement"):
        raise ValueError("Unsupported seed policy")


def validate_configuration(raw):
    config = configuration_value(raw)
    object_fields(config, ["version", "usePipe", "preview", "decode", "sampler", "seed"], path="configuration")
    if type(config["version"]) is not int or config["version"] != 1:
        raise ValueError("Unsupported KSampler configuration version")
    validate_fields({key: config[key] for key in ("usePipe", "preview")},
                    {"usePipe": boolean("Use pipe settings"), "preview": boolean("Preview")}, path="options")
    if isinstance(config["decode"], dict):
        config["decode"].setdefault("alpha", False)
    validate_fields(config["decode"], DECODE_FIELDS, path="decode")
    if type(config["decode"]["tileSize"]) is not int or config["decode"]["tileSize"] % 32:
        raise ValueError("Tile size must be a whole multiple of 32")
    object_fields(config["sampler"], _sampler_fields(), path="sampler")
    object_fields(config["seed"], ["value", "policy"], path="seed")
    if not config["usePipe"]:
        validate_fields(config["sampler"], _sampler_fields(), path="sampler")
        _validate_seed(config["seed"])
    return config


def resolve_settings(config, pipe):
    settings = dict(config["sampler"])
    if config["usePipe"]:
        settings.update({key: pipe[key] for key in settings if pipe.get(key) is not None})
    validate_fields(settings, _sampler_fields(), path="sampler")
    pipe_seed = pipe.get("seed") if config["usePipe"] else None
    if pipe_seed is not None:
        if type(pipe_seed) is not int or not 0 <= pipe_seed <= MAX_SEED:
            raise ValueError("Pipe seed must be an unsigned 64-bit integer")
        seed = pipe_seed
    else:
        _validate_seed(config["seed"])
        seed = secrets.randbits(64) if config["seed"]["policy"] == "random" else int(config["seed"]["value"])
    return {**settings, "seed": seed}


def _input_latent(pipe, latent, image):
    # A connected input wins over both pipe resources. An explicit image takes
    # priority when both sockets are connected; inside the pipe, prefer latent
    # to avoid re-encoding the preview from an earlier sampler.
    if image is None and latent is None:
        latent = pipe.get("latent")
        if latent is None:
            image = pipe.get("image")
    if image is not None:
        pixels = image["image"] if isinstance(image, dict) else image
        return {"samples": pipe["vae"].encode(pixels)}
    if not isinstance(latent, dict) or latent.get("samples") is None:
        raise ValueError("Connect a latent or image, or provide one in the pipe")
    return latent


def _record_settings(config, settings, prompt, extra_pnginfo, unique_id):
    if unique_id is None:
        return
    # Keep exported execution metadata reproducible even for API random seeds or
    # a partial pipe. This does not change the live editor or the incoming pipe.
    used = {**config, "sampler": {key: settings[key] for key in config["sampler"]},
            "seed": {"value": str(settings["seed"]), "policy": "fixed"}}
    serialized = json.dumps(used, sort_keys=True, separators=(",", ":"))
    if prompt is not None:
        inputs = prompt.get(str(unique_id), {}).get("inputs", {})
        if "configuration" in inputs:
            inputs["configuration"] = serialized
    if extra_pnginfo is not None:
        saved = get_workflow_node(extra_pnginfo, unique_id)
        if saved is not None and "widgets_values" in saved:
            saved["widgets_values"] = [serialized]


def sample_pipe(pipe, configuration, positive, negative, *, latent=None, image=None,
                prompt=None, extra_pnginfo=None, unique_id=None):
    config = validate_configuration(configuration)
    if not isinstance(pipe, dict):
        raise TypeError("KSampler Pipe: connect a valid pipe")
    for key in ("model", "vae"):
        if pipe.get(key) is None:
            raise ValueError(f"KSampler Pipe: the pipe does not contain a {key}")
    settings = resolve_settings(config, pipe)
    model, vae = pipe["model"], pipe["vae"]
    source = _input_latent(pipe, latent, image)
    samples = comfy.sample.fix_empty_latent_channels(
        model, source["samples"], source.get("downscale_ratio_spacial"), source.get("downscale_ratio_temporal"),
    )
    noise = comfy.sample.prepare_noise(samples, settings["seed"], source.get("batch_index"))
    callback = latent_preview.prepare_callback(model, settings["steps"]) if config["preview"] else None
    sampled = comfy.sample.sample(
        model, noise, settings["steps"], settings["cfg"], settings["sampler_name"], settings["scheduler"],
        positive, negative, samples, denoise=settings["denoise"], noise_mask=source.get("noise_mask"),
        callback=callback, disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED, seed=settings["seed"],
    )
    latent_out = {key: value for key, value in source.items()
                  if key not in ("downscale_ratio_spacial", "downscale_ratio_temporal")}
    latent_out["samples"] = sampled
    if config["decode"]["tiled"]:
        size = config["decode"]["tileSize"]
        images = nodes.VAEDecodeTiled().decode(vae, latent_out, tile_size=size, overlap=max(16, size // 8))[0]
    else:
        images = nodes.VAEDecode().decode(vae, latent_out)[0]
    if not config["decode"]["alpha"] and images.shape[-1] == 4:
        images = images[..., :3]
    _record_settings(config, settings, prompt, extra_pnginfo, unique_id)
    ui = nodes.PreviewImage().save_images(images, prompt=prompt, extra_pnginfo=extra_pnginfo).get("ui", {}) \
        if config["preview"] else {"images": []}
    output = {**pipe, **settings, "positive": positive, "negative": negative, "latent": latent_out,
              "image": images, "width": int(images.shape[2]), "height": int(images.shape[1])}
    return output, latent_out, images, ui
