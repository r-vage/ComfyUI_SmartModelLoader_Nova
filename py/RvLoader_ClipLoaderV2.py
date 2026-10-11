"""Standalone CLIP Loader using the shared SML2 resource editor."""

import json

from comfy_api.latest import io

from ..core import CATEGORY
from ..core.model_loader.clip_configuration import ClipConfigurationRequest
from ..core.model_loader.configuration import WIDGET_TYPE, default_configuration, editor_spec
from ..core.model_loader.structured import execute_clip_configuration


class RvLoader_ClipLoaderV2(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CLIP Loader [SML2]", display_name="CLIP Loader",
            category=CATEGORY.MAIN.value + CATEGORY.LOADER.value,
            description="Load an ordered list of text encoders, including GGUF. Add rows as needed; supported combinations depend on ComfyUI. Missing selections remain visible and must be resolved before loading.",
            inputs=[io.String.Input(
                "configuration", socketless=True,
                default=json.dumps(default_configuration(profile="clip"), sort_keys=True, separators=(",", ":")),
                extra_dict={"widgetType": WIDGET_TYPE, "editorSpec": editor_spec(profile="clip"),
                            "editorLabel": "CLIP Loader configuration"},
            )],
            outputs=[io.Clip.Output("clip"), io.String.Output("clip_names")],
        )

    @classmethod
    def validate_inputs(cls, configuration: str):
        try:
            ClipConfigurationRequest.parse(configuration)
        except (OSError, TypeError, ValueError) as error:
            return str(error)
        return True

    @classmethod
    def fingerprint_inputs(cls, configuration: str):
        try:
            request = ClipConfigurationRequest.parse(configuration)
            return tuple((key, file.path.stat().st_mtime_ns, file.path.stat().st_size)
                         for key, file in request.files.items())
        except (OSError, TypeError, ValueError):
            return float("nan")

    @classmethod
    def execute(cls, configuration: str):
        return io.NodeOutput(*execute_clip_configuration(configuration))
