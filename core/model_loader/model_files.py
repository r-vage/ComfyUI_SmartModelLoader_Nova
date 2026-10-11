"""Explicit same-folder renames of local weights and their integrity sidecars."""

import json
import os
import re
import shutil
import stat
import tempfile
from contextlib import ExitStack
from pathlib import Path, PurePosixPath

import folder_paths

from ..json_store import locked_path, write_json_object
from ..logger import log
from .acquisition import _claim_download_destination, _release_download_destination
from .endpoints import _fsync_directory, _legacy_sidecar_has_sibling_owner
from .integrity import MAX_SIDECAR_BYTES, _sidecar_matches_file, invalidate_cache_entry
from .lifecycle import maintenance_if_idle
from .validation import resolve_clip_file, resolve_model_file

_REFERENCE_TYPES = {"checkpoints": "model", "diffusion_models": "model",
                    "diffusion_models_gguf": "model_gguf", "clip": "clip",
                    "text_encoders": "clip", "vae": "vae", "loras": "lora"}


def _roles(role):
    if role in {"clip", "text_encoders"}:
        return ("clip", "text_encoders")
    if role in {"diffusion_models", "diffusion_models_gguf"}:
        return ("diffusion_models", "diffusion_models_gguf")
    return (role,)


def _resolve(role, name):
    if role not in _REFERENCE_TYPES:
        raise ValueError("Unsupported model role")
    if (not isinstance(name, str) or len(name) > 4096 or "\x00" in name
            or any(part in {"", ".", ".."} for part in name.replace("\\", "/").split("/"))):
        raise ValueError("Invalid model name")
    return (resolve_clip_file(name) if role in {"clip", "text_encoders"} else
            resolve_model_file(role, name, reference_type=_REFERENCE_TYPES[role]))


def _new_name(value, original):
    if (not isinstance(value, str) or not value or len(value.encode("utf-8")) > 220
            or value != value.strip() or value.startswith(".") or value.endswith(".")
            or any(ord(char) < 32 or ord(char) == 127 or char in '/\\:<>"|?*' for char in value)):
        raise ValueError("Enter a filename without folders or special path characters (maximum 220 bytes)")
    if Path(value).suffix != original.suffix or not Path(value).stem.strip():
        raise ValueError("Keep the original file extension")
    if re.fullmatch(r"CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]", value.split(".")[0], re.IGNORECASE):
        raise ValueError("This filename is reserved by the operating system")
    return value


def _candidate_paths(roles, name):
    return {Path(root).expanduser().resolve() / name for role in roles
            if role in folder_paths.folder_names_and_paths for root in folder_paths.get_folder_paths(role)}


def _exists(path):
    return path.exists() or path.is_symlink()


def _identity(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Model files and sidecars must be regular files, without symlinks")
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def _sidecars(path):
    return (Path(f"{path}.sha256"), Path(f"{path}.eclipse.json"), path.with_suffix(".sha256"))


def _sidecar_payload(path, selected, relative):
    if path.stat().st_size > MAX_SIDECAR_BYTES:
        raise ValueError("An integrity sidecar is too large to rename safely")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Sidecars must be regular files")
        raw = stream.read(MAX_SIDECAR_BYTES + 1)
    if len(raw) > MAX_SIDECAR_BYTES:
        raise ValueError("An integrity sidecar is too large to rename safely")
    try:
        text = raw.decode("utf-8")
        if text.lstrip().startswith("{") or path.name.endswith(".json"):
            payload = json.loads(text)
            if not isinstance(payload, dict) or not _sidecar_matches_file(payload, selected):
                raise ValueError("Sidecar identity does not match the selected file")
            if "relative_path" in payload:
                payload["relative_path"] = relative
            return payload
        match = re.fullmatch(r"([0-9a-fA-F]{64})(?:[ \t]+(\*?)([^\r\n]+))?\s*", text.strip())
        if not match:
            raise ValueError("Malformed hash sidecar")
        digest, binary, bound_name = match.groups()
        if bound_name is None:
            return raw
        if bound_name not in {selected.path.name, selected.relative_path}:
            raise ValueError("Hash sidecar filename does not match the selected file")
        renamed = relative if bound_name == selected.relative_path else PurePosixPath(relative).name
        return f"{digest}  {binary}{renamed}\n".encode()
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("An integrity sidecar is malformed; repair it before renaming") from error


def _move_transaction(pairs, payloads, identities):
    """Keep original inodes until every exclusive destination and removal succeeds."""
    parent = pairs[0][0].parent
    backup = Path(tempfile.mkdtemp(prefix=".sml2-rename-", dir=parent))
    originals, installed = [], []
    clean = True
    try:
        for index, (source, destination) in enumerate(pairs):
            identity = identities[source]
            if _identity(source) != identity:
                raise OSError("A file changed during rename")
            retained = backup / f"original-{index}"
            os.link(source, retained, follow_symlinks=False)
            if _identity(retained) != identity or _identity(source) != identity:
                raise OSError("A file changed during rename")
            originals.append((source, retained, identity))
            replacement = retained
            if source in payloads:
                replacement = backup / f"renamed-{index}"
                payload = payloads[source]
                if isinstance(payload, dict):
                    write_json_object(replacement, payload)
                else:
                    with replacement.open("xb") as stream:
                        stream.write(payload)
                        stream.flush()
                        os.fsync(stream.fileno())
                replacement.chmod(stat.S_IMODE(source.stat().st_mode))
            # link() never overwrites an existing file, including a concurrent arrival.
            os.link(replacement, destination, follow_symlinks=False)
            installed.append((destination, _identity(replacement)))
        _fsync_directory(parent)
        for source, _retained, identity in originals:
            if _identity(source) != identity:
                raise OSError("A file changed during rename")
            source.unlink()
        _fsync_directory(parent)
    except Exception:
        for source, retained, identity in reversed(originals):
            try:
                if not _exists(source):
                    os.link(retained, source, follow_symlinks=False)
                if _identity(source) != identity:
                    clean = False
            except (OSError, ValueError):
                clean = False
        for destination, identity in reversed(installed):
            try:
                if _identity(destination) == identity:
                    destination.unlink()
                else:
                    clean = False
            except (OSError, ValueError):
                clean = False
        _fsync_directory(parent)
        if not clean:
            log.error("ModelFiles", f"Rename rollback needs attention; originals retained in {backup}")
        raise
    finally:
        if clean:
            try:
                shutil.rmtree(backup)
                _fsync_directory(parent)
            except OSError:
                log.warning("ModelFiles", f"Rename backup cleanup needs attention: {backup}")


def rename_model_file(role, name, new_name, *, prompt_queue=None):
    """Rename weights plus canonical/legacy SHA and expected-source sidecars; never hash weights."""
    with maintenance_if_idle(prompt_queue) as idle, ExitStack() as locks:
        if not idle:
            raise BlockingIOError("Wait until the prompt queue is idle before renaming a model")
        selected = _resolve(role, name)
        source = selected.path
        new_name = _new_name(new_name, source)
        destination = source.with_name(new_name)
        relative = str(PurePosixPath(selected.relative_path).with_name(new_name))
        roles = _roles(role)
        if new_name == source.name:
            return {"name": selected.relative_path, "oldName": selected.relative_path, "roles": roles}
        # Merged roots must not reveal a different file under either name after renaming.
        if any(_exists(path) and path != source for path in _candidate_paths(roles, selected.relative_path)):
            raise ValueError("The filename occurs in multiple model roots; rename it outside the loader")
        if any(_exists(path) for path in _candidate_paths(roles, relative)):
            raise FileExistsError("That filename already exists in a model folder")
        for path in (source, destination):
            identity = _claim_download_destination(path)
            locks.callback(_release_download_destination, identity)
            if _exists(Path(f"{path}.part")):
                raise ValueError("A partial download uses this filename; finish or remove it before renaming")
        old_sidecars, new_sidecars = _sidecars(source), _sidecars(destination)
        for path in sorted((*old_sidecars, *new_sidecars)):
            if _exists(path):
                _identity(path)
            locks.enter_context(locked_path(path))
        if any(_exists(path) for path in new_sidecars):
            raise FileExistsError("A sidecar already uses the new filename")
        if _exists(old_sidecars[-1]) and (
            _legacy_sidecar_has_sibling_owner(source) or _legacy_sidecar_has_sibling_owner(destination)
        ):
            raise ValueError("A legacy hash sidecar has an ambiguous filename; rename it outside the loader")
        pairs = [(source, destination)]
        payloads = {}
        identities = {source: _identity(source)}
        for old, new in zip(old_sidecars, new_sidecars, strict=True):
            if _exists(old):
                identities[old] = _identity(old)
                payloads[old] = _sidecar_payload(old, selected, relative)
                pairs.append((old, new))
        # Re-resolve after locks, before making any filesystem changes.
        if _resolve(role, name) != selected:
            raise OSError("Model selection changed during rename")
        _move_transaction(pairs, payloads, identities)
        invalidate_cache_entry(source)
        invalidate_cache_entry(destination)
        folder_paths.filename_list_cache.clear()
        return {"name": relative, "oldName": selected.relative_path, "roles": roles}
