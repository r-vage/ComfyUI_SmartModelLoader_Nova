# Changelog

## 2026-10-17

### Version: 1.0.4

- **Fix**
  - Keep Smart Model Loader denoise with each node when applying presets, including zero, disabled Sampler drafts and workflow restore. Preset saves omit denoise, and older stored values are ignored while other sampler settings still apply.
- **Chore**
  - Remove denoise from all 22 bundled model presets and refresh their default manifest hashes.
- **Docs**
  - Clarify which settings presets save and which remain with the node in the preset dialog and loader guides.
- **Changed files**
  - core/model_loader/configuration.py
  - js/smart-model-loader-v2-state.js
  - js/smart-model-loader-v2-ui.js
  - .defaults/.manifest.json
  - .defaults/templates/Anima_Animij_S1.json.example
  - .defaults/templates/Anima_Animij_ai.json.example
  - .defaults/templates/Flux2_Klein-9B_Fluxtrait_v2.json.example
  - .defaults/templates/Flux2_Klein-9B_Fluxtrait_v3.json.example
  - .defaults/templates/Flux2_Klein-9B_KV.json.example
  - .defaults/templates/Flux_Dev.json.example
  - .defaults/templates/Flux_Dev_Nunchaku.json.example
  - .defaults/templates/Flux_Fluxmania_Legacy_Nunchaku.json.example
  - .defaults/templates/Flux_Kontext.json.example
  - .defaults/templates/Flux_Kontext_Nunchaku.json.example
  - .defaults/templates/Flux_Kreamania.json.example
  - .defaults/templates/Illustrious_Animij_v8.json.example
  - .defaults/templates/Illustrious_UnholyDesireMix_v8.json.example
  - .defaults/templates/Krea2_Kreamania_v7d.json.example
  - .defaults/templates/Krea2_Kreamania_v8b.json.example
  - .defaults/templates/Krea2_Luc_Anime_v1.json.example
  - .defaults/templates/Krea2_MoodyMix_v8.json.example
  - .defaults/templates/Krea2_Turbo_BF16.json.example
  - .defaults/templates/NoobAI_OneObsession.json.example
  - .defaults/templates/Qwen Image 2.1_Final Cut_Int8.json.example
  - .defaults/templates/Qwen Image 2.1_Redqw21-Unlocked_v2.json.example
  - .defaults/templates/ZIT_BF16.json.example
  - README.md
  - Readme/Smart_Loaders.md
  - pyproject.toml

## 2026-10-16

### Version: 1.0.3

- **Feat**
  - Default new installations to Neutral, including the appearance selector and missing-theme display. Preserve saved theme choices during startup and default updates.
  - Ship palettes under .defaults/themes and extract each into the user-owned themes folder once. Preserve existing files, edits and deletions across restarts and changed defaults, including installations with an older migration marker.
- **Fix**
  - Recognize the renamed Nova Python module when routing loader execution and validation error notifications.
- **Chore**
  - Rename the package and Add Node menu to Smart Model Loader Nova, update repository and icon URLs, and point the bundled workflow's repository hints to Nova. Existing [SML2] node IDs, SML2 settings and smart-model-loader-v2 APIs remain unchanged.
- **Docs**
  - Update installation commands, issue links and node-guide menu paths for the Nova repository. Explain restarting ComfyUI and reloading the browser after renaming an existing checkout.
  - Document one-time theme extraction, direct palette edits and manual restoration of removed themes.
- **Changed files**
  - core/config_store.py
  - core/server_endpoints.py
  - js/node-design-theme.js
  - .defaults/config.json.example
  - Readme/Download_Manager.md
  - core/theme_defaults.py
  - core/migration.py
  - js/smart-model-loader-error-notifications.js
  - .gitignore
  - .defaults/.manifest.json
  - .defaults/themes/jade.json.example
  - .defaults/themes/neutral.json.example
  - .defaults/themes/ocean.json.example
  - .defaults/themes/amethyst.json.example
  - .defaults/themes/amber.json.example
  - .defaults/themes/custom/README.md.example
  - Readme/Node_Design.md
  - core/keys.py
  - pyproject.toml
  - workflows/SML2.json
  - README.md
  - Readme/CLIP_Loader.md
  - Readme/Component_Loaders.md
  - Readme/KSampler_Pipe.md
  - Readme/LoRA_Stack.md
  - Readme/Model_Loader_Security.md
  - Readme/Smart_Loaders.md

## 2026-10-15

### Version: 1.0.2

- **Feat**
  - Load node designs from editable JSON palettes. Add custom themes and built-in overrides through themes/custom, with a Reload themes action under SML2 → Appearance.
  - Add Amber with warm yellow-gold controls and selection glow matched to the Eclipse README tour, on an RGB 26,26,26 background.
- **Fix**
  - Apply the selected background to all SML2 nodes, replacing custom or stale workflow backgrounds in classic canvas and Nodes 2.0
- **Refactor**
  - Use theme tokens throughout panel controls, menus, preset dialogs and Download Manager.
- **Docs**
  - Explain theme creation, custom overrides, reload and background precedence.

- **Changed files**
  - core/node_designs.py
  - core/config_store.py
  - core/server_endpoints.py
  - js/node-design-theme.js
  - js/smart-model-loader-design.js
  - js/smart-model-loader-v2.css
  - js/smart-model-loader-download-manager.js
  - .defaults/config.json.example
  - themes/jade.json
  - themes/neutral.json
  - themes/ocean.json
  - themes/amethyst.json
  - themes/amber.json
  - themes/custom/README.md
  - pyproject.toml
  - Readme/Node_Design.md
  - README.md
  - Readme/Download_Manager.md

## 2026-10-12

### Version: 1.0.1

- **Feat**
  - Add Jade, Neutral, Ocean and Amethyst designs under SML2 → General → Node design. Apply the selected palette to shared controls, searchable menus, preset dialogs and Download Manager in classic canvas and Nodes 2.0.
  - Save the design in private config.json and load it on startup. Jade, Ocean and Amethyst share RGB 26,26,26 node/dialog backgrounds with different control colors. Neutral keeps RGB 58,58,58, gray controls and no glow. Preserve node title colors, custom backgrounds and workflow values, with independent settings and styling for this pack.
- **Docs**
  - Document the design presets, settings location and Download Manager appearance.

- **Changed files**
  - core/config_store.py
  - core/server_endpoints.py
  - js/smart-model-loader-design.js
  - js/smart-model-loader-settings.js
  - js/smart-model-loader-v2.css
  - js/smart-model-loader-download-manager.js
  - .defaults/config.json.example
  - pyproject.toml
  - README.md
  - Readme/Node_Design.md
  - Readme/Download_Manager.md

## 2026-10-11

### Version: 1.0.0

Initial release of ComfyUI Smart Model Loader v2, tested with ComfyUI 0.38.0.

- **Feat**
  - Introduce a compact shared Jade interface for classic canvas and Nodes 2.0. The design is adapted from DaSiWa, with dynamic controls chosen to reduce widget and layout overhead.
  - Provide option bars that collapse to compact summary headers, collapsible settings sections with consistently aligned headers, searchable file and encoder-type pickers, panels that follow the node background, and configuration reset controls. Retain selections and section state through workflow saving, cloning, Undo/Redo and subgraph navigation.
  - Add Smart Model Loader for checkpoint, UNet, GGUF and Nunchaku backends, supporting model-only loading or a complete PIPE with optional CLIP, VAE, audio VAE, LoRAs, image latents, sampler settings, model sampling and seeds.
  - Support LTX model-supplied text projections with one external Gemma encoder, an ltxv default for new combined-source selections, and projection validation before memory cleanup or model loading.
  - Include visual tours with Jade numbered callouts and exterior arrows in the Eclipse tour style: Smart Model Loader controls; Source / integrity through Download Manager selection, queueing and verified filename/hash return; and LoRA Stack wiring, strengths and AIR-only rows. Provide guides and screenshots for the current node set, including per-file integrity, explicit preset saving, encoder/LoRA limits, guidance wiring, VAE pairing and PuLID dependency setup.
  - Offer attention backend selection, Nunchaku CPU offload controls, memory cleanup and DynamicVRAM-aware block swap controls.
  - Provide image latent sizing with grouped aspect and resolution menus, editable divisibility, custom megapixel or fixed-pixel sizes, and batch size. Support native image latent handling for Qwen and Krea models.
  - Add CLIP Loader with dynamic ordered encoder rows, encoder-type selection, standard and GGUF loading, and a comma-separated clip_names output.
  - Add LoRA Stack and Apply with up to 60 rows, Model, CLIP split and Audio (LTX) modes, independent strengths, and native Nunchaku support with separate LoRA state for each model branch. Retain disabled or empty rows in the editor while applying only active file selections.
  - Add KSampler Pipe with compact sampler and seed controls, optional image or latent inputs, and independent Use pipe settings, Tiled decode, Alpha and Preview options. Sample complete batches with noise-mask support and return the updated PIPE, latent and decoded image.
  - Provide an Alpha option that defaults off, returning RGB after normal or tiled decoding. Enable it to preserve decoded transparency in the image output, PIPE and final preview. Input-image encoding follows the selected VAE's RGB/RGBA handling.
  - Display one sampler preview below the controls, transitioning from live sampling to the final decoded image. Scale the preview with the node and retain the chosen node size when controls wrap or workflows reload.
  - Provide searchable sampler menus in Smart Model Loader and KSampler Pipe, with immediate filtering, keyboard selection and the shared Jade styling in classic canvas and Nodes 2.0.
  - Provide exact 64-bit seed handling with compact −/+ buttons for manual changes, Randomize, Use last queued and Create fixed controls, plus increment and decrement shortcuts. Record concrete seeds in queued workflows and advance local seed controls after accepted submissions.
  - Provide searchable Smart Loader and LoRA presets with remembered save names, explicit overwrite and confirmed deletion. Smart Loader presets save the selected model setup and LoRAs while retaining each node's own Latent, Advanced settings and seeds when applied. Latent sizing and batch size remain runtime options saved in workflows.
  - Use the standard templates folder for new nodes and support copied v1 Smart Loader templates without installing v1 nodes. Read their settings into the new form with a save reminder, preserving the original file until the user explicitly saves and overwrites it or saves a converted copy.
  - Ship 22 selected Smart Loader presets in the structured format with model, encoder, VAE and source/integrity settings. Extract presets once during initial setup and record completion, preserving user edits and deletions across restarts and updates.
  - Provide per-file source and integrity fields with automatic AIR or HF repository/revision and SHA-256 autofill when selecting local models, encoders, VAEs and LoRAs. Read existing sidecars and matching verified download history without hashing or provider requests, preserve manual edits, and save provider metadata alongside verified downloads for later reuse. Support local SHA-256 recording and verification against expected hashes. Keep selected filenames visible when model files are missing.
  - Add a small filename rename button to model, encoder, VAE and LoRA selectors. Place LoRA rename immediately before the info icon in Smart Model Loader and LoRA Stack rows. Rename the local file together with its source/hash sidecars, preserve metadata, and update only the initiating field and file list. Keep folders, extensions and other loaders unchanged, with explicit preset saving.
  - Add Download Manager for CivitAI and Hugging Face with shared Jade styling and a matching dialog glow, comfortably sized controls, separate Source and View bars on one row, collapsible source details, provider file listings, per-file destination settings and page selection, verified downloads, a persistent queue, resumable retries and download bundles. Open it from a resource with its AIR or repository and revision already selected, then choose files and start downloads explicitly.
  - Offer shared download categories for standard and GGUF files, defaulting to model-storage folders with explicit diffusion_models, unet, text_encoders and clip choices. Keep output folders separate from downloads, identify matching storage-folder names by their parent paths, and retain selected model destinations across saved jobs, retries and bundles.
  - Fill the originating Model, CLIP, VAE or LoRA field with the final filename, source and SHA-256 after a verified download, independently of presets. Keep separate loaders and reordered rows associated with their selected jobs, preserve newer manual selections, support an explicit return choice when downloading multiple variants, and refresh local file lists and open pickers on completion.
  - Include VAE loading, text conditioning, PIPE input/output utilities, Qwen Image 2.1 scheduling, MiniMax Music 3 text encoding and optional Nunchaku PuLID integration.
  - Provide bundled GGUF integration with the gguf Python package (>=0.13.0,<0.20), plus explicit packaging, Transformers, SentencePiece and Protobuf dependencies. Keep both dependency manifests aligned and provide separate setup guidance for optional Nunchaku and PuLID dependencies.
  - Give every included node a unique [SML2] ID and a dedicated Smart Model Loader v2 menu, allowing both loader packs to register their complete node sets together. Keep frontend hooks and bundled workflows scoped to those IDs, with independent SML2 settings, API, notification and Download Manager namespaces.
