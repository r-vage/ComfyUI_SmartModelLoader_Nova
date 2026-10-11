import { LoaderForm, element, button } from './smart-model-loader-v2-ui.js';

export function completeSamplerPreview(node, output, revokePreview) {
    if (!Array.isArray(output?.images)) return;
    // Live frames take priority over final output in both ComfyUI renderers.
    // Retire the native preview record, including its shared blob reference.
    revokePreview(node);
    node.images = undefined; node.preview = undefined;
    if (output.images.length) {
        node.setDirtyCanvas(true, true);
        return;
    }
    // ComfyUI's classic preview loader leaves imgs untouched for an empty
    // result. Remove only its own preview widget; the configuration stays put.
    node.imgs = undefined; node.imageIndex = null;
    for (const widget of [...(node.widgets ?? [])]) {
        if (widget.name === '$$canvas-image-preview') node.removeWidget(widget);
    }
    node.setSize([node.size[0], node.computeSize()[1]]);
    node.setDirtyCanvas(true, true);
}

export class SamplerForm extends LoaderForm {
    build(content) {
        const options = [
            ['usePipe', 'Use pipe settings', this.config.usePipe,
                'Use sampler and seed values supplied by the pipe. Missing values use the local settings below.'],
            ['tiled', 'Tiled decode', this.config.decode.tiled,
                'Decode the result in VAE tiles. Tile size is set below.'],
            ['alpha', 'Alpha', this.config.decode.alpha,
                'Keep the alpha channel when the VAE decodes RGBA. Disabled by default to return RGB images.'],
            ['preview', 'Preview', this.config.preview,
                'Show sampling progress previews and the decoded image on this node.'],
        ];
        const summary = options.filter(([, , enabled]) => enabled).map(([, label]) => label).join(' · ') || 'None';
        const { bar, expanded } = this.optionBar('samplerOptions', 'Options', summary);
        bar.className = 'sml-v2-bar sml-v2-options-bar';
        bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Sampler options');
        if (expanded) for (const [key, label, enabled, help] of options) {
            const toggle = button(label, () => this.edit(state => state.toggle(key)), help);
            toggle.setAttribute('aria-label', label);
            toggle.setAttribute('aria-pressed', String(enabled));
            toggle.dataset.field = `options.${key}`;
            bar.append(toggle);
        }
        content.append(bar);
        this.sampler(content, false);
        this.seed(content);
        const decode = element('div', 'sml-v2-decode-controls');
        const field = this.spec.decode.tileSize;
        const size = this.input(decode, 'decode.tileSize', field.label, this.config.decode.tileSize,
            value => { this.config.decode.tileSize = value; }, { type: 'number', min: field.min, max: field.max, step: field.step });
        size.disabled = !this.config.decode.tiled;
        size.title = 'VAE decode tile size in pixels; used only when Tiled decode is enabled.';
        content.append(decode);
    }
}
