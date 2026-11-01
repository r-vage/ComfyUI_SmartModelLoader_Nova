"""Native overrides for the existing Smart Loader configuration contract."""

from .configuration import MODES, SAMPLER, choice, editor_spec, number

SETTINGS_TYPE = "SML2_LOADER_SETTINGS"
SETTINGS_NODE_ID = "Smart Model Loader Settings [SML2]"
INHERIT = "(inherit)"
NONE = "(none)"
INHERIT_TOOLTIP = (
    "Inherit uses the selected template for settings saved in templates. "
    "Settings not saved in templates, such as seed, cleanup and denoise, use the Smart Model Loader panel. "
    "When no template is selected, all inherited settings use the panel."
)


def native_fields(spec=None):
    spec = spec or editor_spec()

    def select(label, values):
        return choice(label, [INHERIT, *values], INHERIT)

    def numeric(field, sentinel):
        return {**field, "default": sentinel, "inherit": sentinel}

    def file(label, role, *, removable=False):
        return {"label": label, "type": "file", "role": role, "default": INHERIT,
                "removable": removable}

    toggle = ["enabled", "disabled"]
    fields = {
        "template": {"label": "Template", "type": "template", "default": INHERIT},
        "model_mode": select("Model mode", MODES),
        "model_name": file("Model", "model"),
        "weight_dtype": select("UNet weight dtype", MODES["unet"]["options"]["weight_dtype"]["values"]),
        "clip_source": select("CLIP source", ["disabled", "baked", "external", "combined"]),
        "clip_type": select("CLIP type", spec["clipTypes"]),
        **{f"clip_name{index}": file(f"Encoder {index}", "clip", removable=True) for index in range(1, 5)},
        "clip_skip": select("CLIP skip", ["disabled", *map(str, range(-1, -25, -1))]),
        "vae_source": select("VAE source", ["disabled", "baked", "external"]),
        "vae_name": file("VAE", "vae"),
        "audio_vae_source": select("Audio VAE source", ["disabled", "baked", "external"]),
        "audio_vae_name": file("Audio VAE", "vae"),
        "loras": select("Template / panel LoRAs", ["disabled"]),
        "model_sampling": select("Model sampling", spec["sampling"]),
        **{key: numeric(number(label, 0, 0, 100, .01), -1)
           for key, label in (("shift", "Shift"), ("base_shift", "Base shift"),
                              ("shift_video", "Video shift"), ("shift_audio", "Audio shift"))},
        "sampler": select("Sampler settings", toggle),
        "steps": numeric(SAMPLER["steps"], 0),
        "cfg": numeric(SAMPLER["cfg"], -1),
        "sampler_name": select("Sampler", spec["samplers"]),
        "scheduler": select("Scheduler", spec["schedulers"]),
        "denoise": numeric(SAMPLER["denoise"], -1),
        "flux_guidance": numeric(number("Flux guidance", 3.5, 0, 1000, .1), -1),
        "seed": {"label": "Seed", "type": "seed", "default": None},
    }
    fields["template"]["tip"] = (
        "Choose an existing Smart Loader template for fast switching. (inherit) uses the Smart Model Loader panel. "
        "Explicit overrides below win; template selection never saves or downloads anything."
    )
    fields["seed"]["tip"] = (
        "Optional INT seed input. Connect a separate seed node to use its value. "
        "When disconnected, the Smart Model Loader panel supplies the seed and its policy. "
        "Templates do not store seeds. This node does not generate seeds."
    )
    fields["loras"]["tip"] = (
        "(inherit) uses the selected template's LoRAs, or the loader panel's LoRAs when no template is selected. "
        "disabled skips that stack. LoRA files, strengths and order are configured in the panel/template."
    )
    return fields


def native_options(field, catalog):
    if field["type"] == "template":
        return [INHERIT, *catalog["presets"]]
    if field["type"] == "file":
        roles = ("checkpoints", "diffusion_models", "diffusion_models_gguf") if field["role"] == "model" else (
            field["role"],
        )
        names = sorted({name for role in roles for name in catalog["files"].get(role, [])}, key=str.casefold)
        return [INHERIT, *([NONE] if field["removable"] else []), *names]
    return field["values"]
