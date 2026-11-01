# Smart Model Loader v2 uses one schema-backed DOM configuration widget.

import json

from comfy_api.latest import io

from ..core import CATEGORY
from ..core.json_store import JsonStoreError
from ..core.model_loader.configuration import (
    WIDGET_TYPE,
    ConfigurationRequest,
    default_configuration,
    editor_spec,
    validate_configuration,
)
from ..core.model_loader.native_controls import SETTINGS_TYPE
from ..core.model_loader.native_settings import UNCONNECTED, merge_settings, resource_fingerprint
from ..core.model_loader.structured import execute_configuration


class RvLoader_SmartModelLoaderV2(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Smart Model Loader [SML2]",
            display_name="Smart Model Loader",
            category=CATEGORY.MAIN.value + CATEGORY.LOADER.value,
            description="A compact model loader with dynamic sections, local resources and a PIPE output.",
            inputs=[io.Custom(SETTINGS_TYPE).Input(
                "pipe_opt", optional=True,
                tooltip="Optional native settings. Apply a selected template, then explicit overrides; omitted settings use this panel.",
            ), io.String.Input(
                "configuration", socketless=True,
                default=json.dumps(default_configuration(), sort_keys=True, separators=(",", ":")),
                extra_dict={"widgetType": WIDGET_TYPE, "editorSpec": editor_spec()},
            )],
            outputs=[io.Custom("PIPE").Output("pipe")],
        )

    @classmethod
    def validate_inputs(cls, configuration: str, pipe_opt=UNCONNECTED):
        try:
            if pipe_opt is UNCONNECTED:
                ConfigurationRequest.parse(configuration)
            elif pipe_opt is None:
                # Connected settings are unresolved during ComfyUI validation.
                # Validate structure now, then resolve effective files before load.
                validate_configuration(configuration)
            else:
                ConfigurationRequest.parse(merge_settings(configuration, pipe_opt))
        except (OSError, JsonStoreError, TypeError, ValueError) as error:
            return str(error)
        return True

    @classmethod
    def fingerprint_inputs(cls, configuration: str, pipe_opt=UNCONNECTED):
        try:
            if pipe_opt is not UNCONNECTED:
                config = (validate_configuration(configuration) if pipe_opt is None else
                          merge_settings(configuration, pipe_opt))
                return resource_fingerprint(config)
            request = ConfigurationRequest.parse(configuration)
            return tuple((key, selected.path.stat().st_mtime_ns, selected.path.stat().st_size)
                         for key, selected in request.files.items())
        except (OSError, JsonStoreError, TypeError, ValueError):
            return float("nan")

    @classmethod
    def execute(cls, configuration: str, pipe_opt=None):
        effective = merge_settings(configuration, pipe_opt) if pipe_opt is not None else configuration
        return io.NodeOutput(execute_configuration(effective))
