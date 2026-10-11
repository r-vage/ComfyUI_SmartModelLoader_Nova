# Locked, atomic Smart Model Loader template persistence.

import copy
import os
import re
import uuid
from pathlib import Path
from typing import Any

from ..json_store import (
    JsonStoreError,
    _fsync_directory,
    locked_path,
    read_json_object,
    update_json_object,
    write_json_object,
)
from ..logger import log
from .lifecycle import maintenance_if_idle

_LOG_PREFIX = "LoaderTemplates"
_REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_DIR = str(_REPO_ROOT / "templates")
MAX_TEMPLATE_BYTES = 1024 * 1024
_NAME_RE = re.compile(r"^[^\x00-\x1f/\\]{1,128}$")

_PATH_FIELDS = [
    "ckpt_name",
    "unet_name",
    "nunchaku_name",
    "qwen_name",
    "zimage_name",
    "gguf_name",
    "clip_name1",
    "clip_name2",
    "clip_name3",
    "clip_name4",
    "vae_name",
    "audio_vae_name",
] + [f"lora_name_{index}" for index in range(1, 11)]

_FEATURE_BOOL_MAP = {
    "clip": "configure_clip",
    "vae": "configure_vae",
    "audio_vae": "configure_audio_vae",
    "latent": "configure_latent",
    "sampler": "configure_sampler",
    "lora": "configure_model_only_lora",
    "model_sampling": "configure_model_sampling",
    "block_swap": "configure_blockswap",
}


def get_template_dir() -> str:
    ensure_template_dir()
    return TEMPLATE_DIR


def ensure_template_dir() -> None:
    Path(TEMPLATE_DIR).mkdir(parents=True, exist_ok=True)


def is_safe_template_name(name: str) -> bool:
    return (
        isinstance(name, str)
        and name not in {"", "None", ".", ".."}
        and ".." not in name
        and _NAME_RE.fullmatch(name) is not None
    )


def _template_path(name: str, *, require_existing: bool = False) -> Path:
    if not is_safe_template_name(name):
        raise ValueError("Invalid template name")
    root = Path(TEMPLATE_DIR).resolve(strict=True)
    candidate = root / f"{name}.json"
    if candidate.is_symlink():
        raise ValueError("Symlinked templates are forbidden")
    resolved = candidate.resolve(strict=require_existing)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError("Template path escapes its storage directory") from error
    return resolved


def normalize_template_paths(config: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(config)
    for field in _PATH_FIELDS:
        value = normalized.get(field)
        if isinstance(value, str):
            normalized[field] = value.replace("\\", "/")
    return normalized


def _ensure_template_compat(config: dict[str, Any]) -> dict[str, Any]:
    compatible = copy.deepcopy(config)
    compatible.pop("denoise", None)
    has_features = isinstance(compatible.get("features"), list)
    has_booleans = any(key in compatible for key in _FEATURE_BOOL_MAP.values())
    if has_features and not has_booleans:
        features = set(compatible["features"])
        for feature, boolean_key in _FEATURE_BOOL_MAP.items():
            compatible[boolean_key] = feature in features
    elif has_booleans and not has_features:
        compatible["features"] = [
            feature
            for feature, boolean_key in _FEATURE_BOOL_MAP.items()
            if compatible.get(boolean_key) is True
        ]
    return compatible


def _validate_template_object(config: Any) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise TypeError("Template config must be a JSON object")
    normalized = normalize_template_paths(config)
    normalized.pop("denoise", None)
    for field in _PATH_FIELDS:
        value = normalized.get(field)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"Template field {field} must be a string")
    features = normalized.get("features")
    if features is not None and (
        not isinstance(features, list)
        or not all(isinstance(feature, str) for feature in features)
    ):
        raise ValueError("Template features must be a string array")
    return normalized


def get_template_list() -> list[str]:
    ensure_template_dir()
    names = []
    for path in Path(TEMPLATE_DIR).iterdir():
        if path.is_symlink() or not path.is_file() or path.suffix.lower() != ".json":
            continue
        if is_safe_template_name(path.stem):
            names.append(path.stem)
    return ["None", *sorted(names, key=str.lower)]


def save_template(name: str, config: dict[str, Any]) -> bool:
    ensure_template_dir()
    try:
        target = _template_path(name)
        validated = _validate_template_object(config)
        if target.exists():
            # A malformed existing file is preserved for diagnosis.
            read_json_object(target)
        write_json_object(target, validated)
        return True
    except (JsonStoreError, OSError, TypeError, ValueError) as error:
        log.error(_LOG_PREFIX, f"Template was not saved: {type(error).__name__}: {error}")
        return False


def load_template(name: str) -> dict[str, Any]:
    if name in (None, "", "None"):
        return {}
    try:
        target = _template_path(name, require_existing=True)
        if target.stat().st_size > MAX_TEMPLATE_BYTES:
            raise ValueError("Template exceeds the size limit")
        return _ensure_template_compat(
            normalize_template_paths(read_json_object(target)),
        )
    except FileNotFoundError:
        return {}
    except (JsonStoreError, OSError, ValueError) as error:
        log.error(_LOG_PREFIX, f"Template was not loaded: {type(error).__name__}: {error}")
        return {}


def delete_template(name: str) -> bool:
    try:
        target = _template_path(name, require_existing=True)
        target.unlink()
        return True
    except FileNotFoundError:
        return False
    except (OSError, ValueError) as error:
        log.error(_LOG_PREFIX, f"Template was not deleted: {type(error).__name__}: {error}")
        return False


def get_template_mtime() -> float | None:
    ensure_template_dir()
    mtimes = [
        path.stat().st_mtime_ns
        for path in Path(TEMPLATE_DIR).iterdir()
        if path.is_file() and not path.is_symlink() and path.suffix.lower() == ".json"
    ]
    return max(mtimes) / 1_000_000_000 if mtimes else None


# All current editors use the standard template folder, separated by node profile.
def _configuration_preset_root(profile="smart") -> Path:
    from .configuration import validate_profile

    validate_profile(profile, preset=True)
    base = Path(TEMPLATE_DIR)
    root = base
    if base.is_symlink():
        raise ValueError("Preset directories must not be symlinks")
    if profile == "lora":
        root /= "lora-stack"
        if root.is_symlink():
            raise ValueError("Preset directories must not be symlinks")
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve(strict=True)


def _configuration_preset_path(name: str, *, profile="smart") -> Path:
    if not is_safe_template_name(name):
        raise ValueError("Invalid preset name")
    path = _configuration_preset_root(profile) / f"{name}.json"
    if path.is_symlink():
        raise ValueError("Symlinked presets are forbidden")
    return path


def list_configuration_presets(*, profile="smart") -> list[str]:
    return sorted((path.stem for path in _configuration_preset_root(profile).iterdir()
                   if path.suffix == ".json" and not path.is_symlink() and path.is_file()
                   and is_safe_template_name(path.stem)), key=str.casefold)


def _decode_configuration_preset(config, *, profile="smart") -> dict[str, Any]:
    from .configuration import validate_configuration

    legacy = (profile == "smart" and isinstance(config, dict) and "model_type" in config
              and "model" not in config and "version" not in config)
    if legacy:
        from .template_conversion import convert_template
        config = convert_template(config)
    else:
        config = validate_configuration(config, preset=True, profile=profile)
    return {"configuration": config, "needs_conversion": legacy}


def read_configuration_preset(name: str, *, profile="smart") -> dict[str, Any]:
    """Read the preset and report whether saving will convert its on-disk format."""
    path = _configuration_preset_path(name, profile=profile)
    if not path.is_file():
        raise ValueError("Preset does not exist")
    if path.stat().st_size > MAX_TEMPLATE_BYTES:
        raise ValueError("Preset exceeds the size limit")
    return _decode_configuration_preset(read_json_object(path), profile=profile)


def load_configuration_preset(name: str, *, profile="smart") -> dict[str, Any]:
    return read_configuration_preset(name, profile=profile)["configuration"]


def save_configuration_preset(name: str, configuration, *, overwrite: bool = False, profile="smart") -> None:
    from .configuration import validate_configuration

    validated = validate_configuration(configuration, preset=True, profile=profile)
    path = _configuration_preset_path(name, profile=profile)
    missing = {"_new_preset": uuid.uuid4().hex}

    def replace(current):
        if current != missing:
            # Do not destroy an invalid existing document, even with overwrite selected.
            _decode_configuration_preset(current, profile=profile)
            if not overwrite:
                raise ValueError("Preset already exists; choose another name or enable overwrite")
        current.clear()
        current.update(validated)

    update_json_object(path, replace, default=missing)


def delete_configuration_preset(name: str, *, prompt_queue=None, profile="smart") -> None:
    with maintenance_if_idle(prompt_queue) as acquired:
        if not acquired:
            raise BlockingIOError("Prompt queue is active")
        path = _configuration_preset_path(name, profile=profile)

        def identity(target):
            info = target.lstat()
            return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns

        original = identity(path)
        # Validate without nesting the JSON store's interprocess locks. Recheck
        # identity under that same lock before moving the validated document.
        load_configuration_preset(name, profile=profile)
        with locked_path(path):
            if _configuration_preset_path(name, profile=profile) != path or identity(path) != original:
                raise ValueError("Preset changed while preparing deletion")
            tombstone = path.with_name(f".{path.name}.sml-tombstone-{uuid.uuid4().hex}")
            os.replace(path, tombstone)
            try:
                # Rename changes ctime; the remaining identity fields stay fixed.
                if tombstone.is_symlink() or identity(tombstone)[:-1] != original[:-1]:
                    raise ValueError("Preset changed while preparing deletion")
                _fsync_directory(path.parent)
                tombstone.unlink()
            except Exception:
                if (tombstone.exists() or tombstone.is_symlink()) and not (path.exists() or path.is_symlink()):
                    os.replace(tombstone, path)
                    _fsync_directory(path.parent)
                raise
            _fsync_directory(path.parent)
