// Native fields belong to each promoted host, including renamed/nested inputs.
export const NATIVE_NODE_ID = 'Smart Model Loader Settings [SML2]';

// The first native Settings layout serialized widgets positionally. Preserve its
// remaining settings when removing the panel-owned controls and seed widgets.
const previousFields = ['template', 'model_mode', 'model_name', 'weight_dtype', 'clip_source', 'clip_type',
    'clip_name1', 'clip_name2', 'clip_name3', 'clip_name4', 'clip_skip', 'vae_source', 'vae_name',
    'audio_vae_source', 'audio_vae_name', 'loras', 'model_sampling', 'shift', 'base_shift', 'shift_video',
    'shift_audio', 'latent', 'width', 'height', 'batch_size', 'sampler', 'steps', 'cfg', 'sampler_name',
    'scheduler', 'denoise', 'flux_guidance', 'seed_mode', 'seed', 'cleanup', 'integrity'];
const removedFields = new Set(['latent', 'width', 'height', 'batch_size', 'seed_mode', 'cleanup', 'integrity']);

export function configureNativeSettings(node, data, configure, ...args) {
    const saved = data.widgets_values;
    if (!Array.isArray(saved) || ![previousFields.length, previousFields.length + 1].includes(saved.length)) {
        return configure.call(node, data, ...args);
    }
    const values = new Map(previousFields.map((key, index) => [key, saved[index]]));
    if (values.get('loras') === 'enabled') values.set('loras', '(inherit)');
    const result = configure.call(node, { ...data,
        inputs: data.inputs?.map(input => ({ ...input, ...(input.widget ? { widget: { ...input.widget } } : {}) })),
        widgets_values: node.widgets.map(widget => values.has(widget.name) ? values.get(widget.name) : widget.value),
    }, ...args);
    for (let index = (node.inputs?.length ?? 0) - 1; index >= 0; index--) {
        if (removedFields.has(node.inputs[index].name)) node.removeInput(index);
    }
    const seed = node.inputs?.find(input => input.name === 'seed') ?? node.addInput('seed', 'INT');
    seed.type = 'INT';
    delete seed.widget;
    return result;
}

export function settingsGroups(node, ancestors = new Set(), nodeId = NATIVE_NODE_ID) {
    if ((node.comfyClass ?? node.type) === nodeId) return [{
        path: String(node.id), fields: new Map((node.widgets ?? []).map(widget => [widget.name, {
            widget, node, input: node.inputs?.find(input => input.widget?.name === widget.name),
        }])), own: new Set((node.widgets ?? []).map(widget => widget.name)),
    }];
    if (!node.subgraph || ancestors.has(node.subgraph)) return [];
    const seen = new Set(ancestors).add(node.subgraph), groups = [];
    for (const child of node.subgraph._nodes ?? []) for (const group of settingsGroups(child, seen, nodeId)) {
        const fields = new Map(group.fields), own = new Set();
        for (const input of node.inputs ?? []) {
            const widget = node.getWidgetFromSlot?.(input);
            if (!widget) continue;
            const boundary = node.subgraph.inputNode.slots.find(slot => slot.name === input.name);
            for (const id of boundary?.linkIds ?? []) {
                const link = node.subgraph.getLink(id), target = link && node.subgraph.getNodeById(link.target_id);
                const slot = target?.inputs?.[link.target_slot];
                for (const [key, field] of group.fields) if (field.node === target && field.input === slot) {
                    fields.set(key, { widget, node, input }); own.add(key);
                }
            }
        }
        if (own.size) groups.push({ ...group, path: `${node.id}/${group.path}`, fields, own });
    }
    return groups;
}

const callbackListeners = new WeakMap();
function watchCallback(target, key, listener) {
    if (!target) return () => {};
    let records = callbackListeners.get(target);
    if (!records) { records = new Map(); callbackListeners.set(target, records); }
    let record = records.get(key);
    if (!record) {
        record = { previous: target[key], listeners: new Set() };
        record.callback = function (...args) {
            const result = record.previous?.apply(this, args);
            for (const notify of record.listeners) notify();
            return result;
        };
        target[key] = record.callback; records.set(key, record);
    }
    record.listeners.add(listener);
    return () => {
        record.listeners.delete(listener);
        if (!record.listeners.size) {
            if (target[key] === record.callback) target[key] = record.previous;
            records.delete(key);
            if (!records.size) callbackListeners.delete(target);
        }
    };
}

export function watchWidget(widget, listener) {
    return watchCallback(widget, 'callback', listener);
}

export function installNativeSettings(root, { bindSettings, subscribeRefresh, nodeId = NATIVE_NODE_ID }) {
    const graphs = new Map(), connections = new Map();
    let bindings = new Map(), pending = false, disposed = false;
    function schedule() {
        if (pending || disposed) return;
        pending = true;
        queueMicrotask(() => { pending = false; if (!disposed) rebuild(); });
    }
    function rebuild() {
        const visited = new Set(), next = new Map(), retained = new Set();
        function visit(graph) {
            if (!graph || visited.has(graph)) return;
            visited.add(graph);
            if (!graphs.has(graph)) {
                const controller = new AbortController();
                for (const event of ['node:added', 'node:removed', 'configured', 'subgraph-created',
                    'widget-promoted', 'widget-demoted', 'input-added', 'removing-input', 'inputs-reordered', 'renaming-input']) {
                    graph.events?.addEventListener(event, schedule, { signal: controller.signal });
                }
                graphs.set(graph, controller);
            }
            for (const node of graph._nodes ?? []) {
                const records = new Map();
                for (const group of settingsGroups(node, new Set(), nodeId)) {
                    const previous = bindings.get(node)?.get(group.path);
                    const same = previous && group.own.size === previous.group.own.size
                        && group.fields.size === previous.group.fields.size
                        && [...group.fields].every(([key, field]) => {
                            const old = previous.group.fields.get(key);
                            return old?.widget === field.widget && old.input === field.input
                                && group.own.has(key) === previous.group.own.has(key);
                        });
                    const record = same ? previous : { group, node };
                    records.set(group.path, record); retained.add(record);
                }
                if (records.size) next.set(node, records);
                visit(node.subgraph);
            }
        }
        visit(root);
        for (const [graph, controller] of graphs) if (!visited.has(graph)) {
            controller.abort(); graphs.delete(graph);
        }
        for (const records of bindings.values()) for (const record of records.values()) {
            if (!retained.has(record)) record.binding.dispose();
        }
        for (const records of next.values()) for (const record of records.values()) {
            if (record.binding) record.binding.sync();
            else record.binding = bindSettings(record.node, record.group);
        }
        for (const [node, release] of connections) if (!next.has(node)) {
            release();
            connections.delete(node);
        }
        for (const node of next.keys()) if (!connections.has(node)) {
            connections.set(node, watchCallback(node, 'onConnectionsChange', schedule));
        }
        bindings = next;
    }
    const unsubscribe = subscribeRefresh?.(() => {
        for (const records of bindings.values()) for (const { binding } of records.values()) void binding.refresh();
    });
    rebuild();
    return () => {
        disposed = true; unsubscribe?.();
        for (const records of bindings.values()) for (const { binding } of records.values()) binding.dispose();
        for (const controller of graphs.values()) controller.abort();
        for (const release of connections.values()) release();
        connections.clear(); bindings.clear(); graphs.clear();
    };
}
