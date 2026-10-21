import { canonical, clone } from './smart-model-loader-v2-state.js';
import { LoaderForm, element, button } from './smart-model-loader-v2-ui.js';

export class LoraState {
    constructor(raw, spec, editor = {}) {
        this.spec = spec;
        this.config = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
        if (this.config?.version !== 1 || !Array.isArray(this.config.entries)
            || this.config.entries.length > spec.maxLoras
            || !Object.hasOwn(spec.modes, this.config.mode)
            || !['off', 'verify', 'sidecar'].includes(this.config.integrity)) throw Error('Unsupported LoRA configuration.');
        if (Object.keys(this.config).some(key => !['version', 'mode', 'entries', 'integrity'].includes(key))) {
            throw Error('Unsupported LoRA configuration fields.');
        }
        const ids = this.config.entries.map(row => row.id);
        if (new Set(ids).size !== ids.length) throw Error('LoRA rows must have unique IDs.');
        for (const row of this.config.entries) {
            if (!row.resource || typeof row.resource.name !== 'string' || typeof row.enabled !== 'boolean'
                || ['strength', 'clipStrength', 'audioStrength'].some(key => !Number.isFinite(row[key]))) {
                throw Error('Invalid LoRA row.');
            }
        }
        this.editor = clone(editor);
        this.editor.open ??= null; this.editor.pinned ??= []; this.editor.resourceDetails ??= {};
    }
    value() { return canonical(this.config); }
    preset() { return { version: 1, mode: this.config.mode, entries: clone(this.config.entries) }; }
    withPreset(value, name = '') {
        return new LoraState({ ...clone(value), integrity: this.config.integrity }, this.spec,
            { ...this.editor, presetName: name, resourceDetails: {} });
    }
    addLora() {
        if (this.config.entries.length >= this.spec.maxLoras) return;
        this.config.entries.push({ id: crypto.randomUUID(), resource: { name: '' }, enabled: true,
            strength: 1, clipStrength: 1, audioStrength: 1 });
    }
    removeLora(id) {
        this.config.entries = this.config.entries.filter(row => row.id !== id);
        delete this.editor.resourceDetails[id];
    }
    moveLora(id, direction) {
        const rows = this.config.entries, index = rows.findIndex(row => row.id === id), next = index + direction;
        if (index < 0 || next < 0 || next >= rows.length) return;
        [rows[index], rows[next]] = [rows[next], rows[index]];
    }
    setMode(mode) {
        if (!Object.hasOwn(this.spec.modes, mode)) throw Error('Unsupported LoRA mode.');
        this.config.mode = mode;
    }
}

export class LoraForm extends LoaderForm {
    build(content) {
        this.toolbar(content);
        const mode = this.bar('Mode:', Object.entries(this.spec.modes), this.config.mode,
            value => this.edit(state => state.setMode(value)), true,
            { key: 'loraMode', summary: this.spec.modes[this.config.mode] });
        mode.className = 'sml-v2-bar sml-v2-options-bar sml-v2-lora-mode';
        content.append(mode);
        const rows = this.config.entries;
        const list = element('div', 'sml-v2-rows'); content.append(list);
        for (const [index, row] of rows.entries()) {
            const toggle = button(row.enabled ? '✓' : '×', () => this.edit(() => { row.enabled = !row.enabled; }), 'Enable LoRA');
            toggle.className = 'sml-v2-row-toggle'; toggle.dataset.field = `${row.id}.enabled`;
            toggle.setAttribute('aria-pressed', String(row.enabled));
            const { box, main, actions } = this.resourceRow(list, row, 'loras', `LoRA ${index + 1}`, toggle);
            box.dataset.enabled = String(row.enabled);
            const up = button('↑', () => this.edit(state => state.moveLora(row.id, -1)), 'Move LoRA up');
            const down = button('↓', () => this.edit(state => state.moveLora(row.id, 1)), 'Move LoRA down');
            up.disabled = index === 0; down.disabled = index === rows.length - 1;
            const order = element('div', 'sml-v2-row-order'); order.append(up, down); actions.prepend(order);
            const remove = button('×', () => this.edit(state => state.removeLora(row.id)), 'Remove LoRA');
            remove.className = 'sml-v2-row-remove'; actions.append(remove);
            const fields = [['strength', this.config.mode === 'audio' ? 'Video strength' : 'Model strength', 'STR']];
            if (this.config.mode === 'clip') fields.push(['clipStrength', 'CLIP strength', 'CLIP STR']);
            if (this.config.mode === 'audio') fields.push(['audioStrength', 'Audio strength', 'AUDIO STR']);
            for (const [key, label, caption] of fields) {
                const field = element('div', 'sml-v2-strength sml-v2-lora-strength'); main.insertBefore(field, actions);
                const input = this.input(field, `${row.id}.${key}`, label, row[key], value => { row[key] = value; },
                    { type: 'number', min: -100, max: 100, step: 0.1 });
                input.parentElement.firstElementChild.textContent = caption;
                input.title = `${label}; set to 0 to skip this target`;
            }
        }
        const footer = element('div', 'sml-v2-lora-footer');
        const add = button('+ LoRA', () => this.edit(state => state.addLora())); add.className = 'sml-v2-add';
        add.disabled = rows.length >= this.spec.maxLoras;
        footer.append(add, element('span', 'sml-v2-note', `${rows.length} / ${this.spec.maxLoras} rows`)); content.append(footer);
        this.section(content, 'advanced', 'Advanced',
            this.config.integrity === 'off' ? 'Local integrity off' : this.config.integrity === 'verify' ? 'Verify files' : 'Record hashes',
            body => this.localIntegrity(body));
    }
}
