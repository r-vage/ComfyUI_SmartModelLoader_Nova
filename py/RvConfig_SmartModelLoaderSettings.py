"""Promotable native controls for the Smart Model Loader panel."""

from comfy_api.latest import io

from ..core import CATEGORY
from ..core.json_store import JsonStoreError
from ..core.model_loader.catalog import collect_catalog
from ..core.model_loader.configuration import MAX_SEED, editor_spec
from ..core.model_loader.native_controls import (
    INHERIT,
    INHERIT_TOOLTIP,
    SETTINGS_NODE_ID,
    SETTINGS_TYPE,
    native_fields,
    native_options,
)
from ..core.model_loader.native_settings import native_fingerprint, settings_payload, validate_parameters
from ..core.model_loader.templates import load_configuration_preset


class RvConfig_SmartModelLoaderSettings(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        spec, catalog = editor_spec(), collect_catalog()
        inputs = []
        for key, field in native_fields(spec).items():
            tip = field.get("tip", f"{field['label']} override. {field.get('inherit', INHERIT)} inherits this setting. "
                            "Inactive controls retain their values.")
            if key not in {"template", "seed"}:
                tip += " " + INHERIT_TOOLTIP
            options = {"default": field["default"], "tooltip": tip}
            if key == "template":
                options["extra_dict"] = {"nativeSettingsSpec": spec}
            if field["type"] == "seed":
                inputs.append(io.Int.Input(key, optional=True, force_input=True, min=0, max=MAX_SEED, **options))
            elif field["type"] == "number":
                constructor = io.Int if field["step"] == 1 else io.Float
                inputs.append(constructor.Input(key, min=min(field["min"], field["inherit"]),
                                                max=field["max"], step=field["step"], **options))
            else:
                inputs.append(io.Combo.Input(key, options=native_options(field, catalog), **options))
        return io.Schema(
            node_id=SETTINGS_NODE_ID, display_name="Smart Model Loader Settings",
            category=CATEGORY.MAIN.value + "/ Settings",
            description="Native template and main-setting overrides for subgraphs. Connect settings to Smart Model Loader's pipe_opt and promote the controls you need. Inherit keeps template/panel values; templates are read without being modified.",
            inputs=inputs, outputs=[io.Custom(SETTINGS_TYPE).Output("settings")],
        )

    @classmethod
    def validate_inputs(cls, **values):
        try:
            known = validate_parameters({key: value for key, value in values.items() if value is not None})
            if "template" in known:
                load_configuration_preset(known["template"])
        except (OSError, JsonStoreError, TypeError, ValueError) as error:
            return str(error)
        return True

    @classmethod
    def fingerprint_inputs(cls, **values):
        try:
            return native_fingerprint(values)
        except (OSError, JsonStoreError, TypeError, ValueError):
            return float("nan")

    @classmethod
    def execute(cls, **values):
        return io.NodeOutput(settings_payload(values))
