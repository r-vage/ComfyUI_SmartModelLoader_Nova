// Session-local return targets. Presets and persisted download jobs own no UI identity.
import { canonical, clone } from './smart-model-loader-v2-state.js';

const catalogListeners = new Set();
export const onDownloadCatalogChange = callback => {
    catalogListeners.add(callback);
    return () => catalogListeners.delete(callback);
};

export function locateResource(state, key, role) {
    const config = state.config;
    if (key === 'model') return config.model?.resource;
    if (key === 'vae' || key === 'audioVae') return config[key]?.resource;
    if (role === 'clip') return config.clip?.encoders?.find(row => row.id === key)?.resource;
    if (role === 'loras') return (config.entries ?? config.loras?.entries)?.find(row => row.id === key)?.resource
        ?? state.editor.disabledLoras?.[key]?.resource;
}

function context(state, role) {
    return canonical([state.config.model?.kind ?? null,
        role === 'clip' ? [state.config.clip?.source ?? null, state.config.clip?.type] : null]);
}

export function captureDownloadTarget(controller, { key, role, resource }) {
    const { node, state } = controller, graph = node.graph, nodeId = node.id;
    if (!graph || locateResource(state, key, role) !== resource) throw Error('The download field is no longer available.');
    const snapshot = canonical(resource), mode = context(state, role);
    const targets = controller.downloadTargets ??= new Set();
    for (const previous of targets) if (previous.key === key && previous.role === role) previous.release();
    let valid = true;
    const type = role === 'clip' ? 'CLIP' : role === 'loras' ? 'LoRA'
        : key === 'audioVae' ? 'Audio VAE' : key === 'vae' ? 'VAE' : 'Model';
    const rows = role === 'clip' ? state.config.clip.encoders
        : state.config.entries ?? state.rows?.().map(item => item.row) ?? state.config.loras?.entries ?? [];
    const ordinal = ['clip', 'loras'].includes(role) ? ` ${rows.findIndex(row => row.id === key) + 1}` : '';
    const target = {
        key, role, nodeId, type, bound: false,
        label: `${node.title || node.type} #${nodeId} → ${type}${ordinal}`,
        current() {
            const current = valid && !controller.disposed && !controller.invalid && node.graph === graph
                && node.id === nodeId && graph.getNodeById(nodeId) === node
                && locateResource(controller.state, key, role) === resource
                && canonical(resource) === snapshot && context(controller.state, role) === mode;
            if (!current) this.release();
            return current;
        },
        release() {
            if (!valid) return;
            valid = false; targets.delete(this); this.onRelease?.();
        },
        accepts(category) {
            return (role === 'clip' ? ['clip', 'text_encoders']
                : role === 'diffusion_models_gguf' ? ['diffusion_models'] : [role]).includes(category);
        },
        apply(value) {
            if (!this.current()) return false;
            this.release();
            controller.edit(() => {
                for (const field of Object.keys(resource)) delete resource[field];
                Object.assign(resource, clone(value));
            });
            controller.form.status(`${type} updated from verified download.`);
            return true;
        },
        error(message) { if (this.current()) controller.form.status(message, true); },
    };
    targets.add(target);
    return target;
}

export class DownloadReturns {
    constructor(resolve) {
        this.resolve = resolve;
        this.bindings = new Map();
        this.completions = new Map();
        this.refreshPending = false;
    }
    bind(job, target) {
        if (!target?.current()) return;
        target.bound = true;
        this.bindings.set(job.uuid, { target, pending: false });
        target.onRelease = () => this.bindings.delete(job.uuid);
        this.observe(job);
    }
    observe(job) {
        if (!job?.uuid) return;
        if (job.state === 'completed') {
            const completion = `${job.completed_at}:${job.local_sha256}:${job.provider_verified}`;
            if (this.completions.get(job.uuid) !== completion) {
                this.completions.set(job.uuid, completion);
                // Bound memory for long-lived tabs; queue history is server-owned.
                if (this.completions.size > 2048) this.completions.delete(this.completions.keys().next().value);
                if (!this.refreshPending) {
                    this.refreshPending = true;
                    queueMicrotask(() => {
                        this.refreshPending = false;
                        for (const callback of catalogListeners) callback();
                    });
                }
            }
        }
        for (const [id, binding] of this.bindings) if (!binding.target.current()) this.bindings.delete(id);
        const binding = this.bindings.get(job.uuid);
        if (!binding || binding.pending || job.state !== 'completed') return;
        if (job.provider_verified !== true) {
            binding.target.error('The downloaded file was not verified; the loader field was kept.');
            binding.target.release(); this.bindings.delete(job.uuid); return;
        }
        binding.pending = true;
        return this.resolve(job.uuid, binding.target.role).then(result => {
            binding.target.apply(result.resource);
            binding.target.release(); this.bindings.delete(job.uuid);
        }).catch(error => {
            binding.pending = false;
            binding.target.error(`Could not fill the download field: ${error.message}`);
        });
    }
    reconcile(jobs) {
        const ids = new Set(jobs.map(job => job.uuid));
        for (const [id, binding] of this.bindings) if (!ids.has(id)) {
            binding.target.release(); this.bindings.delete(id);
        }
        return Promise.all(jobs.map(job => this.observe(job)));
    }
}
