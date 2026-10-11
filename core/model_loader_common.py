from __future__ import annotations

# Shared folder registration, LoRA, latent, model sampling and VAE helpers.
from typing import Any

import comfy  # type: ignore
import comfy.latent_formats  # type: ignore
import comfy.ldm.wan.vae2_2  # type: ignore
import comfy.model_management  # type: ignore
import comfy.model_patcher  # type: ignore
import comfy.model_sampling  # type: ignore
import comfy.sd  # type: ignore
import comfy.taesd.taesd  # type: ignore
import comfy.utils  # type: ignore
import folder_paths  # type: ignore
import torch  # type: ignore

from .gguf_wrapper import GGUF_AVAILABLE
from .logger import log
from .model_loader import pipes as _pipes
from .model_loader.blockswap import apply_blockswap as _apply_blockswap
from .model_loader.integrity import read_safetensors_header
from .model_loader.lora_adapters import nunchaku_lora_adapter
from .model_loader.qwen_vae import normalize_qwen_vae
from .model_loader.validation import resolve_model_file

OMIT = _pipes.OMIT
build_pipe = _pipes.build_pipe

# ── Folder path registration (runs once on import) ───────────────────

if GGUF_AVAILABLE:
    base = folder_paths.folder_names_and_paths.get("diffusion_models_gguf", ([], {}))
    base = base[0] if isinstance(base[0], (list, set, tuple)) else []
    orig, _ = folder_paths.folder_names_and_paths.get("diffusion_models", ([], {}))
    folder_paths.folder_names_and_paths["diffusion_models_gguf"] = (
        orig or base,
        {".gguf"},
    )

    # Add .gguf extension to clip folder
    if "clip" in folder_paths.folder_names_and_paths:
        _clip_data = folder_paths.folder_names_and_paths["clip"]
        _clip_paths, _clip_exts = _clip_data[0], (
            _clip_data[1] if len(_clip_data) >= 2 else ([], {})
        )
        if ".gguf" not in _clip_exts:
            _clip_exts = (
                set(_clip_exts)
                if isinstance(_clip_exts, set)
                else set(_clip_exts.keys()) if isinstance(_clip_exts, dict) else set()
            )
            _clip_exts.add(".gguf")
            folder_paths.folder_names_and_paths["clip"] = (_clip_paths, _clip_exts)
            if (
                hasattr(folder_paths, "filename_list_cache")
                and "clip" in folder_paths.filename_list_cache
            ):
                del folder_paths.filename_list_cache["clip"]
            if hasattr(folder_paths, "cache_helper"):
                folder_paths.cache_helper.clear()

    # Add .gguf extension to text_encoders folder
    if "text_encoders" in folder_paths.folder_names_and_paths:
        _te_data = folder_paths.folder_names_and_paths["text_encoders"]
        _te_paths, _te_exts = _te_data[0], (
            _te_data[1] if len(_te_data) >= 2 else ([], {})
        )
        if ".gguf" not in _te_exts:
            _te_exts = (
                set(_te_exts)
                if isinstance(_te_exts, set)
                else set(_te_exts.keys()) if isinstance(_te_exts, dict) else set()
            )
            _te_exts.add(".gguf")
            folder_paths.folder_names_and_paths["text_encoders"] = (_te_paths, _te_exts)
            if (
                hasattr(folder_paths, "filename_list_cache")
                and "text_encoders" in folder_paths.filename_list_cache
            ):
                del folder_paths.filename_list_cache["text_encoders"]
            if hasattr(folder_paths, "cache_helper"):
                folder_paths.cache_helper.clear()

for _folder_name in ["checkpoints", "diffusion_models"]:
    if _folder_name in folder_paths.folder_names_and_paths:
        _folder_data = folder_paths.folder_names_and_paths[_folder_name]
        if len(_folder_data) >= 2:
            _paths, _exts = _folder_data[0], _folder_data[1]
        else:
            continue
        _exts = (
            set(_exts)
            if isinstance(_exts, set)
            else set(_exts.keys()) if isinstance(_exts, dict) else set()
        )
        for _ext in [".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".bin"]:
            _exts.add(_ext)
        folder_paths.folder_names_and_paths[_folder_name] = (_paths, _exts)


# ── Nunchaku detection ────────────────────────────────────────────────


def is_nunchaku_model(model: Any) -> bool:
    return is_zimage_model(model) or nunchaku_lora_adapter(model) is not None


def is_zimage_model(model: Any) -> bool:
    # Check if a model is a Nunchaku ZImage model by detecting ZImageModelPatcher.
    # ZImage uses a custom ModelPatcher subclass directly, not a diffusion_model wrapper.
    return type(model).__name__ == "ZImageModelPatcher"


# ── LoRA application ──────────────────────────────────────────────────


def apply_loras(model: Any, clip: Any, lora_params: list) -> tuple:
    # Apply LoRAs to model (standard, Nunchaku Flux/Qwen, or ZImage).
    # Returns (modified_model, modified_clip).
    if not lora_params:
        return (model, clip)

    if is_zimage_model(model):
        log.msg(
            "LoRA",
            "Detected Nunchaku ZImage model, applying LoRAs via standard ComfyUI loader",
        )
        return _apply_loras_zimage(model, clip, lora_params)
    if is_nunchaku_model(model):
        log.msg("LoRA", "Detected Nunchaku model, applying LoRAs via wrapper")
        return nunchaku_lora_adapter(model)(
            model, clip, [(name, strength, None) for name, strength in lora_params],
        )[:2]
    log.msg("LoRA", "Applying LoRAs to standard model")
    return _apply_loras_standard(model, clip, lora_params)


def _apply_loras_standard(model: Any, clip: Any, lora_params: list) -> tuple:
    # Apply LoRAs to standard (non-Nunchaku) models using ComfyUI's loader
    model_lora = model
    clip_lora = clip

    for lora_name, model_weight in lora_params:
        lora_path = str(
            resolve_model_file("loras", lora_name, reference_type="lora").path,
        )
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
        model_lora, clip_lora = comfy.sd.load_lora_for_models(
            model_lora, clip_lora, lora, model_weight, model_weight,
        )
        log.msg("LoRA", f"Applied {lora_name} with weight {model_weight}")

    return (model_lora, clip_lora)


def _apply_loras_zimage(model: Any, clip: Any, lora_params: list) -> tuple:
    # Apply LoRAs to Nunchaku ZImage models using standard ComfyUI loader.
    # ZImageModelPatcher overrides patch_weight_to_device() to handle SVDQ quantized layers,
    # so comfy.sd.load_lora_for_models() works correctly via add_patches().
    ret_model = model.clone()
    ret_clip = clip

    for lora_name, model_weight in lora_params:
        lora_path = str(
            resolve_model_file("loras", lora_name, reference_type="lora").path,
        )
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
        ret_model, ret_clip = comfy.sd.load_lora_for_models(
            ret_model, ret_clip, lora, model_weight, model_weight,
        )
        log.msg(
            "LoRA", f"Applied ZImage LoRA {lora_name} with weight {model_weight}",
        )

    return (ret_model, ret_clip)


# ── Latent channel / downscale detection ──────────────────────────────

LATENT_CHANNELS = 4
LATENT_DOWNSCALE = 8


def detect_latent_channels(vae_obj) -> int:
    # Infer latent channel count from a VAE-like object.
    try:
        channels = vae_obj.channels if hasattr(vae_obj, "channels") else None
        if isinstance(channels, int):
            return channels
        latent_channels = (
            vae_obj.latent_channels if hasattr(vae_obj, "latent_channels") else None
        )
        if isinstance(latent_channels, int):
            return latent_channels
        for attr in ("encoder", "conv_in", "down_blocks"):
            sub = getattr(vae_obj, attr, None)
            if sub is not None and hasattr(sub, "weight"):
                return sub.weight.shape[0]
    except (AttributeError, IndexError, KeyError, TypeError):
        log.debug("VAE", "Could not infer latent channels; using the default")
    return LATENT_CHANNELS


def detect_latent_downscale(vae_obj) -> int:
    # Infer spatial downscale ratio from a VAE-like object.
    # Returns an integer ratio (default 8). Handles both simple integers
    # and tuple/list values (where the second element is the spatial downscale factor).
    try:
        ratio = getattr(vae_obj, "downscale_ratio", None)
        if isinstance(ratio, int) and ratio > 0:
            return ratio
        if (
            isinstance(ratio, (tuple, list))
            and len(ratio) > 1
            and isinstance(ratio[1], int)
            and ratio[1] > 0
        ):
            return ratio[1]
    except (AttributeError, IndexError, TypeError):
        log.debug("VAE", "Could not infer latent downscale; using the default")
    return LATENT_DOWNSCALE


# ── LoRA helpers ──────────────────────────────────────────────────────


def format_lora_string(lora_params: list[tuple]) -> str:
    # Generate LoRA metadata string for pipe.
    if not lora_params:
        return ""
    return " ".join(f"<lora:{name}:{weight}:{weight}>" for name, weight in lora_params)


# ── Model sampling ────────────────────────────────────────────────────


def apply_model_sampling(
    model,
    sampling_method: str,
    shift: float,
    base_shift: float = 0.5,
    width: int = 1024,
    height: int = 1024,
    original_timesteps: int = 50,
    zsnr: bool = False,
    sampling_subtype: str = "eps",
    sigma_max: float = 120.0,
    sigma_min: float = 0.002,
    shift_video: float = 12.0,
    shift_audio: float = 3.0,
):
    # Apply model sampling configuration based on method.
    if sampling_method == "None" or not sampling_method:
        return model

    if sampling_method == "SD3":
        return _apply_sd3_sampling(model, shift=shift, multiplier=1000.0)
    if sampling_method == "AuraFlow":
        return _apply_auraflow_sampling(model, shift=shift, multiplier=1.0)
    if sampling_method == "Flux":
        return _apply_flux_sampling(
            model, max_shift=shift, base_shift=base_shift, width=width, height=height,
        )
    if sampling_method == "Qwen Image 2.1":
        return _apply_qwen_image21_sampling(
            model, max_shift=shift, base_shift=base_shift, width=width, height=height,
        )
    if sampling_method == "Stable Cascade":
        return _apply_stable_cascade_sampling(model, shift=shift)
    if sampling_method == "LCM":
        return _apply_lcm_sampling(
            model, original_timesteps=original_timesteps, zsnr=zsnr,
        )
    if sampling_method == "ContinuousEDM":
        return _apply_continuous_edm_sampling(
            model,
            sampling_subtype=sampling_subtype,
            sigma_max=sigma_max,
            sigma_min=sigma_min,
        )
    if sampling_method == "ContinuousV":
        return _apply_continuous_v_sampling(
            model, sigma_max=sigma_max, sigma_min=sigma_min,
        )
    if sampling_method == "LTXV":
        return _apply_ltxv_sampling(model, max_shift=shift, base_shift=base_shift)
    if sampling_method == "MiniMax H3":
        return _apply_minimax_h3_sampling(
            model,
            shift_video=shift_video,
            shift_audio=shift_audio,
        )
    log.warning(
        "Model Sampling", f"Unknown sampling method '{sampling_method}', skipping",
        notify=True,
    )
    return model


def _apply_sd3_sampling(model, shift: float, multiplier: float = 1000.0):
    m = model.clone()
    sampling_base = comfy.model_sampling.ModelSamplingDiscreteFlow
    sampling_type = comfy.model_sampling.CONST

    class ModelSamplingAdvanced(sampling_base, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(shift=shift, multiplier=multiplier)
    m.add_object_patch("model_sampling", model_sampling)
    log.msg(
        "Model Sampling",
        f"Applied SD3 sampling: shift={shift}, multiplier={multiplier}",
    )
    return m


def _apply_auraflow_sampling(model, shift: float, multiplier: float = 1.0):
    m = model.clone()
    sampling_base = comfy.model_sampling.ModelSamplingDiscreteFlow
    sampling_type = comfy.model_sampling.CONST

    class ModelSamplingAdvanced(sampling_base, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(shift=shift, multiplier=multiplier)
    m.add_object_patch("model_sampling", model_sampling)
    log.msg(
        "Model Sampling",
        f"Applied AuraFlow sampling: shift={shift}, multiplier={multiplier}",
    )
    return m


def _apply_flux_sampling(
    model, max_shift: float, base_shift: float, width: int, height: int,
):
    m = model.clone()
    x1 = 256
    x2 = 4096
    mm = (max_shift - base_shift) / (x2 - x1)
    b = base_shift - mm * x1
    shift = (width * height / (8 * 8 * 2 * 2)) * mm + b

    sampling_base = comfy.model_sampling.ModelSamplingFlux
    sampling_type = comfy.model_sampling.CONST

    class ModelSamplingAdvanced(sampling_base, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(shift=shift)
    m.add_object_patch("model_sampling", model_sampling)
    log.msg(
        "Model Sampling",
        f"Applied Flux sampling: max_shift={max_shift}, base_shift={base_shift}, width={width}, height={height}, calculated_shift={shift:.4f}",
    )
    return m


def _apply_qwen_image21_sampling(
    model, max_shift: float, base_shift: float, width: int, height: int,
):
    # Qwen 2.1 has one token per 16x16 output pixels, without Flux's 2x2 packing.
    config = model.model.model_config
    if config.unet_config.get("image_model") != "qwen_image21":
        raise ValueError("Qwen Image 2.1 sampling requires a Qwen Image 2.1 diffusion model.")
    tokens = (width // 16) * (height // 16)
    shift = base_shift + (max_shift - base_shift) * (tokens - 256) / (8192 - 256)

    class QwenImage21Sampling(comfy.model_sampling.ModelSamplingFlux, comfy.model_sampling.CONST):
        pass

    model_sampling = QwenImage21Sampling(config)
    try:
        model_sampling.set_parameters(shift=shift)
    except OverflowError as error:
        raise ValueError("Qwen Image 2.1 shift is too large for the selected resolution.") from error
    if not torch.isfinite(model_sampling.sigmas).all():
        raise ValueError("Qwen Image 2.1 shift produces non-finite sigmas; reduce the shifts or resolution.")
    m = model.clone()
    m.add_object_patch("model_sampling", model_sampling)
    log.msg(
        "Model Sampling",
        f"Applied Qwen Image 2.1 sampling: max_shift={max_shift}, base_shift={base_shift}, "
        f"width={width}, height={height}, tokens={tokens}, calculated_shift={shift:.4f}",
    )
    return m


def _apply_stable_cascade_sampling(model, shift: float):
    m = model.clone()
    sampling_base = comfy.model_sampling.StableCascadeSampling
    sampling_type = comfy.model_sampling.EPS

    class ModelSamplingAdvanced(sampling_base, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(shift=shift)
    m.add_object_patch("model_sampling", model_sampling)
    log.msg("Model Sampling", f"Applied Stable Cascade sampling: shift={shift}")
    return m


def _apply_lcm_sampling(model, original_timesteps: int = 50, zsnr: bool = False):
    m = model.clone()

    class LCM(comfy.model_sampling.EPS):
        def calculate_denoised(self, sigma, model_output, model_input):
            timestep = self.timestep(sigma).view(
                sigma.shape[:1] + (1,) * (model_output.ndim - 1),
            )
            sigma = sigma.view(sigma.shape[:1] + (1,) * (model_output.ndim - 1))
            x0 = model_input - model_output * sigma
            sigma_data = 0.5
            scaled_timestep = timestep * 10.0
            c_skip = sigma_data**2 / (scaled_timestep**2 + sigma_data**2)
            c_out = scaled_timestep / (scaled_timestep**2 + sigma_data**2) ** 0.5
            return c_out * x0 + c_skip * model_input

    class ModelSamplingDiscreteDistilled(comfy.model_sampling.ModelSamplingDiscrete):
        def __init__(self, model_config=None):
            super().__init__(model_config, zsnr=zsnr)
            self.original_timesteps = original_timesteps
            self.skip_steps = self.num_timesteps // self.original_timesteps
            sigmas_valid = torch.zeros((self.original_timesteps), dtype=torch.float32)
            for x in range(self.original_timesteps):
                sigmas_valid[self.original_timesteps - 1 - x] = self.sigmas[
                    self.num_timesteps - 1 - x * self.skip_steps
                ]
            self.set_sigmas(sigmas_valid)

        def timestep(self, sigma):
            log_sigma = sigma.log()
            dists = log_sigma.to(self.log_sigmas.device) - self.log_sigmas[:, None]
            return (
                dists.abs().argmin(dim=0).view(sigma.shape) * self.skip_steps
                + (self.skip_steps - 1)
            ).to(sigma.device)

        def sigma(self, timestep):
            t = torch.clamp(
                (
                    (
                        timestep.float().to(self.log_sigmas.device)
                        - (self.skip_steps - 1)
                    )
                    / self.skip_steps
                ).float(),
                min=0,
                max=(len(self.sigmas) - 1),
            )
            low_idx = t.floor().long()
            high_idx = t.ceil().long()
            w = t.frac()
            log_sigma = (1 - w) * self.log_sigmas[low_idx] + w * self.log_sigmas[
                high_idx
            ]
            return log_sigma.exp().to(timestep.device)

    sampling_base = ModelSamplingDiscreteDistilled
    sampling_type = LCM

    class ModelSamplingAdvanced(sampling_base, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    m.add_object_patch("model_sampling", model_sampling)
    log.msg(
        "Model Sampling",
        f"Applied LCM sampling: original_timesteps={original_timesteps}, zsnr={zsnr}",
    )
    return m


def _apply_continuous_edm_sampling(
    model,
    sampling_subtype: str = "eps",
    sigma_max: float = 120.0,
    sigma_min: float = 0.002,
):
    m = model.clone()
    sampling_base = comfy.model_sampling.ModelSamplingContinuousEDM
    latent_format = None
    sigma_data = 1.0

    if sampling_subtype == "eps":
        sampling_type = comfy.model_sampling.EPS
    elif sampling_subtype == "edm" or sampling_subtype == "edm_playground_v2.5":
        sampling_type = comfy.model_sampling.EDM
        sigma_data = 0.5
        if sampling_subtype == "edm_playground_v2.5":
            latent_format = comfy.latent_formats.SDXL_Playground_2_5()
    elif sampling_subtype == "v_prediction":
        sampling_type = comfy.model_sampling.V_PREDICTION
    elif sampling_subtype == "cosmos_rflow":
        sampling_type = comfy.model_sampling.COSMOS_RFLOW
        sampling_base = comfy.model_sampling.ModelSamplingCosmosRFlow
    else:
        log.warning(
            "Model Sampling",
            f"Unknown ContinuousEDM subtype '{sampling_subtype}', using eps",
            notify=True,
        )
        sampling_type = comfy.model_sampling.EPS

    class ModelSamplingAdvanced(sampling_base, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(sigma_min, sigma_max, sigma_data)
    m.add_object_patch("model_sampling", model_sampling)
    if latent_format is not None:
        m.add_object_patch("latent_format", latent_format)
    log.msg(
        "Model Sampling",
        f"Applied ContinuousEDM sampling: subtype={sampling_subtype}, sigma_max={sigma_max}, sigma_min={sigma_min}, sigma_data={sigma_data}",
    )
    return m


def _apply_continuous_v_sampling(
    model, sigma_max: float = 500.0, sigma_min: float = 0.03,
):
    m = model.clone()
    sampling_type = comfy.model_sampling.V_PREDICTION
    sigma_data = 1.0

    class ModelSamplingAdvanced(comfy.model_sampling.ModelSamplingContinuousV, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(sigma_min, sigma_max, sigma_data)
    m.add_object_patch("model_sampling", model_sampling)
    log.msg(
        "Model Sampling",
        f"Applied ContinuousV sampling: sigma_max={sigma_max}, sigma_min={sigma_min}",
    )
    return m


def _apply_ltxv_sampling(model, max_shift: float = 2.05, base_shift: float = 0.95):
    m = model.clone()
    tokens = 4096
    x1 = 1024
    x2 = 4096
    mm = (max_shift - base_shift) / (x2 - x1)
    b = base_shift - mm * x1
    shift = tokens * mm + b

    sampling_base = comfy.model_sampling.ModelSamplingFlux
    sampling_type = comfy.model_sampling.CONST

    class ModelSamplingAdvanced(sampling_base, sampling_type):  # type: ignore[misc,valid-type]
        pass

    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(shift=shift)
    m.add_object_patch("model_sampling", model_sampling)
    log.msg(
        "Model Sampling",
        f"Applied LTXV sampling: max_shift={max_shift}, base_shift={base_shift}, tokens={tokens}, calculated_shift={shift:.4f}",
    )
    return m


def _apply_minimax_h3_sampling(
    model,
    shift_video: float = 12.0,
    shift_audio: float = 3.0,
):
    m = model.clone()

    class ModelSamplingAdvanced(  # type: ignore[misc,valid-type]
        comfy.model_sampling.ModelSamplingAV,
        comfy.model_sampling.CONST,
    ):
        pass

    original = m.get_model_object("model_sampling")
    model_sampling = ModelSamplingAdvanced(model.model.model_config)
    model_sampling.set_parameters(shift=shift_video, audio_shift=shift_audio)
    if hasattr(original, "noise_scale"):
        model_sampling.set_noise_scale(original.noise_scale)
    m.add_object_patch("model_sampling", model_sampling)

    transformer_options = m.model_options["transformer_options"] = m.model_options.get(
        "transformer_options",
        {},
    ).copy()
    transformer_options["minimax_h3_sigma_shift_video"] = shift_video
    transformer_options["minimax_h3_sigma_shift_audio"] = shift_audio
    log.msg(
        "Model Sampling",
        f"Applied MiniMax H3 sampling: shift_video={shift_video}, shift_audio={shift_audio}",
    )
    return m


# ── BlockSwap helper ──────────────────────────────────────────────────


def apply_blockswap(
    model,
    blocks_to_swap: int,
    offload_embeddings: bool,
    log_prefix: str,
    is_nunchaku: bool = False,
    is_qwen: bool = False,
    is_zimage: bool = False,
):
    return _apply_blockswap(
        model,
        blocks_to_swap,
        offload_embeddings,
        log_prefix,
        is_nunchaku=is_nunchaku,
        is_qwen=is_qwen,
        is_zimage=is_zimage,
    )


# ── External VAE loader ─────────────────────────────────────────────
# Preserve safetensors metadata for upstream architecture/scale selection.
# Normalize recognized Qwen Image 2.1 Diffusers weights before construction.


def load_custom_vae(
    vae_name: str, disable_offload: bool | None = None,
) -> comfy.sd.VAE:
    # Load an external VAE file by name. Returns a stock comfy.sd.VAE.
    # Set disable_offload=True to force a full load (skip the offload pass);
    # leaving it None preserves the upstream per-VAE default.
    vae_path = str(
        resolve_model_file("vae", vae_name, reference_type="vae").path,
    )
    sd, metadata = comfy.utils.load_torch_file(vae_path, return_metadata=True)
    vae = comfy.sd.VAE(sd=normalize_qwen_vae(sd), metadata=metadata)
    vae.throw_exception_if_invalid()
    if disable_offload is not None:
        vae.disable_offload = disable_offload
    return vae


def load_audio_vae_from_path(vae_path: str) -> comfy.sd.VAE | None:
    # Load an LTXV/LTX2 audio VAE from a file path. Audio VAEs ship as
    # checkpoints carrying `audio_vae.` + `vocoder.` prefixed weights (they may
    # also be baked into a Standard Checkpoint alongside the image VAE).
    # Filtering + remapping those keys mirrors ComfyUI's LTXVAudioVAELoader.
    # Returns None when the file contains no audio VAE keys (so callers can warn).
    sd, metadata = comfy.utils.load_torch_file(vae_path, return_metadata=True)
    audio_sd = comfy.utils.state_dict_prefix_replace(
        sd, {"audio_vae.": "autoencoder.", "vocoder.": "vocoder."}, filter_keys=True,
    )
    if not audio_sd:
        return None
    vae = comfy.sd.VAE(sd=audio_sd, metadata=metadata)
    vae.throw_exception_if_invalid()
    return vae


def safetensors_has_audio_vae(path: str) -> bool:
    # Cheap header-only peek (no tensor data) to detect a baked LTX audio VAE.
    # Reads just the safetensors JSON header (~1-16ms regardless of file size).
    if not path or not path.lower().endswith((".safetensors", ".sft")):
        return False
    try:
        header = read_safetensors_header(path)
        return any(
            k.startswith(("vocoder.", "audio_vae."))
            for k in header
            if k != "__metadata__"
        )
    except (OSError, ValueError):
        return False
