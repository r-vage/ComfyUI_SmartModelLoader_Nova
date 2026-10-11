# CLIP Loader

Add **CLIP Loader** under **Smart Model Loader v2 → Loader**. Its serialized ID
is `CLIP Loader [SML2]`. Outputs are **clip** (CLIP) and **clip_names** (STRING).
`clip_names` contains all loaded filenames separated by a comma and a space, in
encoder-row order. Subfolder paths and repeated selections are preserved, for
example `Encoders/clip_l.safetensors, t5xxl.safetensors`.

The node uses the same Jade controls and compact resource rows as Smart Model
Loader in classic canvas and Nodes 2.0. It loads external text encoders;
model loading, baked components and CLIP skip belong to other nodes.

## Encoder rows

Choose the **Encoder type** required by your model, then select the local file
for each encoder. The menu reflects the types available in your installed
ComfyUI. The initial type is Flux when available.

**+ Encoder** adds a row with no fixed row-count limit. The arrow buttons reorder rows and **×**
removes a row; at least one row remains. Each displayed row must have a file
before execution. The loader passes the files to ComfyUI in their displayed
order. Files in the configured `clip` and `text_encoders` locations are supported.
GGUF files require the compatible GGUF backend.

The node passes the entire list to ComfyUI. The number and order of files can
affect architecture detection, so include only the encoders required by the model.
Supported combinations depend on your installed backend; adding more rows does
not add a new model architecture. Smart Model Loader's built-in CLIP section has
a separate four-row limit.

The file picker refreshes its catalog when opened. A missing file remains named
in the workflow and is marked **Local file missing**. The loader stops with an
error before loading any encoders if a selected file cannot be resolved.

## Source / integrity

Each row's information button opens its source and expected SHA-256 fields.
Selecting a different local file clears the old file's source and hash.
Existing sidecars then fill its saved AIR or HF repository/revision and SHA-256.
Older verified Download Manager history can supply missing source metadata.
Selection performs no provider request or hashing and preserves newer manual edits.

Under **Advanced**, enable **Local integrity** to verify all selected encoders
before loading. Verification requires an expected SHA-256 from the row or an
existing expected-hash sidecar. The **sidecar** policy records local baselines;
it does not establish a provider-verified hash. This policy is saved in the workflow.

With a CivitAI AIR or Hugging Face repository configured, **Open in Download
Manager** opens the manager and fetches its file listing. Select the files and
start downloads there. Loading a workflow or editing a source does not start
provider inspection or downloads.

The filename and expected hash can start empty. After you select, queue and start
a download, verified completion fills that same encoder row with its local
filename, exact source and SHA-256. Other encoders and loaders are unchanged.
See the [Source / integrity visual tour](Download_Manager.md#visual-tour).

## Workflows and reset

CLIP Loader has no preset library or preset toolbar. Its configuration, ordered
resource rows, source metadata and local integrity policy are saved in the
workflow. The reset icon beside **Encoder type** restores the default type and
single empty row and can be undone.

Workflow save/reload, cloning and Undo preserve the structured configuration.
There is no bank of hidden encoder widgets: rows are created from the saved
configuration, including workflows with more than four encoders.

The small square **✎** button beside a selected filename opens Rename. It renames
the file in its current folder, keeping the extension, together with its
`.sha256` and `.eclipse.json` source/hash sidecars (including an unambiguous
legacy `.sha256` sidecar). Only the initiating field and its local file list are
updated. Other loaders and saved presets keep their filenames; select the new
file there and save or overwrite presets explicitly. Existing destination files
are never replaced. Finish queued prompts/downloads before renaming.
