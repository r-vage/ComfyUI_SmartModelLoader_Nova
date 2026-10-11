# KSampler Pipe

Find **KSampler Pipe [SML2]** under **Smart Model Loader v2 → Sampler**.
It uses the same Jade menus, compact sampler controls and seed row as Smart
Model Loader in classic canvas and Nodes 2.0. It has no presets or integrity
controls.

Connect a **PIPE** containing the model and VAE, and connect **positive** and
**negative** conditioning. The model comes from the pipe; there is no separate
MODEL input. Outputs are the updated **PIPE**, sampled **LATENT**, and decoded
**IMAGE**.

## Options and settings

Each button in the collapsible **Options** bar independently enables or
disables its feature. The sampler and seed controls stay visible and editable.
Collapsing the bar only hides its buttons and shows the enabled options.

| Button | Enabled | Disabled |
| --- | --- | --- |
| **Use pipe settings** | Supplied pipe values take priority for sampler, scheduler, steps, CFG, denoise and seed. Missing or `None` values use the local controls. | Use local sampler and seed values. |
| **Tiled decode** | Decode with ComfyUI's tiled VAE decoder and the selected tile size. | Use normal VAE decoding. |
| **Alpha** | Preserve the decoded alpha channel when the VAE produces RGBA. | Remove alpha from decoded images, returning RGB for downstream nodes. |
| **Preview** | Show sampling previews and the decoded image on the node. | Suppress both previews; all three outputs still work. |

Defaults are local settings, normal decoding, Alpha disabled, and Preview enabled. **Sampler**
and **Scheduler** sit side by side; **Steps**, **CFG**, and **Denoise** share one
row. Tile size stays visible and becomes editable when Tiled decode is enabled.
It uses pixels, defaults to 512, and accepts multiples of 32 from 64 to 4096.
This switch affects decoding; connected images use normal VAE encoding.

**Alpha** applies to both decoding modes, the **IMAGE** output, the image in
the **PIPE**, and the final decoded preview. Disabling it removes the alpha
channel without changing RGB values or blending onto a background. Enabling it
preserves the VAE's output; it does not add alpha to RGB images. Workflows saved
without this option use the disabled default. Input-image encoding keeps its
native VAE channel handling.

## Seeds

The shared seed row preserves unsigned 64-bit integers without rounding. Small
**− / +** buttons change the seed by one and switch it to fixed mode. With
random mode selected, they start from the last queued seed when available.
Manual stepping stops at the range limits, 0 and 18446744073709551615.

The three icon buttons are **Randomize each run**, **Use last queued seed**, and
**Create fixed random seed**. Enter a fixed seed or the shortcuts `-1` for random,
`-2` for increment, and `-3` for decrement. Increment/decrement start from the
last queued seed, or a random value if none exists, and wrap at the range limits.
There is no extra seed-policy dropdown.

Local seed controls advance only after an accepted submission. Queued workflow
snapshots contain the concrete seed. Rejected submissions leave the editor
unchanged. With **Use pipe settings** enabled, the local seed is retained and
does not advance; normally the upstream loader manages the pipe seed. If the pipe
omits its seed, the sampler uses the stored local value, or resolves a random
value for the random policy. Increment/decrement advance only in local mode.
Direct API calls use the supplied seed value for fixed/increment/decrement,
resolve random policies on the backend, and record the effective settings in
execution metadata.

## Latent and image inputs

An explicitly connected **image** is encoded and takes priority. Otherwise an
explicit **latent** wins over both resources in the pipe. Without either socket
connected, use the pipe's latent, or its image when there is no latent. Preferring
the pipe latent lets sampler chains continue without re-encoding the previous
preview image.

Images keep their channels until VAE encoding. ComfyUI drops alpha for RGB
VAEs, preserves it for RGBA VAEs such as Qwen Image 2.1, and supplies opaque
alpha when an RGBA VAE receives RGB input.

Sampling uses ComfyUI's batch, noise-mask and batch-index handling. The output
pipe preserves unrelated fields and records the actual settings, conditioning,
latent, image and output dimensions. The incoming pipe and latent are not mutated.
The selected VAE must match the model and sampled latent. Successful sampling
does not establish that another VAE can decode it; Qwen Image 2.1, for example,
requires its matching VAE rather than the original Qwen Image VAE.

Model-specific guidance and model-sampling patches belong upstream. The sampler
does not apply the PIPE's `flux_guidance` to conditioning. For Flux guidance,
connect IO Checkpoint Loader's `flux_guidance` to a **FluxGuidance** node and send
its conditioning output to the sampler's positive input. Explicit `sigmas` in a
PIPE are also not consumed here; extract them with IO Checkpoint Loader and use
a custom sampler such as **SamplerCustomAdvanced**.

Workflow saving, cloning and Undo/Redo retain the form values and bar state.
Unavailable saved sampler/scheduler names remain visible and are rejected if
used, rather than silently replaced with another algorithm.
