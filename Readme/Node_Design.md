# Node designs

Choose **Settings → SML2 → Appearance → Node design**. The setting belongs
only to this repository and works in classic canvas and Nodes 2.0.

| Bundled theme | Background | Controls |
| --- | --- | --- |
| Jade (default) | RGB 26,26,26 (`#1a1a1a`) | Jade accents, purple selection glow |
| Neutral | RGB 58,58,58 (`#3a3a3a`) | Gray controls, no glow |
| Ocean | RGB 26,26,26 (`#1a1a1a`) | Blue accents and glow |
| Amethyst | RGB 26,26,26 (`#1a1a1a`) | Purple accents and glow |
| Amber | RGB 26,26,26 (`#1a1a1a`) | Warm yellow-gold (`#e8b978`) accents and glow, matching the Eclipse README tour |

The palettes are JSON files in `themes/`. They style loader and sampler panels, searchable menus, preset dialogs and Download Manager.
All nodes owned by this pack use the selected node background; nodes with native
ComfyUI controls keep those native controls. Other packs are unaffected.

## Existing workflows and colors

Selecting or reloading a design replaces **all saved/custom node backgrounds**
in this pack, including nodes inside subgraphs. Loading a workflow also applies
the current design. Manual background changes are temporary until one of those
actions happens. Custom title colors are preserved; automatic titles follow the
theme. Node values, connections, collapsed sections and outputs are unchanged.

The chosen theme ID is saved as `node_design` in this repo's private `config.json`.
It takes precedence over an older browser setting at startup and applies across
workflows. Changes are event driven: no file watcher, recurring canvas scan or
per-node theme request.

## Create or edit a theme

1. Copy `themes/jade.json` (or another bundled theme) to
   **`themes/custom/my-theme.json`** in this repo.
2. Change `label`, the colors under `node`, and the values under `tokens`.
   Keep the complete structure and `version: 1`.
3. Click **Reload theme files → Reload themes** in this pack's Appearance
   settings. Select your theme under **Node design**.
4. After editing the selected JSON file again, use **Reload themes** to apply it.

The filename without `.json` is the saved ID. Use lowercase letters, digits,
hyphens and underscores, with at most 64 characters. `label` is the displayed
name. To customize a built-in theme without editing a shipped file, copy it to
`themes/custom/` with its original filename; for example, `custom/jade.json`
overrides `themes/jade.json`. Custom files are ignored by Git and preserved by
updates. Reads never rewrite theme files.

The same complete JSON format works in Eclipse Nova, SML2 and SmartLLM Nova.
Copy a theme into each repo where you want it available and select it separately.
There are no shared settings or runtime imports between the packs.

## Editable fields

| Field | Purpose |
| --- | --- |
| `node.background` | Node body and panel/dialog surface |
| `node.title` | Default automatic title color |
| `node.routing_background` | Eclipse Nova pipe/routing body color; black in bundled themes |
| `node.category_titles` | Eclipse Nova's type-based title colors; unused by the other packs |
| `tokens.accent` | Main control accent |
| `tokens.control-*` | Button backgrounds and borders |
| `tokens.input-*`, `tokens.select-*` | Text fields and selectors |
| `tokens.bar-*`, `tokens.pill-*`, `tokens.selected-*` | Mode bars and selected options |
| `tokens.menu-*`, `tokens.dialog-*`, `tokens.backdrop` | Menus, dialogs and shadows |
| `tokens.text`, `muted`, `label`, `error`, `warning`, `success`, `danger` | Text and status colors |
| `tokens.row-bg`, `divider`, `option-bg`, `ratio-bg`, `muted-accent` | Rows, separators and secondary accents |
| `tokens.color-scheme` | `dark` or `light` for native controls inside panels |

Node colors require six-digit hex values, such as `#243544`. Color tokens accept
hex colors with optional alpha (`#00ffcc55`) or `transparent`. `pill-radius` accepts
`0` or a pixel value. Shadow tokens accept `none` or up to four comma-separated
shadows, each with three nonnegative pixel lengths and a hex color, such as
`0 0 10px #975bff99`. Arbitrary CSS and URLs are not accepted.

Malformed, oversized or unsupported files are skipped with a visible message;
valid themes remain available. If the selected file is missing or invalid, Jade
is shown temporarily without overwriting the saved selection. Restore the file
and reload, or explicitly choose another theme. A malformed custom override
leaves the bundled version available.
