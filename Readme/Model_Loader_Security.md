# Model files, sources and integrity

Smart Model Loader Nova keeps local file validation, per-resource source metadata
and verified downloading separate. The [Source / integrity visual tour](Download_Manager.md#visual-tour)
shows how these controls work together in the loader and Download Manager.

## Local file policy

Selected checkpoints, diffusion models, encoders, VAEs and LoRAs resolve through
their registered ComfyUI model folders. Files must be readable regular files
inside the appropriate folder. Absolute filenames, traversal, symlinked files or
subdirectories, and unsupported formats are rejected before backend loading.

Safetensors (`.safetensors` and `.sft`) are accepted; GGUF is supported for the
diffusion-model and text-encoder paths. Pickle-capable `.ckpt`, `.pt`, `.pth` and
`.bin` model files are denied by default. The administrator's **SML2 → General →
Allow Legacy Model Formats** setting permits those legacy loading formats. It
is private configuration, never a workflow or preset setting, and does not make
an untrusted pickle file safe. Download Manager has additional category-specific
format rules for embeddings and upscale models; see its
[destination reference](Download_Manager.md#choosing-destinations).

## Source / integrity belongs to each file

Each model, external encoder, VAE/audio VAE and LoRA resource can carry its own
CivitAI AIR or Hugging Face repository/revision and expected SHA-256. Selecting
a local file reads matching source/hash sidecars without hashing the file or
contacting a provider. Changing files clears the previous file's metadata.

An AIR or repository ID alone is a source hint. It does not verify local bytes
or start a download. **Open in Download Manager** explicitly retrieves the file
listing; **Add Selected to Queue** and **Start Selected** are separate actions.
The filename and expected hash may remain blank before downloading.

After verified completion, the initiating field receives the actual local
filename, exact source and SHA-256. This works without a preset and continues
while the manager panel is closed in the same browser/workflow session. Other
loaders keep their selections. Save or overwrite presets explicitly when wanted.
See [return assignment behavior](Download_Manager.md#filling-the-callers-file-field)
for row changes, multiple selections and browser reloads.

## Local integrity before loading

**Advanced → Local integrity** in Smart Model Loader applies to every active
local resource: model, external encoders, VAEs and enabled LoRAs. Baked components
share their containing model's check. CLIP Loader and LoRA Stack offer the same
policies for their own active files.

| Policy | Behavior |
| --- | --- |
| Unchecked / `off` | Skip integrity hashing; file-path and format checks still apply. |
| `sidecar` | Record a local SHA-256 baseline without comparing it to an expected provider hash. |
| `verify` | Compare each file to its entered SHA-256 or saved expected hash; stop on a missing expected hash or mismatch. |

Checking Local integrity reveals the policy selector with **verify** selected.
There is no silent downgrade to recording a baseline when the expected hash is
missing. Valid hash caches avoid redundant reads; hashing checks file statistics
before and after reading to detect changes during the operation.

The source and expected digest live in `<filename>.eclipse.json`; the suffix is
also used by this pack. `<filename>.sha256` stores the local hash baseline/cache.
The editor can read a valid local baseline and identifies it as such. A digest
computed only from a local file records those bytes, not their publisher or
whether an earlier download was correct.

## Download verification

CivitAI downloads require an authoritative SHA-256 and consistent model, version
and file identity. Hugging Face listings resolve to an immutable commit and use
the file's LFS/Xet SHA-256 or Git blob identity. A Git blob SHA-1 is never copied
into the SHA-256 field: the manager calculates SHA-256 from the verified file.

Transfers validate public request destinations and redirects, check destination
containment and disk space, stage bytes, and verify them before atomic promotion.
An existing file skipped by conflict policy fills a loader only when it has
successfully passed verification. Successful transfers and verified skips save
source/hash sidecars for later local-file selection.

Cancelled transfers can retain partial bytes for **Retry**. Resume requires
consistent server range metadata; **Delete Partial** discards retained bytes.
Hashing, verification, locking and promotion cannot be cancelled. Removing a
queue record does not delete the downloaded model file.

## Presets and file maintenance

Smart Loader presets live in `templates/`, and LoRA Stack presets in
`templates/lora-stack/`. Preset deletion removes the selected preset JSON only.
Initial template extraction records completion in `.eclipse_loader_data_migrated`.
Subsequent starts do not restore deleted presets from defaults or legacy folders.
Loading a copied v1 template reads and converts its settings in memory; only an
explicit save/overwrite replaces that file.

The file's rename button renames it within its current model folder, preserving
the extension and moving its source/hash sidecars together. Existing destination
files are never replaced. Only the initiating field is updated; other nodes and
saved presets keep their filenames. Finish queued work before renaming.

Preset writes and metadata updates use locked atomic JSON persistence. File
maintenance coordinates with active loads/downloads, and download promotion
requires an idle prompt queue. These controls cannot prevent another extension
or external program from modifying the same files directly.

## Endpoint boundaries

This pack owns `/smart-model-loader-v2/...` endpoints. Mutation requests use
bounded JSON bodies and same-origin browser checks; global mutations are limited
to loopback clients in ComfyUI multi-user mode. Hashing, model scans, downloads
and preset persistence run outside the aiohttp event loop.

Provider verification establishes agreement with the provider's metadata. It
does not establish that a model is suitable for a particular architecture or
that arbitrary legacy serialization is safe. Compatibility still depends on
the selected model, encoder, VAE and installed backend versions.
