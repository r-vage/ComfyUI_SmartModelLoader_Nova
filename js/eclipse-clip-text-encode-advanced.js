import { app } from './comfy/index.js';
import { installNativeSettings, watchWidget } from './smart-model-loader-native-bindings.js';

const NODE_NAME = 'CLIP Text Encode (Advanced) [SML2]';

function bindWeights(node, group) {
    if (!group.own.has('per_layer_weights')) return { sync() {}, dispose() {} };
    const weights = group.fields.get('per_layer_weights').widget;
    const preset = group.fields.get('rebalance_preset');
    const before = { disabled: weights.disabled, option: weights.options.disabled };
    const sync = () => {
        // A linked preset is resolved at execution; keep the local control available.
        const disabled = preset?.input?.link == null && preset?.widget.value !== 'custom';
        weights.disabled = disabled;
        weights.options.disabled = disabled;
        node.setDirtyCanvas?.(true, true);
    };
    const unwatch = watchWidget(preset?.widget, sync);
    sync();
    return {
        sync,
        dispose() {
            unwatch();
            weights.disabled = before.disabled;
            if (before.option === undefined) delete weights.options.disabled;
            else weights.options.disabled = before.option;
        },
    };
}

let dispose;
function bindActiveGraph() {
    dispose?.();
    dispose = installNativeSettings(app.rootGraph ?? app.graph, {
        nodeId: NODE_NAME, bindSettings: bindWeights,
    });
}

app.registerExtension({
    name: 'SML2.CLIPTextEncodeAdvanced',
    setup: bindActiveGraph,
    afterConfigureGraph: bindActiveGraph,
});
