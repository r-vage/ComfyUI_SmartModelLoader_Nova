"""Apply validated SML2 stacks without conflating model, CLIP and audio weights."""

import comfy.model_base
import comfy.sd
import comfy.utils

from . import lora_adapters
from .lifecycle import with_loader_execution
from .lora_configuration import LoraConfigurationRequest, LoraStackEntry, runtime_row
from .structured import _verify_resources


def _strength(row, target):
    value = row["targets"][target]
    return value["strength"] if value["enabled"] else 0.0


def _is_ltx(model):
    return isinstance(getattr(model, "model", None), comfy.model_base.LTXAV)


def _prepare(entries, model, clip):
    if not isinstance(entries, (list, tuple)) or any(not isinstance(item, LoraStackEntry) for item in entries):
        raise ValueError("Connect a LoRA Stack to this Apply node")
    prepared = []
    for entry in entries:
        request = LoraConfigurationRequest.parse({"version": 1, "mode": entry.mode,
                                                 "entries": [entry.row], "integrity": entry.integrity})
        if not request.files:
            continue
        row = runtime_row(request.config["entries"][0], request.config["mode"])
        name = row["resource"]["name"]
        if (_strength(row, "model") or _strength(row, "audio")) and model is None:
            raise ValueError(f"{name}: connect MODEL or set its model/audio strengths to zero")
        if _strength(row, "clip") and clip is None:
            raise ValueError(f"{name}: connect CLIP, select Model mode, or set CLIP strength to zero")
        if row["mode"] == "ltx" and (_strength(row, "model") or _strength(row, "audio")) and not _is_ltx(model):
            raise ValueError(f"{name}: LTX video/audio targets require an LTX audio-video model")
        prepared.append((row, request))
    # Validate every file, target and digest before applying any patches.
    for _, request in prepared:
        _verify_resources(request)
    return prepared


def _apply_targets(model, clip, row, path):
    sm, sc, sa = (_strength(row, name) for name in ("model", "clip", "audio"))
    if not (sm or sc or sa):
        return model, clip
    weights, metadata = comfy.utils.load_torch_file(str(path), safe_load=True, return_metadata=True)
    if row["mode"] == "ltx":
        # Match DaSiWa's documented branch convention, including cross-modal keys.
        video = {key: value for key, value in weights.items() if "audio" not in key.lower()}
        audio = {key: value for key, value in weights.items() if "audio" in key.lower()}
        for label, branch, strength in (("Video", video, sm), ("Audio", audio, sa)):
            if strength and not branch:
                raise ValueError(f"{row['resource']['name']}: selected {label} branch has no LoRA tensors")
        for branch, strength in ((video, sm), (audio, sa)):
            if strength:
                model, _ = comfy.sd.load_lora_for_models(model, None, branch, strength, 0.0, lora_metadata=metadata)
    else:
        patched_model, patched_clip = comfy.sd.load_lora_for_models(
            model if sm else None, clip if sc else None, weights, sm, sc, lora_metadata=metadata,
        )
        model, clip = (patched_model if sm else model), (patched_clip if sc else clip)
    return model, clip


def _describe(row):
    targets = row["targets"]
    values = [f"{'video' if key == 'model' and row['mode'] == 'ltx' else key}={targets[key]['strength']:g}"
              for key in ("model", "clip", "audio") if targets[key]["enabled"]]
    return f"<lora:{row['resource']['name']}:{','.join(values)}>"


@with_loader_execution
def apply_lora_stack(model=None, clip=None, lora_stack=None):
    prepared = _prepare([] if lora_stack is None else lora_stack, model, clip)
    adapter = lora_adapters.nunchaku_lora_adapter(model)
    if adapter:
        # Native wrappers consume the complete ordered model stack in one call.
        # CLIP-only rows never enter those wrappers or clear their existing LoRAs.
        model_rows = [(row["resource"]["name"], _strength(row, "model"), None)
                      for row, _ in prepared if _strength(row, "model")]
        if model_rows:
            model, _, _ = adapter(model, None, model_rows)
        for row, request in prepared:
            if _strength(row, "clip"):
                clip_row = {**row, "targets": {**row["targets"], "model": {"enabled": False, "strength": 0.0}}}
                _, clip = _apply_targets(None, clip, clip_row, request.files[row["id"]].path)
    else:
        # ZImageModelPatcher retains its native patch_weight_to_device adapter
        # through ComfyUI's clone/add_patches API, just as in the existing loader.
        for row, request in prepared:
            model, clip = _apply_targets(model, clip, row, request.files[row["id"]].path)
    return model, clip, " ".join(_describe(row) for row, _ in prepared)
