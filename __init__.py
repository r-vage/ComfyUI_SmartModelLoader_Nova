# ComfyUI Smart Model Loader extension entry point.
# ruff: noqa: N999

WEB_DIRECTORY = "./js"

import os

from .core import version
from .core.logger import log
from .core.migration import run_migrations

log.msg("", f"Version: {version}")
run_migrations()

try:
    from .core.server_endpoints import initialize_endpoints

    initialize_endpoints()
    from server import PromptServer

    from .core.model_loader.configuration_endpoints import register_configuration_endpoints

    register_configuration_endpoints(PromptServer.instance.routes)
except (AttributeError, ImportError, OSError, RuntimeError, ValueError) as error:
    log.warning("Endpoints", f"Failed to initialize loader endpoints: {error}")

try:
    from .core.download_manager import (
        initialize_endpoints as initialize_download_manager,
    )

    initialize_download_manager()
except (AttributeError, ImportError, OSError, RuntimeError, ValueError) as error:
    log.warning("Download Manager", f"Failed to initialize endpoints: {error}")

# Retain the high-performance Hugging Face transfer policy used by Eclipse.
os.environ["HF_XET_HIGH_PERFORMANCE"] = "1"

from comfy_api.latest import ComfyExtension, io  # type: ignore


class SmartModelLoaderExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        from .py.RvCond_CLIPTextEncode import RvCond_CLIPTextEncode
        from .py.RvCond_CLIPTextEncodeAdvanced import RvCond_CLIPTextEncodeAdvanced
        from .py.RvCond_ConditioningZeroOut import RvCond_ConditioningZeroOut
        from .py.RvCond_TextEncodeMiniMaxMusic3 import RvCond_TextEncodeMiniMaxMusic3
        from .py.RvCond_TextEncodeQwenImage21 import RvCond_TextEncodeQwenImage21
        from .py.RvLoader_ClipLoaderV2 import RvLoader_ClipLoaderV2
        from .py.RvLoader_SmartModelLoaderV2 import RvLoader_SmartModelLoaderV2
        from .py.RvLoader_VaeLoader import RvLoader_VaeLoader
        from .py.RvLoader_VaeLoaderVideoAudio import RvLoader_VaeLoaderVideoAudio
        from .py.RvPipe_IO_CheckpointLoader import RvPipe_IO_CheckpointLoader
        from .py.RvSampler_KSamplerPipeV2 import RvSampler_KSamplerPipeV2
        from .py.RvSampler_QwenImage21Scheduler import RvSampler_QwenImage21Scheduler
        from .py.RvTools_LoraStackV2 import RvTools_LoraStackApplyV2, RvTools_LoraStackV2

        try:
            from .py.RvTools_NunchakuPuLID import (
                RvTools_NunchakuPuLIDApply,
                RvTools_NunchakuPuLIDLoader,
            )

            nunchaku_pulid_available = True
        except (ImportError, ModuleNotFoundError, RuntimeError) as error:
            log.warning("NunchakuPuLID", f"Nunchaku PuLID nodes unavailable: {error}")
            nunchaku_pulid_available = False

        node_list: list[type[io.ComfyNode]] = [
            RvLoader_SmartModelLoaderV2,
            RvLoader_ClipLoaderV2,
            RvLoader_VaeLoader,
            RvLoader_VaeLoaderVideoAudio,
            RvCond_CLIPTextEncode,
            RvCond_CLIPTextEncodeAdvanced,
            RvCond_ConditioningZeroOut,
            RvCond_TextEncodeQwenImage21,
            RvCond_TextEncodeMiniMaxMusic3,
            RvPipe_IO_CheckpointLoader,
            RvSampler_KSamplerPipeV2,
            RvTools_LoraStackV2,
            RvTools_LoraStackApplyV2,
            RvSampler_QwenImage21Scheduler,
        ]

        if nunchaku_pulid_available:
            node_list.extend([RvTools_NunchakuPuLIDLoader, RvTools_NunchakuPuLIDApply])

        return node_list


async def comfy_entrypoint() -> SmartModelLoaderExtension:
    return SmartModelLoaderExtension()
