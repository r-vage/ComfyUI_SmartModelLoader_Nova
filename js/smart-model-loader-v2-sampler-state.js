import { SeedState, canonical, clone } from './smart-model-loader-v2-state.js';

export function parseSamplerConfiguration(raw) {
    const value = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
    if (value?.version !== 1 || typeof value.usePipe !== 'boolean' || typeof value.preview !== 'boolean'
        || !value.sampler || !value.seed || !value.decode || typeof value.decode.tiled !== 'boolean') {
        throw Error('Unsupported KSampler configuration.');
    }
    if (!Object.hasOwn(value.decode, 'alpha')) value.decode.alpha = false;
    if (typeof value.decode.alpha !== 'boolean') throw Error('Alpha must be enabled or disabled.');
    for (const key of Object.keys(value)) {
        if (!['version', 'usePipe', 'preview', 'sampler', 'seed', 'decode'].includes(key)) {
            throw Error(`KSampler Pipe does not support ${key}.`);
        }
    }
    return value;
}

export class SamplerState extends SeedState {
    constructor(raw, spec, editor = {}) {
        super();
        this.spec = spec;
        this.config = parseSamplerConfiguration(raw);
        this.editor = clone(editor);
    }
    value() { return canonical(this.config); }
    toggle(key) {
        if (['tiled', 'alpha'].includes(key)) this.config.decode[key] = !this.config.decode[key];
        else if (['usePipe', 'preview'].includes(key)) this.config[key] = !this.config[key];
        else throw Error(`Unknown sampler option ${key}.`);
    }
}
