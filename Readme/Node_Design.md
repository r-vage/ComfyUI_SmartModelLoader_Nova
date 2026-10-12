# Node designs

Choose **Settings → SML2 → General → Node design** to select a design for this
pack in classic canvas and Nodes 2.0.

Jade, Ocean and Amethyst share the same dark node and dialog background:
**RGB 26, 26, 26** (`#1a1a1a`). Their controls and selection colors differ.
Neutral keeps its original **RGB 58, 58, 58** (`#3a3a3a`) background.

| Design | Controls |
| --- | --- |
| Jade (default) | Jade accents with purple selections |
| Neutral | Gray controls and no glow |
| Ocean | Blue accents and glow |
| Amethyst | Purple accents and glow |

The selected background applies to all `[SML2]` nodes. Control colors apply immediately
to Smart Model Loader, CLIP Loader, LoRA Stack and KSampler Pipe panels, searchable
menus, preset/file dialogs and Download Manager. Other SML2 nodes retain their
existing native controls. Node title colors and custom backgrounds are preserved;
built-in preset and default background colors follow the selected design when loaded.

The choice is saved as `node_design` in this repository's private `config.json`
and loaded before workflows open. It is shared across this installation's
workflows. Loading a workflow saved with another design uses the current
setting while keeping the workflow's values, connections and collapsed sections.

SML2 keeps its configuration and palette independent of Eclipse Nova and the
original Smart Model Loader pack. No model loading, downloads or preset saves
are triggered by a design change.
