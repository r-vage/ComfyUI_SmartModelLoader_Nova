"""Native Nunchaku LoRA adapters with branch-local wrapper state."""
# ruff: noqa: SLF001 - native wrapper state retained across adapter construction

import copy

import folder_paths


def _model_wrapper(model):
    wrapper = model.get_model_object("diffusion_model")
    return getattr(wrapper, "_orig_mod", wrapper)


def nunchaku_lora_adapter(model):
    if is_nunchaku_qwen_model(model):
        return _apply_lora_stack_nunchaku_qwen
    if is_nunchaku_flux_model(model):
        return _apply_lora_stack_nunchaku_flux
    return None


def is_nunchaku_flux_model(model):
    try:
        return type(_model_wrapper(model)).__name__ == "ComfyFluxWrapper"
    except (AttributeError, TypeError):
        return False


def is_nunchaku_qwen_model(model):
    try:
        return type(_model_wrapper(model)).__name__ == "ComfyQwenImageWrapper"
    except (AttributeError, TypeError):
        return False


def _build_lora_string(lora_params):
    return " ".join(
        f"<lora:{name}:{strength}>" if clip is None else f"<lora:{name}:{strength}:{clip}>"
        for name, strength, clip in lora_params
    )


def _apply_lora_stack_nunchaku_flux(model, clip, lora_params):
    from nunchaku.lora.flux import to_diffusers

    from ..nunchaku_wrapper import ComfyFluxWrapper

    original = _model_wrapper(model)
    wrapper = ComfyFluxWrapper(
        original.model,
        config=original.config.copy(),
        pulid_pipeline=original.pulid_pipeline,
        customized_forward=original.customized_forward,
        forward_kwargs=original.forward_kwargs.copy(),
        ctx_for_copy=original.ctx_for_copy,
    )
    if hasattr(original, "_original_time_text_embed"):
        wrapper._original_time_text_embed = original._original_time_text_embed

    # Config and wrapper belong to this patcher; quantized weights remain shared.
    # ComfyUI installs/restores object patches when switching sampled branches.
    model_config = copy.copy(model.get_model_object("model_config"))
    model_config.unet_config = model_config.unet_config.copy()
    channels = model_config.unet_config["in_channels"]
    wrapper.loras = []
    for name, strength, _clip_strength in lora_params:
        path = folder_paths.get_full_path_or_raise("loras", name)
        wrapper.loras.append((path, strength))
        weights = to_diffusers(path)
        if "transformer.x_embedder.lora_A.weight" in weights:
            packed_channels = weights["transformer.x_embedder.lora_A.weight"].shape[1]
            if packed_channels % 4:
                raise ValueError(f"Invalid LoRA input channels: {packed_channels}")
            channels = max(channels, packed_channels // 4)
    model_config.unet_config["in_channels"] = channels
    # PuLID's native copy helper reconstructs its base model from this context.
    # Preserve this branch's input channels without changing the original context.
    wrapper.ctx_for_copy = original.ctx_for_copy.copy()
    if "model_config" in wrapper.ctx_for_copy:
        wrapper.ctx_for_copy["model_config"] = model_config

    patched = model.clone()
    patched.add_object_patch("diffusion_model", wrapper)
    patched.add_object_patch("model_config", model_config)
    return patched, clip, _build_lora_string(lora_params)


def _apply_lora_stack_nunchaku_qwen(model, clip, lora_params):
    from ..nunchaku_wrapper import ComfyQwenImageWrapper

    original = _model_wrapper(model)
    wrapper = ComfyQwenImageWrapper(
        original.model, original.config.copy(), original.customized_forward,
        original.forward_kwargs.copy(), original.cpu_offload_setting, original.vram_margin_gb,
    )
    wrapper.loras = [(folder_paths.get_full_path_or_raise("loras", name), strength)
                     for name, strength, _clip_strength in lora_params]
    # Start a fresh inference cache for the new LoRA setup.
    patched = model.clone()
    patched.add_object_patch("diffusion_model", wrapper)
    return patched, clip, _build_lora_string(lora_params)
