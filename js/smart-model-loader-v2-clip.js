import { canonical, clone } from './smart-model-loader-v2-state.js';
import { LoaderForm, element, button } from './smart-model-loader-v2-ui.js';

export class ClipState {
    constructor(raw, spec, editor = {}) {
        this.spec = spec;
        this.config = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
        if (this.config?.version !== 1 || !this.config.clip || !Array.isArray(this.config.clip.encoders)
            || !['off', 'verify', 'sidecar'].includes(this.config.integrity)) throw Error('Unsupported CLIP configuration.');
        for (const key of Object.keys(this.config)) {
            if (!['version', 'clip', 'integrity'].includes(key)) throw Error(`CLIP Loader does not support ${key}.`);
        }
        const rows = this.config.clip.encoders;
        if (!rows.length) throw Error('CLIP requires at least one encoder.');
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('Encoder rows must have unique IDs.');
        this.editor = clone(editor);
        this.editor.open ??= null;
        this.editor.pinned ??= [];
        this.editor.resourceDetails ??= {};
    }
    value() { return canonical(this.config); }
    addEncoder() {
        this.config.clip.encoders.push({ id: crypto.randomUUID(), resource: { name: '' } });
    }
    removeEncoder(id) {
        if (this.config.clip.encoders.length === 1) return;
        this.config.clip.encoders = this.config.clip.encoders.filter(row => row.id !== id);
        delete this.editor.resourceDetails[id];
    }
    moveEncoder(id, direction) {
        const rows = this.config.clip.encoders, index = rows.findIndex(row => row.id === id), next = index + direction;
        if (index < 0 || next < 0 || next >= rows.length) return;
        [rows[index], rows[next]] = [rows[next], rows[index]];
    }
}

export class ClipForm extends LoaderForm {
    build(content) {
        const controls = element('div', 'sml-v2-clip-controls'); content.append(controls);
        const types = this.spec.clipTypes.map(value => ({ value, label: value }));
        if (!this.spec.clipTypes.includes(this.config.clip.type)) {
            types.push({ value: this.config.clip.type, label: `${this.config.clip.type} (unavailable)` });
        }
        this.dropdown.field(controls, {
            name: 'Encoder type', key: 'clip.type', value: this.config.clip.type, choices: types,
            onChange: type => this.edit(state => { state.config.clip.type = type; }),
        });
        controls.append(button('↻', () => this.reset(), 'Reset loader to defaults'));
        const rows = element('div', 'sml-v2-rows'); content.append(rows);
        for (const [index, row] of this.config.clip.encoders.entries()) {
            const { box, actions } = this.resourceRow(rows, row, 'clip', `Encoder ${index + 1}`,
                element('span', 'sml-v2-slot', String(index + 1)));
            if (!this.spec.ggufAvailable && row.resource.name.toLowerCase().endsWith('.gguf')) {
                box.append(element('div', 'sml-v2-note sml-v2-error', 'GGUF text encoder support is not installed.'));
            }
            const up = button('↑', () => this.edit(state => state.moveEncoder(row.id, -1)), 'Move encoder up');
            const down = button('↓', () => this.edit(state => state.moveEncoder(row.id, 1)), 'Move encoder down');
            up.disabled = index === 0; down.disabled = index === this.config.clip.encoders.length - 1;
            const order = element('div', 'sml-v2-row-order'); order.append(up, down); actions.prepend(order);
            const remove = button('×', () => this.edit(state => state.removeEncoder(row.id)), 'Remove encoder');
            remove.className = 'sml-v2-row-remove'; remove.disabled = this.config.clip.encoders.length === 1;
            actions.append(remove);
        }
        const add = button('+ Encoder', () => this.edit(state => state.addEncoder()));
        add.className = 'sml-v2-add';
        content.append(add);
        this.section(content, 'advanced', 'Advanced',
            this.config.integrity === 'off' ? 'Local integrity off' : this.config.integrity === 'verify' ? 'Verify files' : 'Record hashes',
            body => this.localIntegrity(body));
    }
}
