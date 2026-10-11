# Smart Model Loader v2 uses one schema-backed DOM configuration widget.

import json

from comfy_api.latest import io

from ..core import CATEGORY
from ..core.model_loader.configuration import WIDGET_TYPE, ConfigurationRequest, default_configuration, editor_spec
from ..core.model_loader.structured import execute_configuration


class RvLoader_SmartModelLoaderV2(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Smart Model Loader [SML2]",
            display_name="Smart Model Loader",
            category=CATEGORY.MAIN.value + CATEGORY.LOADER.value,
            description="A compact model loader with dynamic sections, local resources and a PIPE output.",
            inputs=[io.String.Input(
                "configuration", socketless=True,
                default=json.dumps(default_configuration(), sort_keys=True, separators=(",", ":")),
                extra_dict={"widgetType": WIDGET_TYPE, "editorSpec": editor_spec()},
            )],
            outputs=[io.Custom("PIPE").Output("pipe")],
        )

    @classmethod
    def validate_inputs(cls, configuration: str):
        try:
            ConfigurationRequest.parse(configuration)
        except (OSError, TypeError, ValueError) as error:
            return str(error)
        return True

    @classmethod
    def fingerprint_inputs(cls, configuration: str):
        try:
            request = ConfigurationRequest.parse(configuration)
            return tuple((key, selected.path.stat().st_mtime_ns, selected.path.stat().st_size)
                         for key, selected in request.files.items())
        except (OSError, TypeError, ValueError):
            return float("nan")

    @classmethod
    def execute(cls, configuration: str):
        return io.NodeOutput(execute_configuration(configuration))
