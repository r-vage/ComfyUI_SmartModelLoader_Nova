"""Shared, read-only local file and template catalog for loader controls."""

import folder_paths

from .configuration import validate_profile
from .templates import list_configuration_presets


def collect_catalog(*, profile="smart"):
    validate_profile(profile)
    result = {}
    if profile == "lora":
        return {"files": {"loras": folder_paths.get_filename_list("loras")},
                "presets": list_configuration_presets(profile=profile)}
    roles = (("clip", "text_encoders") if profile == "clip" else
             ("checkpoints", "diffusion_models", "diffusion_models_gguf", "vae", "clip", "text_encoders", "loras"))
    for role in roles:
        result[role] = folder_paths.get_filename_list(role) if role in folder_paths.folder_names_and_paths else []
    result["clip"] = sorted(set(result["clip"] + result.pop("text_encoders")), key=str.casefold)
    if profile == "clip":
        return {"files": result}
    result["diffusion_models_gguf"] = sorted(set(result["diffusion_models_gguf"] + [
        name for name in result["diffusion_models"] if name.lower().endswith(".gguf")
    ]), key=str.casefold)
    return {"files": result, "presets": list_configuration_presets(profile=profile)}
