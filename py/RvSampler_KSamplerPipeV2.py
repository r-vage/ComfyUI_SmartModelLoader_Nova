"""KSampler Pipe with the shared SML2 configuration editor."""

import json

from comfy_api.latest import io

from ..core import CATEGORY
from ..core.model_loader.configuration import WIDGET_TYPE
from ..core.model_loader.pipe_sampler import default_configuration, editor_spec, sample_pipe, validate_configuration


class RvSampler_KSamplerPipeV2(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="KSampler Pipe [SML2]", display_name="KSampler Pipe",
            category=CATEGORY.MAIN.value + CATEGORY.SAMPLER.value, is_output_node=True,
            description="Sample and decode using the MODEL and VAE from a pipe. Use pipe settings gives supplied pipe values priority over the visible local sampler/seed controls. Tiled decode, Alpha and Preview are independent switches. Alpha is off by default; enable it to keep decoded transparency.",
            inputs=[
                io.Custom("PIPE").Input("pipe", tooltip="Pipe containing MODEL, VAE, and optional latent/image and sampler settings."),
                io.Conditioning.Input("positive"), io.Conditioning.Input("negative"),
                io.String.Input("configuration", socketless=True,
                                default=json.dumps(default_configuration(), sort_keys=True, separators=(",", ":")),
                                extra_dict={"widgetType": WIDGET_TYPE, "editorSpec": editor_spec(),
                                            "editorLabel": "KSampler Pipe configuration"}),
                io.Latent.Input("latent", optional=True, tooltip="Overrides latent and image from the pipe."),
                io.Image.Input("image", optional=True, tooltip="Encode this image before sampling. Takes priority over connected or pipe latents."),
            ],
            outputs=[io.Custom("PIPE").Output("pipe"), io.Latent.Output("latent"), io.Image.Output("image")],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo, io.Hidden.unique_id],
        )

    @classmethod
    def validate_inputs(cls, configuration: str):
        try:
            validate_configuration(configuration)
        except (TypeError, ValueError) as error:
            return str(error)
        return True

    @classmethod
    def fingerprint_inputs(cls, configuration: str, **_inputs):
        # ComfyUI also passes linked inputs (as None before their execution).
        config = validate_configuration(configuration)
        # The frontend queues concrete seeds. Direct API random requests, or a
        # partial pipe using a random local seed, must not reuse cached samples.
        return float("nan") if config["seed"]["policy"] == "random" else configuration

    @classmethod
    def execute(cls, pipe, positive, negative, configuration: str, *, latent=None, image=None):  # noqa: PLR0913
        output, latent_out, images, ui = sample_pipe(
            pipe, configuration, positive, negative, latent=latent, image=image,
            prompt=cls.hidden.prompt, extra_pnginfo=cls.hidden.extra_pnginfo, unique_id=cls.hidden.unique_id,
        )
        return io.NodeOutput(output, latent_out, images, ui=ui)
