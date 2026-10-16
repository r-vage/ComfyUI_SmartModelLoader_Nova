# Component loaders

Use [Smart Model Loader](Smart_Loaders.md) for diffusion-model loading. Disable
its unneeded Include options for a model-only configuration and use IO Checkpoint
Loader to expose direct outputs.

## CLIP Loader

`CLIP Loader [SML2]` loads an ordered list of external encoders and returns CLIP
and a comma-separated list of their filenames. It has dynamic rows without a
fixed count cap, architecture selection, local integrity and Download Manager
buttons. See the [CLIP Loader guide](CLIP_Loader.md).

## VAE Loader

**Node:** `VAE Loader [SML2]` — Category: `Smart Model Loader Nova > Loader`

Loads an external VAE through ComfyUI's architecture detection. The shared loader
also supports Qwen Image 2.1 VAEs in native and recognized Diffusers formats; see
[Qwen Image 2.1](Smart_Loaders.md#qwen-image-21) for the required model pairing.
Use this node for a separate VAE or to replace a baked VAE with a compatible one.

### Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `vae_name` | — | File from ComfyUI's registered VAE folders, normally `models/vae/` |
| `disable_offload` | `true` | Request a full VAE load on its execution device; turn off to allow ComfyUI's offload handling |

### Outputs

| Output | Type | Description |
|--------|------|-------------|
| `vae` | VAE | Loaded VAE model |
| `vae_name` | STRING | VAE filename |

ComfyUI chooses the execution device. `disable_offload` does not select a GPU or
guarantee that the VAE remains resident between workflow executions.

---

## VAE Loader Video+Audio

**Node:** `VAE Loader Video+Audio [SML2]` — Category: `Smart Model Loader Nova > Loader`

Loads a video/image VAE and a ComfyUI-supported audio VAE on separate sockets,
using the same registered VAE folders as the single loader. ComfyUI performs
architecture detection, including MiniMax H3 and standalone LTX audio VAEs.
Either selection can be `None`: that file is skipped and its output is `None`.
This is useful for GGUF/LTX flows with separate VAE files.

### Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `video_vae` | `None` | Video/image VAE file, or `None` to skip |
| `audio_vae` | `None` | Audio VAE file, such as MiniMax H3 or LTX, or `None` to skip |
| `disable_offload` | `true` | Request a full load for each selected VAE; uses the same behavior as VAE Loader |

### Outputs

| Output | Type | Description |
|--------|------|-------------|
| `video_vae` | VAE | Loaded video/image VAE, or `None` |
| `audio_vae` | VAE | Loaded audio VAE, or `None` |

These standalone VAE nodes use file dropdowns. For per-file **Source / integrity**
controls and a Download Manager return target, use Smart Model Loader's VAE or
Audio VAE section.
