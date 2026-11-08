# Copy-only legacy migration and hash-tracked bundled template updates.

from __future__ import annotations

import os
import re
import shutil
import tempfile
from hashlib import sha256
from pathlib import Path
from typing import Any

from .config_store import CONFIG_PATH, ensure_config_exists, update_config_values
from .json_store import JsonStoreError, locked_path, read_json_object, update_json_object, write_json_object
from .logger import log
from .theme_defaults import extract_theme_defaults

_LOG_PREFIX = "Migration"
_MIGRATION_MARKER = ".eclipse_loader_data_migrated"
_MIGRATION_MARKER_VERSION = 2
# Defaults delivered through 1.0.10, before startup recorded per-file hashes.
# Seed their history on upgrades so missing manifests cannot revive deletions.
_PRE_MANIFEST_TEMPLATES = frozenset({
    "Anima_Animij_S1.json",
    "Anima_Animij_ai.json",
    "Flux2_Klein-9B_Fluxtrait_v2.json",
    "Flux2_Klein-9B_Fluxtrait_v3.json",
    "Flux2_Klein-9B_KV.json",
    "Flux_Dev.json",
    "Flux_Dev_Nunchaku.json",
    "Flux_Fluxmania_Legacy_Nunchaku.json",
    "Flux_Kontext.json",
    "Flux_Kontext_Nunchaku.json",
    "Flux_Kreamania.json",
    "Illustrious_Animij_v8.json",
    "Illustrious_UnholyDesireMix_v8.json",
    "Krea2_Kreamania_v7d.json",
    "Krea2_Kreamania_v8b.json",
    "Krea2_Luc_Anime_v1.json",
    "Krea2_MoodyMix_v8.json",
    "Krea2_Turbo_BF16.json",
    "NoobAI_OneObsession.json",
    "Qwen Image 2.1_Final Cut_Int8.json",
    "Qwen Image 2.1_Redqw21-Unlocked_v2.json",
    "ZIT_BF16.json",
})
_CONFIG_KEYS = (
    "civitai_api_key",
    "hf_token",
    "allow_legacy_model_formats",
    "log_level",
)
_ECLIPSE_CONFIG_KEYS = frozenset(_CONFIG_KEYS)
_DEFAULT_CONFIG_VALUES = {
    "civitai_api_key": "",
    "hf_token": "",
    "allow_legacy_model_formats": False,
    "log_level": "warning",
}


def _copy_file_if_missing(source: Path, destination: Path) -> bool:
    if not source.is_file() or source.is_symlink() or destination.exists():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.migration-{os.getpid()}")
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
        return True
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _copy_templates(source: Path, destination: Path) -> int:
    if not source.is_dir() or source.is_symlink():
        return 0
    copied = 0
    destination.mkdir(parents=True, exist_ok=True)
    for source_file in source.glob("*.json"):
        if _copy_file_if_missing(source_file, destination / source_file.name):
            copied += 1
    return copied


def _template_matches_hash(path: Path, digest: str) -> bool:
    try:
        return not path.is_symlink() and path.is_file() and sha256(path.read_bytes()).hexdigest() == digest
    except FileNotFoundError:
        return False


def _write_bundled_template(data: bytes, destination: Path, root: Path, previous_hash: str | None) -> bool:
    parent = root
    for part in destination.relative_to(root).parent.parts:
        parent /= part
        if parent.is_symlink():
            raise OSError(f"Template directory is a symlink: {parent}")
        parent.mkdir(exist_ok=True)
    with locked_path(destination):
        if previous_hash is None:
            if destination.exists() or destination.is_symlink():
                return False
        elif not _template_matches_hash(destination, previous_hash):
            return False
        with tempfile.TemporaryDirectory(dir=destination.parent, prefix=f".{destination.name}.") as staging:
            temporary = Path(staging) / "template.json"
            with temporary.open("xb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            if previous_hash is not None:
                # Recheck after staging so a concurrent edit/deletion wins.
                if not _template_matches_hash(destination, previous_hash):
                    return False
                os.replace(temporary, destination)
            else:
                # Publish a complete new file without replacing one created meanwhile.
                try:
                    os.link(temporary, destination)
                except FileExistsError:
                    return False
    return True


def _bundled_template_examples(source: Path) -> list[tuple[Path, Path]]:
    examples = []
    for directory in (source, source / "lora-stack"):
        if directory.is_symlink() or not directory.is_dir():
            continue
        for example in sorted(directory.glob("*.json.example")):
            if example.is_symlink() or not example.is_file():
                continue
            relative = example.relative_to(source).with_suffix("")
            examples.append((example, relative))
    return examples


def _extract_bundled_templates(root: Path, *, migrated: bool = False) -> int | None:
    source = root / ".defaults" / "templates"
    if source.parent.is_symlink() or source.is_symlink() or not source.is_dir():
        return 0
    examples = _bundled_template_examples(source)
    if not examples:
        return 0
    manifest_path = source.parent / ".manifest.json"
    if manifest_path.is_symlink():
        log.warning(_LOG_PREFIX, "Template manifest is a symlink; preserving user files")
        return None
    copied = 0
    failed = False

    def install(manifest: dict[str, Any]) -> None:
        nonlocal copied, failed
        if any(not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None
               for value in manifest.values()):
            raise JsonStoreError("Invalid template manifest; preserving user files")
        for example, relative in examples:
            key = (Path("templates") / relative).as_posix()
            try:
                data = example.read_bytes()
                digest = sha256(data).hexdigest()
                previous_hash = manifest.get(key)
                # A completed old migration already delivered these names.
                # Adopt their current hash without recreating deleted files.
                legacy = migrated and relative.as_posix() in _PRE_MANIFEST_TEMPLATES
                if previous_hash != digest and (previous_hash is not None or not legacy):
                    copied += _write_bundled_template(data, root / key, root, previous_hash)
                manifest[key] = digest
            except OSError as error:
                failed = True
                log.warning(_LOG_PREFIX, f"Could not extract '{key}': {error}")

    try:
        update_json_object(manifest_path, install, default={}, private=True)
    except (JsonStoreError, OSError, UnicodeError) as error:
        log.warning(_LOG_PREFIX, f"Could not record template extraction: {error}")
        return None
    return None if failed else copied


def _migrate_config(source: Path) -> tuple[list[str], list[str]]:
    if not source.is_file() or source.is_symlink():
        return [], []
    try:
        legacy = read_json_object(source)
        current = read_json_object(CONFIG_PATH)
    except (JsonStoreError, OSError):
        return [], []
    examined = sorted(_ECLIPSE_CONFIG_KEYS)
    updates: dict[str, Any] = {}
    for key in _CONFIG_KEYS:
        value = legacy.get(key)
        current_value = current.get(key, _DEFAULT_CONFIG_VALUES[key])
        if value in (None, "") or current_value != _DEFAULT_CONFIG_VALUES[key]:
            continue
        if key == "allow_legacy_model_formats" and value is not True:
            continue
        updates[key] = value
    if updates and update_config_values(updates):
        return sorted(updates), examined
    return [], examined


def _read_marker(marker: Path) -> dict[str, Any]:
    if not marker.is_file() or marker.is_symlink():
        return {}
    try:
        return read_json_object(marker)
    except (JsonStoreError, OSError):
        return {}


def _marker_is_current(data: dict[str, Any], examined: set[str]) -> bool:
    version = data.get("version")
    return (
        isinstance(version, int)
        and not isinstance(version, bool)
        and version >= _MIGRATION_MARKER_VERSION
        and data.get("completed") is True
        and examined >= _ECLIPSE_CONFIG_KEYS
    )


def run_migrations(repo_root: str | os.PathLike[str] | None = None) -> None:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parent.parent
    extract_theme_defaults(root)
    ensure_config_exists()
    marker = root / _MIGRATION_MARKER
    marker_data = _read_marker(marker)
    keys = marker_data.get("examined_eclipse_config_keys")
    examined_keys = set(keys) if isinstance(keys, list) and all(isinstance(key, str) for key in keys) else set()
    if _marker_is_current(marker_data, examined_keys):
        _extract_bundled_templates(root, migrated=True)
        return
    # Template extraction is complete even when there was no Eclipse config to
    # inspect, or a later config migration needs to examine additional keys.
    templates_migrated = marker_data.get("completed") is True
    custom_nodes = root.parent
    eclipse_candidates = (
        custom_nodes / "comfyui_eclipse",
        custom_nodes / "ComfyUI_Eclipse",
    )
    eclipse_root = next((path for path in eclipse_candidates if path.is_dir()), None)
    copied_templates = 0
    migrated_keys: list[str] = []
    queue_copied = False
    if eclipse_root is not None:
        if not templates_migrated:
            copied_templates += _copy_templates(eclipse_root / "templates", root / "templates")
        migrated_keys, newly_examined = _migrate_config(eclipse_root / "config.json")
        examined_keys.update(newly_examined)
        queue_copied = _copy_file_if_missing(
            eclipse_root / "download_manager" / "queue.json",
            root / "download_manager" / "queue.json",
        )
    if not templates_migrated:
        comfyui_root = custom_nodes.parent
        copied_templates += _copy_templates(
            comfyui_root / "models" / "smart_loader_templates",
            root / "templates",
        )
    # User templates win on first migration; later bundled changes use each
    # installation's local manifest, independently of legacy-copy completion.
    bundled_count = _extract_bundled_templates(root, migrated=templates_migrated)
    if bundled_count is None:
        return
    copied_templates += bundled_count
    write_json_object(
        marker,
        {
            "version": _MIGRATION_MARKER_VERSION,
            "completed": True,
            "examined_eclipse_config_keys": sorted(examined_keys),
        },
        private=True,
    )
    if copied_templates or migrated_keys or queue_copied:
        log.msg(
            _LOG_PREFIX,
            f"Copied {copied_templates} template(s), {len(migrated_keys)} config value(s), "
            f"and {'one queue snapshot' if queue_copied else 'no queue snapshot'}",
        )
