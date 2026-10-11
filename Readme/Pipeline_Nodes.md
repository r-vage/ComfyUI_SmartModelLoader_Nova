# Pipeline Nodes

Smart Model Loader includes the complete loader → conditioning → sampling path.
Smart Model Loader, CLIP Loader, LoRA Stack/Apply and KSampler Pipe use `[SML2]`.
The node IDs shown below match the current registrations.

## Text conditioning

`CLIP Text Encode [SML2]` accepts a CLIP model and a connected text string,
then returns scheduled ComfyUI conditioning. A missing or invalid CLIP raises the
same explicit checkpoint/encoder error used by existing workflows.

`CLIP Text Encode (Advanced) [SML2]` adds a global multiplier plus Krea2
multi-layer rebalancing. Choose `balanced`, `detail`, `subtle`, `uniform`, or
`custom`; the custom preset accepts comma- or semicolon-separated weights.
`renormalize` preserves the original RMS after layer weighting, while
`krea2_only_multiplier` leaves non-Krea2 conditioning unscaled. Non-Krea2 models
skip layer rebalancing and retain the documented multiplier behavior.

`Conditioning Zero Out [SML2]` clears conditioning tensors and pooled output.
Set `max_tokens` for explicit truncation, or connect a model and leave it at zero
to select the known architecture's base token length automatically. Unknown or
absent models keep the original token length. Tensor dtype/device and input
metadata are preserved without mutating the input conditioning.

## Pipe extraction and sampling

`IO Checkpoint Loader [SML2]` merges optional direct values over an input
`PIPE`, returns a new pipe, and exposes every checkpoint, latent, sampler,
dimension, name, and seed field in stable socket order. Missing values remain
`None`. When dimensions are absent, a latent supplies width and height using its
spatial downscale ratio (8 by default).

`sigmas` is the final optional input and output, after `denoise`. It accepts
`SIGMAS` from any compatible scheduler, stores them in the returned pipe and
exposes them for `SamplerCustomAdvanced` or other custom samplers. A connected
`sigmas` input overrides the pipe's schedule. Earlier sockets keep their indices.

`Qwen Image 2.1 Scheduler [SML2]` creates a resolution-dependent
schedule with configurable shift anchors, exponential or linear shifting, and
terminal stretching. It returns `PIPE` and `SIGMAS`; the optional pipe supplies
the target latent or pixel dimensions, and a directly connected target latent
takes precedence. Set sampling steps and denoise on the scheduler itself. See
[Qwen Image 2.1 Scheduler](Smart_Loaders.md#qwen-image-21-scheduler) for defaults
and wiring.

`KSampler Pipe [SML2]` reads MODEL/VAE from the PIPE, accepts conditioning and
optional image/latent overrides, and returns PIPE, LATENT and IMAGE. Its compact
settings stay visible. **Use pipe settings**, **Tiled decode**, **Alpha**, and **Preview**
are independent feature buttons. Alpha defaults off to remove decoded transparency;
enable it to retain RGBA output. Seed actions support exact 64-bit values and
accepted-queue advancement. See the [sampler guide](KSampler_Pipe.md).
To use explicit `SIGMAS`, extract them with IO Checkpoint Loader and connect
a custom sampler.

## LoRA Stack and Nunchaku PuLID

`LoRA Stack [SML2]` builds setups with up to 60 compact rows and presets.
`LoRA Stack Apply [SML2]` consumes its `SML2_LORA_STACK` output and applies
Model/CLIP or LTX video/audio strengths with the existing Nunchaku adapters.
See the [LoRA guide and visual tour](LoRA_Stack.md).

`Nunchaku PuLID Loader [SML2]` and `Nunchaku PuLID Apply [SML2]` load and
apply Flux PuLID identity guidance. They intentionally use the same vendored
`ComfyFluxWrapper` class as Smart Model Loader, preventing the same-named but
different-class mismatch that occurs when loader and PuLID code come from
separate packs. These two nodes require a compatible Nunchaku installation and
its PuLID dependencies.

The loader's **CPU** InsightFace provider is also the compatibility fallback for
an environment that reports `CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH`: ONNX face
analysis runs on CPU, and cuDNN is bypassed only while PuLID extracts the face
embedding. The previous PyTorch backend state is restored immediately afterward.
The **CUDA** provider requires PyTorch, ONNX Runtime, and cuDNN to resolve one
compatible CUDA library stack. See
[Nunchaku PuLID CUDA troubleshooting](Nunchaku_PuLID_CUDA_Troubleshooting.md) for
environment inspection, choosing a compatible ONNX Runtime build, and checking
the repaired environment with a PuLID workflow.

## Optional Eclipse integrations

ComfyUI Eclipse is not required. If installed, its Context Image, Generation
Data, generic channel pipes, Concat Pipe Multi, Smart Sampler Settings, Save
Images, Kargim, and Conditioning Passer nodes can consume or enrich the same
unchanged `PIPE` contract.
