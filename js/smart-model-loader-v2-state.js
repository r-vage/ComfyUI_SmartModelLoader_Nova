// Pure state for the new loader. Only active execution values enter configuration.
import { aspectFor, readSizing, resolveDimensions } from './smart-model-loader-v2-sizing.js';

export const NODE_ID = 'Smart Model Loader [SML2]';
export const SAMPLER_NODE_ID = 'KSampler Pipe [SML2]';
export const NODE_IDS = new Set([NODE_ID, SAMPLER_NODE_ID, 'CLIP Loader [SML2]', 'LoRA Stack [SML2]']);
export const WIDGET_TYPE = 'SML2_LOADER_CONFIGURATION';
export const EDITOR_KEY = 'smartModelLoaderV2';
export const MAX_SEED = (1n << 64n) - 1n;
export const clone = value => JSON.parse(JSON.stringify(value));
export const defaults = fields => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, clone(field.default)]));
const SEED_SHORTCUTS = { '-1': 'random', '-2': 'increment', '-3': 'decrement' };
const NODE_LOCAL_FIELDS = ['memory', 'integrity', 'seed', 'latent'];
const randomSeed = () => crypto.getRandomValues(new BigUint64Array(1))[0];
const validSeed = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX_SEED;

export function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function parseConfiguration(raw) {
    const value = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
    if (value?.version !== 1 || !value.model || !value.memory) throw Error('Unsupported loader configuration. Expected version 1.');
    return value;
}

export function supportsFlux(config) {
    return config.model.kind === 'nunchaku-flux' || (['unet', 'gguf'].includes(config.model.kind)
        && ['flux', 'flux2'].includes(config.clip?.type));
}

export class SeedState {
    seedInput() {
        const seed = this.config.seed;
        return Object.keys(SEED_SHORTCUTS).find(key => SEED_SHORTCUTS[key] === seed.policy) ?? seed.value;
    }
    setSeedInput(input, random = randomSeed) {
        const seed = this.config.seed;
        const policy = Object.hasOwn(SEED_SHORTCUTS, input) ? SEED_SHORTCUTS[input] : 'fixed';
        if (policy === 'fixed') this.config.seed = { value: input, policy };
        else if (seed.policy !== policy) {
            let value = validSeed(seed.value) ? seed.value : '0';
            if (policy !== 'random') value = validSeed(this.editor.lastSeed)
                ? seedAfterAcceptance({ value: this.editor.lastSeed, policy }).value : random().toString();
            this.config.seed = { value, policy };
        }
    }
    get canUseLastSeed() {
        return validSeed(this.editor.lastSeed) && (this.config.seed?.policy !== 'fixed'
            || this.config.seed?.value !== this.editor.lastSeed);
    }
    useLastSeed() {
        if (this.canUseLastSeed) this.config.seed = { value: this.editor.lastSeed, policy: 'fixed' };
    }
    createFixedSeed(random = randomSeed) {
        this.config.seed = { value: random().toString(), policy: 'fixed' };
    }
    get seedStepBase() {
        // Random mode displays a shortcut. Step from its last concrete result
        // when available; other modes already store their next concrete seed.
        return this.config.seed?.policy === 'random' && validSeed(this.editor.lastSeed)
            ? this.editor.lastSeed : this.config.seed?.value;
    }
    canStepSeed(delta) {
        if (![1, -1].includes(delta) || !validSeed(this.seedStepBase)) return false;
        const next = BigInt(this.seedStepBase) + BigInt(delta);
        return next >= 0n && next <= MAX_SEED;
    }
    stepSeed(delta) {
        if (this.canStepSeed(delta)) {
            this.config.seed = { value: (BigInt(this.seedStepBase) + BigInt(delta)).toString(), policy: 'fixed' };
        }
    }
}

export class LoaderState extends SeedState {
    constructor(value, spec, editor = {}) {
        super();
        this.spec = spec;
        this.config = parseConfiguration(value);
        for (const key of Object.keys(this.config)) {
            if (!['version', 'model', 'memory', 'integrity'].includes(key) && !Object.hasOwn(spec.features, key)) {
                throw Error(`This loader does not support ${key}.`);
            }
        }
        if (!Object.hasOwn(spec.modes, this.config.model.kind)) throw Error('Unsupported model mode.');
        for (const key of ['clip', 'vae', 'audioVae']) {
            if (this.config[key] && !this.sourcesFor(key).includes(this.config[key].source)) {
                throw Error(`This model mode does not support ${key} source “${this.config[key].source}”.`);
            }
        }
        this.editor = clone(editor);
        for (const key of ['disabled', 'modes', 'methods', 'sources', 'disabledLoras']) this.editor[key] ??= {};
        if (this.editor.open === undefined) this.editor.open = 'clip';
        this.editor.pinned ??= [];
        this.editor.loraOrder ??= this.config.loras?.entries.map(entry => entry.id) ?? [];
        this.reconcileBlockSwap();
    }
    value() { return canonical(this.config); }
    sourcesFor(key) { return this.spec.componentSources[this.config.model.kind][key]; }
    get features() {
        return Object.fromEntries(Object.entries(this.spec.features)
            .filter(([key]) => !['clip', 'vae', 'audioVae'].includes(key) || this.sourcesFor(key).length));
    }
    get denoise() {
        return this.config.sampler?.denoise ?? this.editor.disabled.sampler?.denoise
            ?? this.editor.denoise ?? this.spec.sampler.denoise.default;
    }
    preset() {
        const value = clone(this.config);
        for (const key of NODE_LOCAL_FIELDS) delete value[key];
        if (value.sampler) delete value.sampler.denoise;
        return value;
    }
    withPreset(value, name = '') {
        const config = clone(value);
        if (config.sampler) config.sampler.denoise = this.denoise;
        for (const key of NODE_LOCAL_FIELDS) {
            if (Object.hasOwn(this.config, key)) config[key] = clone(this.config[key]);
            else delete config[key];
        }
        // Presets replace settings, while existing visible sections keep their
        // disclosure state. A newly included section must start collapsed.
        const remainsVisible = key => ['modelOptions', 'advanced'].includes(key) || (this.config[key] && config[key]);
        // Keep denoise even when the preset removes Sampler and its disabled draft.
        const editor = { disabled: {}, denoise: this.denoise, presetName: name,
            open: remainsVisible(this.editor.open) ? this.editor.open : null,
            pinned: this.editor.pinned.filter(remainsVisible) };
        for (const key of ['collapsedBars', 'blockSwap', 'lastSeed', 'latentSizing', 'samplingDimensions']) {
            if (Object.hasOwn(this.editor, key)) editor[key] = clone(this.editor[key]);
        }
        for (const key of NODE_LOCAL_FIELDS) {
            if (this.editor.disabled[key]) editor.disabled[key] = clone(this.editor.disabled[key]);
        }
        // A preset saved with Latent enabled has no independent sampling size.
        // Use this node's existing size (or the default) when Latent is disabled.
        if (this.config.modelSampling?.dimensions) editor.samplingDimensions = clone(this.config.modelSampling.dimensions);
        const next = new LoaderState(config, this.spec, editor);
        next.dependencies();
        return next;
    }
    get canBlockSwap() { return !this.spec.dynamicVram && !this.config.model.kind.startsWith('nunchaku-'); }
    reconcileBlockSwap() {
        if (!this.canBlockSwap && this.config.memory.blockSwap) {
            this.editor.blockSwap = this.config.memory.blockSwap;
            delete this.config.memory.blockSwap;
        }
    }
    freshSection(key) {
        const embedded = ['checkpoint', 'unet'].includes(this.config.model.kind);
        switch (key) {
            case 'clip': return this.sourcesFor('clip')[0] === 'baked' ? { source: 'baked', skip: -2 }
                : { source: this.sourcesFor('clip')[0], type: this.spec.clipTypes.includes('flux') ? 'flux' : this.spec.clipTypes[0],
                    skip: null, encoders: [this.newRow()] };
            case 'vae': return embedded ? { source: 'baked' } : { source: 'external', resource: { name: '' } };
            case 'audioVae': return { source: 'external', resource: { name: '' } };
            case 'loras': return { entries: [] };
            case 'latent': return { ...defaults(this.spec.latent), sizing: clone(this.spec.latentSizing.default) };
            case 'sampler': return { ...defaults(this.spec.sampler), denoise: this.denoise, sampler_name: this.spec.samplers[0],
                scheduler: this.spec.schedulers[0], ...(supportsFlux(this.config) ? { flux_guidance: 3.5 } : {}) };
            case 'modelSampling': return { method: 'None', parameters: {} };
            case 'seed': return { value: '0', policy: 'fixed' };
            default: throw Error(`Unknown section ${key}`);
        }
    }
    newRow(lora = false) {
        return { id: crypto.randomUUID(), resource: { name: '' }, ...(lora ? { strength: 1 } : {}) };
    }
    changeLatent(patch, dimensions = {}) {
        const latent = this.config.latent, previous = readSizing(latent);
        const drafts = this.editor.latentSizing ??= {};
        let sizing = previous;
        if (patch.mode && patch.mode !== previous.mode) {
            drafts[previous.mode] = { sizing: clone(previous), width: latent.width, height: latent.height };
            const draft = drafts[patch.mode];
            sizing = draft?.sizing ? clone(draft.sizing) : {
                mode: patch.mode,
                ...(patch.mode === 'fixed' ? {} : previous.mode === 'fixed' ? aspectFor(latent, this.spec)
                    : { aspect: previous.aspect, ...(previous.aspect === 'custom'
                        ? { ratioWidth: previous.ratioWidth, ratioHeight: previous.ratioHeight } : {}) }),
                ...(patch.mode === 'preset' ? { resolution: 'square-1024' } : {}),
                ...(patch.mode === 'megapixels' ? { megapixels: 1 } : {}),
            };
            sizing.divisor = previous.divisor;
            if (patch.mode === 'fixed' && draft) {
                latent.width = draft.width; latent.height = draft.height;
            }
        }
        Object.assign(sizing, patch);
        if (sizing.mode !== 'fixed' && sizing.aspect === 'custom') {
            if (previous.aspect !== 'custom') {
                const [width, height] = this.spec.latentSizing.aspects[previous.aspect] ?? [1, 1];
                sizing.ratioWidth ??= drafts.ratio?.width ?? width;
                sizing.ratioHeight ??= drafts.ratio?.height ?? height;
            }
            drafts.ratio = { width: sizing.ratioWidth, height: sizing.ratioHeight };
        } else {
            delete sizing.ratioWidth; delete sizing.ratioHeight;
        }
        latent.sizing = sizing;
        Object.assign(latent, dimensions);
        try { Object.assign(latent, resolveDimensions(latent, this.spec)); }
        catch { /* Keep invalid edits in configuration so validation blocks execution. */ }
    }
    toggle(key) {
        if (!Object.hasOwn(this.features, key)) throw Error(`This model mode does not support ${key}.`);
        if (this.config[key]) {
            this.editor.disabled[key] = this.config[key];
            delete this.config[key];
        } else {
            this.config[key] = this.editor.disabled[key] ?? this.freshSection(key);
            delete this.editor.disabled[key];
            this.editor.open = key;
        }
        this.dependencies();
    }
    mode(kind) {
        if (!this.spec.modes[kind]) throw Error('Unknown model mode');
        if (kind === this.config.model.kind) return;
        this.editor.modes[this.config.model.kind] = this.config.model;
        this.config.model = this.editor.modes[kind] ?? { kind, resource: { name: '' },
            options: defaults(this.spec.modes[kind].options), attentionBackend: this.spec.attention[0] };
        delete this.editor.modes[kind];
        this.dependencies();
    }
    source(key, source) {
        if (!this.sourcesFor(key).includes(source)) throw Error(`Unsupported ${key} source.`);
        const current = this.config[key];
        const drafts = this.editor.sources[key] ??= {};
        drafts[current.source] = current;
        this.config[key] = drafts[source] ?? (key === 'clip'
            ? { source, skip: current.skip,
                ...(source === 'baked' ? {} : {
                type: source === 'combined' ? 'ltxv' : (this.spec.clipTypes.includes('flux') ? 'flux' : this.spec.clipTypes[0]),
                encoders: [this.newRow()],
            }) }
            : { source, ...(source === 'external' ? { resource: { name: '' } } : {}) });
        delete drafts[source];
        this.dependencies();
    }
    method(method) {
        const current = this.config.modelSampling;
        this.editor.methods[current.method] = current;
        this.config.modelSampling = this.editor.methods[method] ?? { method, parameters: defaults(this.spec.sampling[method]) };
        delete this.editor.methods[method];
        this.dependencies();
    }
    dependencies() {
        if (!['checkpoint', 'unet'].includes(this.config.model.kind)) {
            for (const key of ['clip', 'vae', 'audioVae']) {
                if (['baked', 'combined'].includes(this.config[key]?.source)) this.source(key, 'external');
            }
        }
        this.reconcileBlockSwap();
        if (this.config.sampler) {
            if (supportsFlux(this.config)) this.config.sampler.flux_guidance ??= this.editor.fluxGuidance ?? 3.5;
            else if ('flux_guidance' in this.config.sampler) {
                this.editor.fluxGuidance = this.config.sampler.flux_guidance;
                delete this.config.sampler.flux_guidance;
            }
        }
        const sampling = this.config.modelSampling;
        if (sampling && ['Flux', 'Qwen Image 2.1'].includes(sampling.method)) {
            if (this.config.latent) {
                if (sampling.dimensions) this.editor.samplingDimensions = sampling.dimensions;
                delete sampling.dimensions;
            } else sampling.dimensions ??= clone(this.editor.samplingDimensions ?? defaults(this.spec.dimensions));
        }
    }
    rows() {
        const enabled = this.config.loras?.entries ?? [];
        const byId = new Map(enabled.map(row => [row.id, row]));
        const order = this.editor.loraOrder;
        for (const row of enabled) if (!order.includes(row.id)) order.push(row.id);
        return order.map(id => ({ row: byId.get(id) ?? this.editor.disabledLoras[id], enabled: byId.has(id) }))
            .filter(item => item.row);
    }
    toggleLora(id) {
        const entries = this.config.loras.entries;
        const index = entries.findIndex(row => row.id === id);
        if (index >= 0) this.editor.disabledLoras[id] = entries.splice(index, 1)[0];
        else {
            entries.push(this.editor.disabledLoras[id]);
            delete this.editor.disabledLoras[id];
        }
        this.sortLoras();
    }
    sortLoras() { this.config.loras.entries.sort((a, b) => this.editor.loraOrder.indexOf(a.id) - this.editor.loraOrder.indexOf(b.id)); }
    addLora() {
        if (this.rows().length >= this.spec.maxLoras) return;
        const row = this.newRow(true);
        this.config.loras.entries.push(row);
        this.editor.loraOrder.push(row.id);
    }
    removeLora(id) {
        this.config.loras.entries = this.config.loras.entries.filter(row => row.id !== id);
        delete this.editor.disabledLoras[id];
        this.editor.loraOrder = this.editor.loraOrder.filter(value => value !== id);
    }
    moveLora(id, delta) {
        const order = this.editor.loraOrder;
        const index = order.indexOf(id);
        const next = index + delta;
        if (index < 0 || next < 0 || next >= order.length) return;
        [order[index], order[next]] = [order[next], order[index]];
        this.sortLoras();
    }
}

// Queue snapshots are concrete. Saving or previewing a graph never consumes a seed.
export function queuedConfiguration(raw, random = randomSeed, parse = parseConfiguration) {
    const config = parse(raw);
    if (config.seed && (!validSeed(config.seed.value) || !['fixed', 'random', 'increment', 'decrement'].includes(config.seed.policy))) {
        throw Error('Seed must be an unsigned 64-bit decimal value with a supported queue policy.');
    }
    if (config.seed?.policy === 'random') config.seed.value = random().toString();
    return config;
}

export function seedAfterAcceptance(seed) {
    let value = BigInt(seed.value);
    if (seed.policy === 'increment') value = (value + 1n) & MAX_SEED;
    if (seed.policy === 'decrement') value = (value - 1n) & MAX_SEED;
    return { ...seed, value: value.toString() };
}
