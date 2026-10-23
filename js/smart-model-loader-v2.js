import { app, api, hasNodePreview, revokeNodePreview } from './comfy/index.js';
import { NODE_IDS, SAMPLER_NODE_ID, WIDGET_TYPE, EDITOR_KEY, LoaderState, clone } from './smart-model-loader-v2-state.js';
import { LoaderForm } from './smart-model-loader-v2-ui.js';
import { ClipState, ClipForm } from './smart-model-loader-v2-clip.js';
import { LoraState, LoraForm } from './smart-model-loader-v2-lora.js';
import { SamplerState } from './smart-model-loader-v2-sampler-state.js';
import { SamplerForm, completeSamplerPreview } from './smart-model-loader-v2-sampler.js';
import { installQueueHook } from './smart-model-loader-v2-queue.js';
import { openDownloadManager } from './smart-model-loader-download-manager.js';
import { captureDownloadTarget, onDownloadCatalogChange } from './smart-model-loader-v2-downloads.js';
import { captureRenameTarget } from './smart-model-loader-v2-files.js';

const controllers = new WeakMap();
const liveLoaders = new Set();
const graphHostKey = Symbol('SML2.V2.Host');
const catalogRequests = new Map();
onDownloadCatalogChange(() => {
    catalogRequests.clear();
    // One request per profile, shared by every live loader; no per-node polling.
    for (const controller of liveLoaders) controller.form.action(() => controller.refresh());
});
async function request(path, payload) {
    const response = await api.fetchApi(`/smart-model-loader-v2/v2/${path}`, payload === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error ?? 'The loader request failed');
    return result;
}
function catalog(profile, refresh = false) {
    if (refresh || !catalogRequests.has(profile)) {
        const pending = request(`catalog?${new URLSearchParams({ profile })}`).catch(error => {
            if (catalogRequests.get(profile) === pending) catalogRequests.delete(profile);
            throw error;
        });
        catalogRequests.set(profile, pending);
    }
    return catalogRequests.get(profile);
}

class LoaderController {
    constructor(node, name, options) {
        this.node = node; this.spec = options.editorSpec; this.defaultValue = clone(options.default); this.raw = options.default;
        this.State = { clip: ClipState, lora: LoraState, sampler: SamplerState }[this.spec.profile] ?? LoaderState;
        this.state = new this.State(this.raw, this.spec);
        // Samplers grow to their first measured form height; no placeholder
        // height needs to be removed from a new or restored node later.
        this.height = this.spec.profile === 'sampler' ? 0 : 320;
        this.catalog = {}; this.revision = 0; this.presetGeneration = 0;
        this.root = document.createElement('div'); this.root.className = 'sml-v2';
        this.root.setAttribute('aria-label', options.editorLabel ?? 'Smart Model Loader configuration');
        this.root.dataset.smlV2Profile = this.spec.profile;
        // Scope interaction to the component, including keyboard editing inside nodes.
        this.root.addEventListener('pointerdown', event => event.stopPropagation());
        this.root.addEventListener('keydown', event => event.stopPropagation());
        this.widget = node.addDOMWidget(name, WIDGET_TYPE, this.root, {
            getValue: () => this.value(), setValue: value => this.restore(value),
            getMinHeight: () => this.height, getMaxHeight: () => this.height, getHeight: () => this.height,
            hideOnZoom: false, serialize: true, margin: 0,
        });
        this.widget.serializeValue = () => this.value();
        this.widget.computeSize = () => [this.node.size[0], this.height];
        const Form = { clip: ClipForm, lora: LoraForm, sampler: SamplerForm }[this.spec.profile] ?? LoaderForm;
        this.form = new Form({ root: this.root, getState: () => this.state,
            edit: (fn, render = true) => this.edit(fn, render), catalog: () => this.catalog,
            changed: () => this.measure(), refresh: () => this.refresh(true), reset: () => this.reset(),
            readModelMetadata: (role, name) => request(`model-metadata?${new URLSearchParams({ role, name })}`),
            renameModel: async (field, newName) => {
                const apply = captureRenameTarget(this, field);
                const result = await request('model/rename', { role: field.role, name: field.resource.name, newName });
                apply(result);
                this.form.action(() => this.refresh(true));
                return result;
            },
            ...(['clip', 'sampler'].includes(this.spec.profile) ? {} : {
                loadPreset: async name => {
                    const generation = ++this.presetGeneration;
                    const revision = this.revision;
                    const data = await request(`preset?${new URLSearchParams({ name, profile: this.spec.profile })}`);
                    if (this.disposed || generation !== this.presetGeneration || revision !== this.revision) return false;
                    this.edit(() => {
                        this.state = this.state.withPreset(data.configuration, name);
                        if (data.needs_conversion === true) this.state.editor.presetNeedsConversion = true;
                        else delete this.state.editor.presetNeedsConversion;
                    });
                    return true;
                },
                savePreset: async (name, overwrite) => {
                    const revision = this.revision;
                    const data = await request('preset', { name, overwrite, configuration: this.state.preset(), profile: this.spec.profile });
                    if (this.disposed) return;
                    this.generation++;
                    this.catalog = { ...this.catalog, presets: data.presets }; catalogRequests.delete(this.spec.profile);
                    if (revision === this.revision) this.edit(state => {
                        state.editor.presetName = name; delete state.editor.presetNeedsConversion;
                    }, false);
                    this.form.render(); this.form.status('Preset saved.');
                },
                deletePreset: async name => {
                    const data = await request('preset/delete', { name, profile: this.spec.profile });
                    if (this.disposed) return;
                    this.generation++;
                    this.catalog = { ...this.catalog, presets: data.presets }; catalogRequests.delete(this.spec.profile);
                    if (this.state.editor.presetName === name) this.edit(state => {
                        state.editor.presetName = ''; delete state.editor.presetNeedsConversion;
                    }, false);
                    this.form.render(); this.form.status('Preset deleted.');
                },
            }),
            openDownloads: field => {
                const target = captureDownloadTarget(this, field), source = field.resource.source;
                return openDownloadManager(source ? {
                    provider: source.provider, locator: source.reference, revision: source.revision ?? '',
                } : null, target);
            },
        });
        this.observer = new ResizeObserver(() => this.measure());
        this.observer.observe(this.root);
        this.form.render();
        if (this.spec.profile !== 'sampler') {
            liveLoaders.add(this);
            this.form.action(() => this.refresh());
        }
        const remove = this.widget.onRemove.bind(this.widget);
        this.widget.onRemove = () => { this.dispose(); remove(); };
    }
    value() { return this.invalid ? this.raw : this.state.value(); }
    bindHost() {
        const graph = this.node.graph;
        if (!graph || this.disposed) return;
        const owner = `${graph[graphHostKey] ??= crypto.randomUUID()}/${this.node.id}`;
        this.root.dataset.smlV2Owner = owner;
        // WidgetDOM can survive undo while its node/widget is replaced. Rebind our
        // own element in that retained host; never leave a disposed form mounted.
        for (const previous of document.querySelectorAll('.sml-v2[data-sml-v2-owner]')) {
            if (previous !== this.root && previous.dataset.smlV2Owner === owner) previous.replaceWith(this.root);
        }
        this.measure();
    }
    restore(value) {
        for (const target of this.downloadTargets ?? []) target.release();
        this.revision++;
        this.raw = value;
        try {
            this.state = new this.State(value, this.spec, this.node.properties?.[EDITOR_KEY] ?? {});
            // Preserve settings that become inactive on this server before the next edit/save.
            this.node.properties ??= {};
            this.node.properties[EDITOR_KEY] = clone(this.state.editor);
            this.root.classList.remove('sml-v2-error');
            this.invalid = false; this.form?.closeDialog(); this.form?.render();
        } catch (error) {
            this.invalid = true;
            this.root.textContent = `Cannot edit this configuration: ${error.message}`;
            this.root.classList.add('sml-v2-error');
        }
    }
    edit(fn, render = true) {
        if (this.disposed || this.invalid) return;
        const graph = this.node.graph;
        graph?.beforeChange();
        graph?.canvasAction(canvas => canvas.emitBeforeChange());
        try {
            fn(this.state);
            for (const target of this.downloadTargets ?? []) target.current();
            this.revision++;
            this.node.properties ??= {};
            this.node.properties[EDITOR_KEY] = clone(this.state.editor);
            this.raw = this.state.value();
            this.widget.callback?.(this.raw);
        } finally {
            graph?.afterChange();
            graph?.canvasAction(canvas => canvas.emitAfterChange());
        }
        if (render) this.form.render();
        this.node.setDirtyCanvas(true, true);
    }
    reset() {
        if (this.disposed || this.invalid) return;
        this.form.closeDialog(); this.form.modelSelection++;
        this.form.status('');
        this.edit(() => { this.state = new this.State(this.defaultValue, this.spec); });
    }
    async refresh(force = false) {
        if (this.spec.profile === 'sampler') return;
        const generation = (this.generation ?? 0) + 1; this.generation = generation;
        try {
            const data = await catalog(this.spec.profile, force);
            if (this.disposed || generation !== this.generation) return;
            this.catalog = data;
            if (!this.invalid) this.form.render();
            this.form.refreshPicker?.();
        } catch (error) { if (!this.disposed && generation === this.generation) throw error; }
    }
    measure() {
        if (this.disposed || this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            if (!this.root.isConnected || !this.root.offsetWidth) return;
            const content = this.root.firstElementChild;
            const height = Math.ceil((content?.offsetHeight ?? 0) + 16);
            if (height <= 16 || height === this.height) return;
            this.height = height;
            this.root.style.setProperty('--comfy-widget-height', `${height}px`);
            this.root.style.setProperty('--comfy-widget-min-height', `${height}px`);
            this.root.style.setProperty('--comfy-widget-max-height', `${height}px`);
            const width = this.node.size[0];
            const minimumHeight = this.node.computeSize()[1];
            // Wrapping sampler controls must not reset a manually sized preview
            // or compete with the native resize handle. Grow only if necessary.
            const nodeHeight = this.spec.profile === 'sampler'
                ? Math.max(this.node.size[1], minimumHeight) : minimumHeight;
            if (width !== this.node.size[0] || nodeHeight !== this.node.size[1]) this.node.setSize([width, nodeHeight]);
            this.node.setDirtyCanvas(true, true);
        });
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.observer.disconnect();
        liveLoaders.delete(this);
        for (const target of this.downloadTargets ?? []) target.release();
        if (this.frame) cancelAnimationFrame(this.frame);
        this.form.dispose(); controllers.delete(this.node);
    }
}

app.registerExtension({
    name: 'SML2.V2',
    setup() {
        const link = document.createElement('link'); link.rel = 'stylesheet';
        link.href = new URL('./smart-model-loader-v2.css', import.meta.url).href;
        document.head.append(link);
        installQueueHook(api, app, controllers);
    },
    getCustomWidgets() {
        return { [WIDGET_TYPE](node, name, inputData) {
            const controller = new LoaderController(node, name, inputData[1]);
            controllers.set(node, controller);
            return { widget: controller.widget, minWidth: inputData[1].editorSpec.profile === 'clip' ? 360 : 440 };
        } };
    },
    beforeRegisterNodeDef(nodeType, data) {
        if (!NODE_IDS.has(data.name)) return;
        if (data.name === SAMPLER_NODE_ID) {
            // Nodes 2.0 otherwise renders each live frame in both its output
            // panel (after the first result) and its dedicated live preview.
            Object.defineProperty(nodeType.prototype, 'hideOutputImages', {
                configurable: true,
                get() { return hasNodePreview(this); },
            });
            const executed = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (output, ...args) {
                const result = executed?.call(this, output, ...args);
                completeSamplerPreview(this, output, revokeNodePreview);
                return result;
            };
        }
        const configure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (...args) {
            const result = configure?.apply(this, args);
            const controller = controllers.get(this);
            if (controller) { controller.restore(controller.value()); controller.bindHost(); }
            return result;
        };
        const added = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function (...args) {
            const result = added?.apply(this, args);
            controllers.get(this)?.bindHost();
            return result;
        };
    },
});
