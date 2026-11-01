import { app } from './comfy/index.js';
import { catalog, request, onCatalogChange } from './smart-model-loader-catalog.js';
import { NATIVE_NODE_ID, configureNativeSettings, installNativeSettings, watchWidget } from './smart-model-loader-native-bindings.js';
import { showSmartModelLoaderToast } from './smart-model-loader-notifications.js';

const INHERIT = '(inherit)', NONE = '(none)';
const dependencies = ['template', 'model_mode', 'clip_source', 'clip_type', 'vae_source', 'audio_vae_source',
    'model_sampling', 'sampler'];
const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

export function bindSettings(node, group, spec) {
    let disposed = false, sequence = 0, observedTemplate, loadedTemplate, preset, files;
    const disabledBefore = new Map();
    const fieldValue = key => {
        const field = group.fields.get(key);
        return field?.input?.link != null || field?.widget.value === INHERIT ? undefined : field?.widget.value;
    };
    const templateIdentity = () => [group.fields.get('template')?.widget.value, group.fields.get('template')?.input?.link];
    const same = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];
    function choices(key, values) {
        if (group.own.has(key)) group.fields.get(key).widget.options.values = [...values];
    }
    function disabled(key, value) {
        if (!group.own.has(key)) return;
        const widget = group.fields.get(key).widget;
        if (!disabledBefore.has(widget)) disabledBefore.set(widget, { value: widget.disabled, option: widget.options.disabled });
        widget.disabled = value; widget.options.disabled = value;
    }
    function updateControls() {
        if (disposed) return;
        const current = same(loadedTemplate, templateIdentity()) ? preset : undefined;
        const kind = fieldValue('model_mode') ?? current?.model?.kind;
        if (files) {
            const roles = kind ? [spec.modes[kind]?.role] : ['checkpoints', 'diffusion_models', 'diffusion_models_gguf'];
            choices('model_name', [INHERIT, ...sorted(roles.flatMap(role => files[role] ?? []))]);
            for (let i = 1; i <= 4; i++) choices(`clip_name${i}`, [INHERIT, NONE, ...sorted(files.clip ?? [])]);
            for (const key of ['vae_name', 'audio_vae_name']) choices(key, [INHERIT, ...sorted(files.vae ?? [])]);
        }
        disabled('weight_dtype', kind != null && kind !== 'unet');
        for (const [key, prefix] of [['clip', 'clip'], ['vae', 'vae'], ['audioVae', 'audio_vae']]) {
            const sources = kind ? spec.componentSources[kind]?.[key] : (key === 'clip' ? ['baked', 'external', 'combined'] : ['baked', 'external']);
            choices(`${prefix}_source`, [INHERIT, 'disabled', ...(sources ?? [])]);
            let source = fieldValue(`${prefix}_source`) ?? (current ? current[key]?.source ?? 'disabled' : undefined);
            if (source !== 'disabled' && source != null && sources && !sources.includes(source)) source = 'external';
            const inactive = source != null && !['external', 'combined'].includes(source);
            if (key === 'clip') {
                for (const control of ['clip_type', 'clip_name1', 'clip_name2', 'clip_name3', 'clip_name4']) disabled(control, inactive);
                disabled('clip_skip', source === 'disabled');
            } else disabled(`${prefix}_name`, inactive);
        }
        const method = fieldValue('model_sampling') ?? (current ? current.modelSampling?.method ?? 'None' : undefined);
        for (const key of ['shift', 'base_shift', 'shift_video', 'shift_audio']) disabled(key, method != null && !Object.hasOwn(spec.sampling[method] ?? {}, key));
        const sampler = fieldValue('sampler') ?? (current ? current.sampler ? 'enabled' : 'disabled' : undefined);
        for (const key of ['steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'flux_guidance']) disabled(key, sampler === 'disabled');
        const clipType = fieldValue('clip_type') ?? current?.clip?.type;
        if (kind != null && (kind === 'checkpoint' || kind.startsWith('nunchaku-') && kind !== 'nunchaku-flux'
            || ['unet', 'gguf'].includes(kind) && clipType != null && !['flux', 'flux2'].includes(clipType))) disabled('flux_guidance', true);
        node.setDirtyCanvas?.(true, true);
    }
    async function refresh(force = false) {
        if (disposed) return;
        const identity = observedTemplate = templateIdentity(), name = fieldValue('template'), requestId = ++sequence;
        updateControls();
        const [catalogResult, presetResult] = await Promise.allSettled([catalog('smart', force), name
            ? request(`preset?${new URLSearchParams({ name, profile: 'smart' })}`) : null]);
        if (disposed || requestId !== sequence || !same(identity, templateIdentity())) return;
        if (catalogResult.status === 'fulfilled') {
            files = catalogResult.value.files;
            choices('template', [INHERIT, ...catalogResult.value.presets]);
        }
        preset = presetResult.status === 'fulfilled' ? presetResult.value?.configuration : undefined;
        loadedTemplate = identity;
        updateControls();
        const failure = [catalogResult, presetResult].find(result => result.status === 'rejected');
        if (failure) showSmartModelLoaderToast('Could not refresh native settings', failure.reason, 'warn');
    }
    const unwatch = dependencies.map(key => watchWidget(group.fields.get(key)?.widget,
        () => key === 'template' ? void refresh() : updateControls()));
    void refresh();
    return {
        refresh,
        sync() { if (!same(observedTemplate, templateIdentity())) void refresh(); else updateControls(); },
        dispose() {
            disposed = true; sequence++;
            for (const release of unwatch) release();
            for (const [widget, before] of disabledBefore) {
                widget.disabled = before.value;
                if (before.option === undefined) delete widget.options.disabled;
                else widget.options.disabled = before.option;
            }
        },
    };
}

let spec, dispose;
function bindActiveGraph() {
    dispose?.();
    if (!spec) return;
    dispose = installNativeSettings(app.rootGraph ?? app.graph, {
        bindSettings: (node, group) => bindSettings(node, group, spec),
        subscribeRefresh: callback => onCatalogChange(profile => { if (!profile || profile === 'smart') callback(); }),
    });
}
app.registerExtension({
    name: 'SML2.NativeSettings',
    beforeRegisterNodeDef(nodeType, data) {
        if (data.name !== NATIVE_NODE_ID) return;
        spec = data.input.required.template[1].nativeSettingsSpec;
        const configure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info, ...args) {
            return configureNativeSettings(this, info, configure, ...args);
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== NATIVE_NODE_ID) return;
        node.addWidget('button', 'Refresh lists', null, () => {
            void catalog('smart', true).catch(error => showSmartModelLoaderToast('Could not refresh native settings', error, 'warn'));
        }, { serialize: false });
    },
    setup: bindActiveGraph,
    afterConfigureGraph: bindActiveGraph,
});
