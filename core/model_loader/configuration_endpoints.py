# Catalog and explicit preset actions for the independent v2 form.

import asyncio

import folder_paths
from aiohttp import web

from ..download_manager.manager import get_manager
from ..json_store import JsonStoreError
from .acquisition import DownloadDestinationBusy
from .configuration import MAX_CONFIGURATION_BYTES, validate_profile
from .endpoints import global_mutation_denial, read_json_object_request, require_json_boolean
from .integrity import read_saved_metadata
from .model_files import rename_model_file
from .templates import (
    delete_configuration_preset,
    list_configuration_presets,
    read_configuration_preset,
    save_configuration_preset,
)
from .validation import resolve_clip_file, resolve_model_file


def collect_model_metadata(role, name, *, downloads=None):
    reference_types = {"checkpoints": "model", "diffusion_models": "model", "diffusion_models_gguf": "model_gguf",
                       "clip": "clip", "text_encoders": "clip", "vae": "vae", "loras": "lora"}
    if role not in reference_types:
        raise ValueError("Unsupported model role")
    if not isinstance(name, str) or len(name) > 4096:
        raise ValueError("Invalid model name")
    is_clip = role in ("clip", "text_encoders")
    selected = (resolve_clip_file(name) if is_clip else
                resolve_model_file(role, name, reference_type=reference_types[role]))
    result = read_saved_metadata(selected)
    metadata = result["metadata"]
    if downloads is not None and "source" not in metadata:
        saved = downloads.saved_loader_metadata(
            "clip" if is_clip else role, selected.relative_path, metadata.get("sha256"),
        )
        if saved:
            metadata.update(source=saved["source"], sha256=saved["sha256"])
            result["hashOrigin"] = "verified-download"
    return result


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


def rename_local_model(role, name, new_name):
    with get_manager().local_file_maintenance():
        return rename_model_file(role, name, new_name)


def register_configuration_endpoints(routes):
    @routes.post("/smart-model-loader-v2/v2/model/rename")
    async def rename(request):
        denial = global_mutation_denial(request)
        if denial is not None:
            return denial
        payload = await read_json_object_request(request, 16384)
        try:
            if set(payload) != {"role", "name", "newName"}:
                raise ValueError("Expected a model role, current filename and new filename")
            result = await asyncio.to_thread(rename_local_model, payload["role"], payload["name"], payload["newName"])
            return web.json_response(result)
        except (BlockingIOError, DownloadDestinationBusy) as error:
            return web.json_response({"error": str(error)}, status=409)
        except FileExistsError:
            return web.json_response({"error": "The new filename or one of its sidecars already exists."}, status=409)
        except ValueError as error:
            return web.json_response({"error": str(error)}, status=400)
        except (OSError, JsonStoreError, TypeError):
            return web.json_response(
                {"error": "Could not rename the file and its sidecars. Check permissions and server logs."}, status=400,
            )

    @routes.get("/smart-model-loader-v2/v2/catalog")
    async def catalog(request):
        try:
            result = await asyncio.to_thread(collect_catalog, profile=request.query.get("profile", "smart"))
            return web.json_response(result)
        except ValueError:
            return web.json_response({"error": "Unsupported loader profile"}, status=400)

    @routes.get("/smart-model-loader-v2/v2/model-metadata")
    async def model_metadata(request):
        try:
            result = await asyncio.to_thread(
                collect_model_metadata, request.query.get("role"), request.query.get("name"),
                downloads=get_manager(),
            )
            return web.json_response(result)
        except (OSError, TypeError, ValueError):
            return web.json_response({"error": "Could not read saved metadata for the selected model"}, status=400)

    @routes.get("/smart-model-loader-v2/v2/preset")
    async def load(request):
        try:
            result = await asyncio.to_thread(read_configuration_preset, request.query.get("name", ""),
                                             profile=request.query.get("profile", "smart"))
            return web.json_response({"name": request.query.get("name"), **result})
        except (OSError, JsonStoreError, TypeError, ValueError):
            return web.json_response({"error": "Could not read a valid v2 preset"}, status=400)

    @routes.post("/smart-model-loader-v2/v2/preset")
    async def save(request):
        denial = global_mutation_denial(request)
        if denial is not None:
            return denial
        payload = await read_json_object_request(request, MAX_CONFIGURATION_BYTES)
        try:
            profile = validate_profile(payload.get("profile", "smart"), preset=True)
            await asyncio.to_thread(save_configuration_preset, payload.get("name"), payload.get("configuration"),
                                    overwrite=require_json_boolean(payload, "overwrite"), profile=profile)
            return web.json_response({"name": payload.get("name"),
                                      "presets": await asyncio.to_thread(list_configuration_presets, profile=profile)})
        except (OSError, JsonStoreError, TypeError, ValueError):
            return web.json_response(
                {"error": "Preset was not saved. Check its name, configuration and overwrite choice."}, status=400,
            )

    @routes.post("/smart-model-loader-v2/v2/preset/delete")
    async def delete(request):
        denial = global_mutation_denial(request)
        if denial is not None:
            return denial
        payload = await read_json_object_request(request, 4096)
        try:
            if "name" not in payload or set(payload) - {"name", "profile"}:
                raise ValueError("Expected a preset name")
            profile = validate_profile(payload.get("profile", "smart"), preset=True)
            await asyncio.to_thread(delete_configuration_preset, payload["name"], profile=profile)
            return web.json_response({"presets": await asyncio.to_thread(list_configuration_presets, profile=profile)})
        except BlockingIOError:
            return web.json_response(
                {"error": "Wait until the prompt queue is idle before deleting a preset."}, status=409,
            )
        except FileNotFoundError:
            return web.json_response({"error": "Preset no longer exists. Refresh the list."}, status=404)
        except (OSError, JsonStoreError, TypeError, ValueError):
            return web.json_response(
                {"error": "Preset was not deleted. Check its name and saved contents."}, status=400,
            )
