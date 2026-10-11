"""Structured LoRA Stack and application nodes for the SML2 editor."""

import json

from comfy_api.latest import io

from ..core import CATEGORY
from ..core.model_loader.configuration import WIDGET_TYPE, default_configuration, editor_spec
from ..core.model_loader.lora_configuration import STACK_TYPE, LoraConfigurationRequest, build_lora_stack
from ..core.model_loader.lora_stack import apply_lora_stack


class RvTools_LoraStackV2(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="LoRA Stack [SML2]", display_name="LoRA Stack",
            category=CATEGORY.MAIN.value + CATEGORY.TOOLS.value,
            description="Build up to 60 compact LoRA rows. Choose one shared mode: Model, CLIP split, or Audio (LTX). Connect to LoRA Stack Apply. Presets save this node's mode and rows.",
            inputs=[io.String.Input(
                "configuration", socketless=True,
                default=json.dumps(default_configuration(profile="lora"), sort_keys=True, separators=(",", ":")),
                extra_dict={"widgetType": WIDGET_TYPE, "editorSpec": editor_spec(profile="lora"),
                            "editorLabel": "LoRA Stack configuration"},
            )],
            outputs=[io.Custom(STACK_TYPE).Output("lora_stack")],
        )

    @classmethod
    def validate_inputs(cls, configuration: str):
        try:
            LoraConfigurationRequest.parse(configuration)
        except (OSError, TypeError, ValueError) as error:
            return str(error)
        return True

    @classmethod
    def fingerprint_inputs(cls, configuration: str):
        try:
            request = LoraConfigurationRequest.parse(configuration)
            return tuple((key, file.path.stat().st_mtime_ns, file.path.stat().st_size)
                         for key, file in request.files.items())
        except (OSError, TypeError, ValueError):
            return float("nan")

    @classmethod
    def execute(cls, configuration: str):
        return io.NodeOutput(build_lora_stack(configuration))


class RvTools_LoraStackApplyV2(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="LoRA Stack Apply [SML2]", display_name="LoRA Stack Apply",
            category=CATEGORY.MAIN.value + CATEGORY.TOOLS.value,
            description="Apply a LoRA Stack using the existing Nunchaku adapters or ComfyUI's native patcher. Model mode uses MODEL; CLIP split also uses CLIP. Audio mode splits the LTX MODEL's video/audio weights and passes CLIP through unchanged. Set a strength to zero to skip that target.",
            inputs=[io.Custom(STACK_TYPE).Input("lora_stack"), io.Model.Input("model", optional=True),
                    io.Clip.Input("clip", optional=True)],
            outputs=[io.Model.Output("model"), io.Clip.Output("clip"), io.String.Output("lora_names")],
        )

    @classmethod
    def execute(cls, lora_stack, model=None, clip=None):
        return io.NodeOutput(*apply_lora_stack(model, clip, lora_stack))
