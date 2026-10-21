// A single semantic DOM form, shared by classic canvas and Nodes 2.0.
import { defaults, supportsFlux } from './smart-model-loader-v2-state.js';
import { GroupedDropdown } from './smart-model-loader-v2-dropdown.js';
import { dimensionAspect, latentError, readSizing } from './smart-model-loader-v2-sizing.js';
import { locateResource } from './smart-model-loader-v2-downloads.js';

export const element = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
};
export const button = (text, action, title = text) => {
    const node = element('button', '', text);
    node.type = 'button'; node.title = title; node.onclick = action;
    if (title !== text) node.setAttribute('aria-label', title);
    return node;
};
const basename = name => name?.split('/').at(-1) || 'Select local file…';

export class LoaderForm {
    constructor({ root, getState, edit, catalog, refresh, reset, loadPreset, savePreset, deletePreset, openDownloads, readModelMetadata, renameModel, changed }) {
        Object.assign(this, { root, getState, edit, catalog, refresh, reset, loadPreset, savePreset, deletePreset, openDownloads, readModelMetadata, renameModel, changed });
        this.dialog = null;
        this.message = '';
        this.resourceSelections = new Map();
        this.dropdown = new GroupedDropdown(root);
    }
    get state() { return this.getState(); }
    get config() { return this.state.config; }
    get spec() { return this.state.spec; }
    status(message, error = false) {
        this.message = message; this.failed = error;
        if (this.statusNode) { this.statusNode.textContent = message; this.statusNode.classList.toggle('sml-v2-error', error); }
        this.changed();
    }
    async action(fn) {
        try { await fn(); } catch (error) { if (!this.disposed) this.status(error.message, true); }
    }
    render() {
        if (this.disposed) return;
        const active = this.root.contains(document.activeElement) ? document.activeElement : null;
        const focus = active && { key: active.dataset.field, start: active.selectionStart, end: active.selectionEnd };
        this.dropdown.close(false);
        const content = element('div', 'sml-v2-content');
        this.build(content);
        this.statusNode = element('div', `sml-v2-note sml-v2-status${this.failed ? ' sml-v2-error' : ''}`, this.message);
        this.statusNode.setAttribute('role', 'status');
        content.append(this.statusNode);
        this.root.replaceChildren(content);
        if (focus?.key) {
            const replacement = [...this.root.querySelectorAll('[data-field]')].find(node => node.dataset.field === focus.key);
            replacement?.focus({ preventScroll: true });
            if (focus.start != null && replacement?.setSelectionRange && replacement.type !== 'number') {
                replacement.setSelectionRange(focus.start, focus.end);
            }
        }
        this.changed();
    }
    build(content) {
        this.toolbar(content);
        const mode = this.bar('Model Mode:', Object.entries(this.spec.modes).map(([value, data]) => [value, data.label]),
            this.config.model.kind, value => this.edit(state => state.mode(value)), true,
            { key: 'modelMode', summary: this.spec.modes[this.config.model.kind].label });
        mode.className = 'sml-v2-bar sml-v2-options-bar sml-v2-modes';
        content.append(mode);
        const features = Object.entries(this.state.features);
        const included = features.filter(([key]) => this.config[key]).map(([, label]) => label);
        const { bar: include, expanded } = this.optionBar('include', 'Include', included.join(' · ') || 'None');
        include.className = 'sml-v2-bar sml-v2-options-bar sml-v2-include';
        include.setAttribute('role', 'group'); include.setAttribute('aria-label', 'Include');
        if (expanded) for (const [key, label] of features) {
            const toggle = button(label, () => this.edit(state => state.toggle(key)));
            toggle.dataset.field = `include:${key}`;
            toggle.setAttribute('aria-pressed', String(!!this.config[key]));
            include.append(toggle);
        }
        content.append(include);
        const model = element('div', 'sml-v2-model');
        content.append(model);
        const kind = this.config.model.kind;
        if (!this.spec.available[kind]) model.append(element('div', 'sml-v2-note sml-v2-error',
            `${this.spec.modes[kind].label} backend is not installed.`));
        this.resource(model, 'model', this.config.model.resource, this.spec.modes[kind].role, 'Model');
        this.section(model, 'modelOptions', 'Model options', this.config.model.attentionBackend, body => {
            this.fields(body, 'model.options', this.config.model.options, this.spec.modes[kind].options);
            this.select(body, 'model.attentionBackend', 'Model attention', this.config.model.attentionBackend,
                this.spec.attention, value => { this.config.model.attentionBackend = value; });
        });
        for (const [key, label] of features) {
            if (this.config[key]) this.section(content, key, label, this.summary(key), body => this.feature(body, key));
        }
        this.section(content, 'advanced', 'Advanced', this.config.memory.cleanup ? 'Cleanup enabled' : 'Cleanup off', body => this.advanced(body));
    }
    toolbar(parent) {
        const bar = element('div', 'sml-v2-toolbar');
        bar.append(element('span', '', 'Preset:'));
        const current = this.state.editor.presetName || 'Current configuration';
        const picker = button(current, () => this.presetDialog(), current);
        picker.className = 'sml-v2-picker'; picker.setAttribute('aria-label', 'Load preset');
        picker.dataset.field = 'preset'; picker.setAttribute('aria-haspopup', 'dialog');
        bar.append(picker, button('Save…', () => this.presetDialog(true)),
            button('↻', () => this.reset(), 'Reset loader to defaults'));
        parent.append(bar);
        this.presetConversionHint(parent);
    }
    presetConversionHint(parent) {
        if (this.spec.profile !== 'smart' || this.state.editor.presetNeedsConversion !== true) return;
        const note = element('div', 'sml-v2-note sml-v2-preset-conversion',
            'V1 template loaded. Choose Save… and check Overwrite existing preset to save it in the new format.');
        note.setAttribute('role', 'status'); parent.append(note);
    }
    optionBar(key, label, summary) {
        const collapsed = this.state.editor.collapsedBars?.[key] === true;
        const bar = element('div', 'sml-v2-bar');
        bar.dataset.collapsed = String(collapsed);
        const toggle = button('', () => this.edit(state => {
            state.editor.collapsedBars = { ...state.editor.collapsedBars, [key]: !collapsed };
        }), collapsed ? `Expand ${label}: ${summary}` : `Collapse ${label}`);
        toggle.className = 'sml-v2-bar-disclosure'; toggle.dataset.field = `bar:${key}`;
        toggle.setAttribute('aria-label', label); toggle.setAttribute('aria-expanded', String(!collapsed));
        const arrow = element('span', '', collapsed ? '▸' : '▾'); arrow.setAttribute('aria-hidden', 'true');
        toggle.append(arrow, element('span', 'sml-v2-bar-label', `${label}:`));
        if (collapsed) {
            const value = element('span', 'sml-v2-bar-summary', summary); value.title = summary;
            toggle.append(value);
        }
        bar.append(toggle);
        return { bar, expanded: !collapsed };
    }
    bar(label, options, value, onChange, radio = false, disclosure = null) {
        const { bar, expanded } = disclosure
            ? this.optionBar(disclosure.key, label.replace(/:$/, ''), disclosure.summary)
            : { bar: element('div', 'sml-v2-bar'), expanded: true };
        bar.setAttribute('role', radio ? 'radiogroup' : 'group'); bar.setAttribute('aria-label', label.replace(/:$/, ''));
        if (!disclosure) bar.append(element('span', '', label));
        if (!expanded) return bar;
        const buttons = options.map(([id, text]) => {
            const item = button(text, () => onChange(id));
            item.dataset.field = `${label}:${id}`;
            if (radio) { item.setAttribute('role', 'radio'); item.setAttribute('aria-checked', String(value === id)); item.tabIndex = value === id ? 0 : -1; }
            else item.setAttribute('aria-pressed', String(value === id));
            return item;
        });
        if (radio) bar.onkeydown = event => {
            const index = buttons.indexOf(event.target);
            if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next].click();
            this.root.querySelector(`[data-field="${label}:${options[next][0]}"]`)?.focus();
        };
        bar.append(...buttons); return bar;
    }
    section(parent, key, label, summary, build) {
        const section = element('section', 'sml-v2-section'); section.dataset.section = key;
        const head = element('div', 'sml-v2-heading');
        const open = this.state.editor.open === key || this.state.editor.pinned.includes(key);
        const toggle = button('', () => this.edit(state => {
            if (state.editor.pinned.includes(key)) state.editor.pinned = state.editor.pinned.filter(value => value !== key);
            state.editor.open = open ? null : key;
        }));
        toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', label);
        toggle.append(element('strong', '', `${open ? '▾' : '▸'} ${label}`), element('span', 'sml-v2-summary', summary));
        const pin = button('⌖', () => this.edit(state => {
            const index = state.editor.pinned.indexOf(key);
            if (index < 0) state.editor.pinned.push(key); else state.editor.pinned.splice(index, 1);
        }), `Pin ${label} open`);
        pin.setAttribute('aria-pressed', String(this.state.editor.pinned.includes(key)));
        head.append(toggle, pin); section.append(head);
        if (open) { const body = element('div'); build(body); section.append(body); }
        parent.append(section);
    }
    summary(key) {
        const value = this.config[key];
        if (['clip', 'vae', 'audioVae'].includes(key)) {
            return `${value.source}${value.skip ? ` · ${value.skip}` : ''}`;
        }
        if (key === 'loras') return `${value.entries.length} enabled`;
        if (key === 'latent') return latentError(value, this.spec) ? 'Invalid size' : `${value.width} × ${value.height} · ${value.batch_size}`;
        if (key === 'sampler') return `${value.sampler_name} · ${value.steps} steps`;
        if (key === 'modelSampling') return value.method;
        if (key === 'seed') return this.state.seedInput();
        return '';
    }
    input(parent, key, label, value, setter, options = {}) {
        const wrapper = element('label', 'sml-v2-field'); wrapper.append(element('span', '', label));
        const input = document.createElement('input');
        input.type = options.type ?? 'text'; input.dataset.field = key; input.setAttribute('aria-label', label);
        if (input.type === 'checkbox') input.checked = value; else input.value = value ?? '';
        for (const attr of ['min', 'max', 'step', 'inputMode', 'placeholder']) if (options[attr] != null) input[attr] = options[attr];
        input.oninput = () => this.edit(() => setter(input.type === 'checkbox' ? input.checked
            : input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value), false);
        // Replacing the form during a text/number blur would remove the button
        // the user is about to click. Those edits only need summary updates.
        input.onchange = () => {
            if (input.type === 'checkbox') this.render();
            else for (const section of this.root.querySelectorAll('[data-section]')) {
                if (this.config[section.dataset.section]) {
                    section.querySelector('.sml-v2-summary').textContent = this.summary(section.dataset.section);
                }
            }
        };
        wrapper.append(input); parent.append(wrapper); return input;
    }
    select(parent, key, label, value, values, setter) {
        const wrapper = element('label', 'sml-v2-field'); wrapper.append(element('span', '', label));
        const select = document.createElement('select'); select.dataset.field = key; select.setAttribute('aria-label', label);
        for (const option of values) select.append(new Option(option, option));
        if (!values.includes(value)) select.append(new Option(`${value} (unavailable)`, value));
        select.value = value;
        select.onchange = () => this.edit(() => { setter(select.value); this.state.dependencies?.(); });
        wrapper.append(select); parent.append(wrapper);
    }
    fields(parent, prefix, target, fields) {
        const grid = element('div', 'sml-v2-fields');
        for (const [key, field] of Object.entries(fields)) {
            const setter = value => { target[key] = value; };
            if (field.type === 'choice') this.select(grid, `${prefix}.${key}`, field.label, target[key], field.values, setter);
            else this.input(grid, `${prefix}.${key}`, field.label, target[key], setter, field.type === 'boolean'
                ? { type: 'checkbox' } : { type: 'number', min: field.min, max: field.max, step: field.step });
        }
        parent.append(grid);
    }
    resourcePicker(parent, key, resource, role, label, renameParent = null) {
        const field = element('div', 'sml-v2-file');
        const picker = button(basename(resource.name), () => this.picker(key, role, resource, label), resource.name || `Select ${label}`);
        picker.className = 'sml-v2-picker'; picker.dataset.field = key; picker.setAttribute('aria-label', `${label} file`);
        picker.dataset.empty = String(!resource.name);
        field.append(picker);
        if (resource.name) {
            const rename = button('✎', () => this.renameDialog(key, role, resource, label), `Rename ${label} file`);
            rename.className = 'sml-v2-file-rename'; rename.dataset.field = `${key}.rename`;
            rename.setAttribute('aria-haspopup', 'dialog'); (renameParent ?? field).append(rename);
        }
        parent.append(field); return picker;
    }
    resourceStatus(parent, resource, role) {
        if (resource.name && this.catalog().files && !(this.catalog().files[role] ?? []).includes(resource.name)) {
            parent.append(element('div', 'sml-v2-note sml-v2-error', 'Local file missing'));
        }
    }
    resource(parent, key, resource, role, label) {
        const field = element('div', 'sml-v2-field');
        field.append(element('span', '', label));
        this.resourcePicker(field, key, resource, role, label);
        this.resourceStatus(field, resource, role);
        const source = element('details', 'sml-v2-source');
        const summary = element('summary', '', 'Source / integrity'); source.append(summary);
        source.open = !!this.state.editor.resourceDetails?.[key];
        // Native toggle events are queued. A provider edit can rebuild this form
        // before that event runs, so record disclosure during activation itself.
        summary.onclick = event => {
            event.preventDefault();
            this.edit(state => {
                source.open = !source.open;
                (state.editor.resourceDetails ??= {})[key] = source.open;
            }, false);
            this.changed();
        };
        source.ontoggle = () => {
            if (this.disposed || !this.root.contains(source)) return;
            if (source.open === !!this.state.editor.resourceDetails?.[key]) return;
            this.edit(state => { (state.editor.resourceDetails ??= {})[key] = source.open; }, false);
            this.changed();
        };
        this.resourceSettings(source, key, resource, role);
        field.append(source); parent.append(field);
    }
    resourceSettings(parent, key, resource, role) {
        const grid = element('div', 'sml-v2-fields');
        const provider = resource.source?.provider ?? 'none';
        this.select(grid, `${key}.provider`, 'Source', provider, ['none', 'civitai', 'huggingface'], value => {
            if (value === 'none') delete resource.source;
            else resource.source = { provider: value, reference: '' };
        });
        this.input(grid, `${key}.sha256`, 'Expected SHA-256', resource.sha256 ?? '', value => {
            if (value) resource.sha256 = value; else delete resource.sha256;
        });
        if (resource.source) {
            this.input(grid, `${key}.reference`, provider === 'civitai' ? 'AIR reference' : 'HF repository', resource.source.reference,
                value => { resource.source.reference = value; });
            if (provider === 'huggingface') this.input(grid, `${key}.revision`, 'Revision', resource.source.revision ?? '', value => {
                if (value) resource.source.revision = value; else delete resource.source.revision;
            });
        }
        parent.append(grid, button('Open in Download Manager', () => this.action(() => this.openDownloads({ key, role, resource }))));
    }
    resourceRow(parent, row, role, label, leading) {
        const box = element('div', 'sml-v2-row'); box.dataset.rowId = row.id;
        box.setAttribute('role', 'group'); box.setAttribute('aria-label', label);
        const main = element('div', 'sml-v2-row-main'); main.append(leading);
        const actions = element('div', 'sml-v2-row-actions');
        this.resourcePicker(main, row.id, row.resource, role, label, role === 'loras' ? actions : null);
        const open = !!this.state.editor.resourceDetails?.[row.id];
        const info = button('i', () => this.edit(state => {
            (state.editor.resourceDetails ??= {})[row.id] = !open;
        }), `${label} source / integrity`);
        info.className = 'sml-v2-row-info'; info.dataset.field = `${row.id}.details`;
        info.setAttribute('aria-expanded', String(open));
        actions.append(info); main.append(actions); box.append(main);
        this.resourceStatus(box, row.resource, role);
        if (open) {
            const details = element('div', 'sml-v2-row-details');
            details.append(element('span', 'sml-v2-note', 'Source / integrity'));
            this.resourceSettings(details, row.id, row.resource, role); box.append(details);
        }
        parent.append(box); return { box, main, actions };
    }
    feature(parent, key) {
        const value = this.config[key];
        if (['clip', 'vae', 'audioVae'].includes(key)) {
            const labels = { baked: 'Baked', external: 'External', combined: 'External + Model File' };
            const sources = this.state.sourcesFor(key).map(source => [source, labels[source]]);
            if (sources.length > 1) parent.append(this.bar('Source:', sources, value.source, source => this.edit(state => state.source(key, source))));
            if (key === 'clip') {
                if (value.source !== 'baked') {
                    this.encoderType(parent, value);
                    const ltxCombined = value.source === 'combined' && value.type === 'ltxv';
                    if (ltxCombined) parent.append(element('div', 'sml-v2-note', value.encoders.length > 1
                        ? 'LTX needs one external Gemma encoder. Remove the extra rows; the model supplies its text projections.'
                        : 'One external Gemma encoder; text projections come from the model file.'));
                    const rows = element('div', 'sml-v2-rows'); parent.append(rows);
                    for (const [index, row] of value.encoders.entries()) {
                        const slot = element('span', 'sml-v2-slot', String(index + 1));
                        const { actions } = this.resourceRow(rows, row, 'clip', `Encoder ${index + 1}`, slot);
                        const remove = button('×', () => this.edit(() => { value.encoders.splice(index, 1); }), `Remove encoder ${index + 1}`);
                        remove.className = 'sml-v2-row-remove';
                        remove.disabled = value.encoders.length === 1; actions.append(remove);
                    }
                    if (this.spec.maxEncoders > 1 && (!ltxCombined || value.encoders.length === 0)) {
                        const add = button('+ Encoder', () => this.edit(state => { value.encoders.push(state.newRow()); }));
                        add.className = 'sml-v2-add'; add.disabled = value.encoders.length >= this.spec.maxEncoders; parent.append(add);
                    }
                }
                this.input(parent, 'clip.skip.enabled', 'CLIP skip', value.skip !== null, enabled => { value.skip = enabled ? -2 : null; }, { type: 'checkbox' });
                if (value.skip !== null) this.input(parent, 'clip.skip', 'Stop at layer', value.skip, skip => { value.skip = skip; },
                    { type: 'number', min: -24, max: -1, step: 1 });
            } else if (value.source === 'external') this.resource(parent, key, value.resource, 'vae', this.spec.features[key]);
        } else if (key === 'loras') this.loras(parent);
        else if (key === 'latent') this.latent(parent);
        else if (key === 'sampler') this.sampler(parent);
        else if (key === 'modelSampling') {
            this.select(parent, 'modelSampling.method', 'Method', value.method, Object.keys(this.spec.sampling), method => this.state.method(method));
            this.fields(parent, 'modelSampling.parameters', value.parameters, this.spec.sampling[value.method]);
            if (value.dimensions) this.fields(parent, 'modelSampling.dimensions', value.dimensions, this.spec.dimensions);
            else if (['Flux', 'Qwen Image 2.1'].includes(value.method)) parent.append(element('div', 'sml-v2-note', 'Dimensions come from Latent.'));
        } else if (key === 'seed') this.seed(parent);
    }
    sampler(parent, flux = supportsFlux(this.config)) {
        const value = this.config.sampler;
        const choices = element('div', 'sml-v2-sampler-selects');
        for (const [key, field, name, values] of [
            ['sampler_name', 'name', 'Sampler', this.spec.samplers],
            ['scheduler', 'scheduler', 'Scheduler', this.spec.schedulers],
        ]) {
            const options = values.map(option => ({ value: option, label: option }));
            if (!values.includes(value[key])) options.push({ value: value[key], label: `${value[key]} (unavailable)` });
            const control = this.dropdown.field(choices, {
                name, key: `sampler.${field}`, value: value[key], choices: options,
                searchLabel: key === 'sampler_name' ? 'Search samplers' : undefined,
                onChange: selected => this.edit(state => { state.config.sampler[key] = selected; state.dependencies?.(); }),
            });
            control.trigger.title = options.find(option => option.value === value[key]).label;
        }
        const numbers = element('div', 'sml-v2-sampler-values');
        numbers.dataset.flux = String(flux);
        const fields = { ...this.spec.sampler };
        if (flux) fields.flux_guidance = { label: 'Flux guidance', min: 0, max: 1000, step: 0.1 };
        for (const [key, field] of Object.entries(fields)) {
            this.input(numbers, `sampler.${key}`, field.label, value[key], number => { value[key] = number; },
                { type: 'number', min: field.min, max: field.max, step: field.step });
        }
        parent.append(choices, numbers);
    }
    latent(parent) {
        const value = this.config.latent, sizing = readSizing(value), spec = this.spec.latentSizing;
        const fixedInputs = {};
        const grid = element('div', 'sml-v2-size-grid'); parent.append(grid);
        const choose = (name, key, current, choices, change, extra = {}) => this.dropdown.field(grid, {
            name, key: `latent.${key}`, value: current, choices,
            onChange: selected => this.edit(state => { change(state, selected); state.dependencies(); }), ...extra,
        });
        const aspects = Object.entries(spec.aspects).map(([name, ratio]) => ({ value: name, label: name, ratio,
            group: ratio[0] === ratio[1] ? 'Square' : ratio[0] > ratio[1] ? 'Horizontal' : 'Vertical' }));
        aspects.unshift({ value: 'custom', label: 'Custom', group: 'General' });
        const ratio = dimensionAspect(value);
        const aspect = choose('Aspect', 'aspect', sizing.aspect, aspects,
            (state, name) => state.changeLatent({ aspect: name }), {
                disabled: sizing.mode === 'fixed',
                ...(sizing.mode === 'fixed' ? { display: { label: ratio.join(':'), ratio } } : {}),
            });
        if (sizing.mode === 'fixed') aspect.trigger.title = 'Aspect follows the fixed width and height.';
        const resolutions = Object.entries(spec.resolutions).map(([key, item]) => ({ value: key,
            label: item.label, group: item.group }));
        resolutions.unshift({ value: 'custom', label: 'Custom', group: 'General' });
        choose('Resolution', 'resolution', sizing.mode === 'preset' ? sizing.resolution : 'custom', resolutions,
            (state, name) => state.changeLatent(name === 'custom'
                ? { mode: state.editor.latentSizing?.customMode ?? 'megapixels' } : { mode: 'preset', resolution: name }));
        const customDivisor = this.state.editor.latentSizing?.customDivisor || !spec.divisors.includes(sizing.divisor);
        choose('Divisible by', 'divisor', customDivisor ? 'custom' : sizing.divisor,
            [...spec.divisors.map(number => ({ value: number, label: String(number) })), { value: 'custom', label: 'Custom' }],
            (state, choice) => {
                (state.editor.latentSizing ??= {}).customDivisor = choice === 'custom';
                if (choice !== 'custom') state.changeLatent({ divisor: choice });
            });
        const numericInput = (name, key, current, field, setter, commit) => {
            const input = this.input(grid, `latent.${key}`, name, current, number => { setter(number); refresh(); },
                { type: 'number', min: field.min, max: field.max, step: field.step });
            const change = input.onchange;
            input.onchange = () => {
                change();
                if (commit && !latentError(value, this.spec)) input.value = commit();
                refresh();
            };
            return input;
        };
        numericInput('Batch', 'batch_size', value.batch_size, this.spec.latent.batch_size, number => { value.batch_size = number; });
        if (customDivisor) numericInput('Custom divisor', 'customDivisor', sizing.divisor, spec.divisor,
            divisor => this.state.changeLatent({ divisor }));
        if (sizing.mode !== 'preset') {
            const mode = choose('Custom size', 'customMode', sizing.mode,
                [{ value: 'megapixels', label: 'Megapixels' }, { value: 'fixed', label: 'Fixed pixels' }],
                (state, mode) => { (state.editor.latentSizing ??= {}).customMode = mode; state.changeLatent({ mode }); });
            mode.trigger.parentElement.classList.add('sml-v2-wide');
        }
        if (sizing.mode === 'fixed') {
            for (const key of ['width', 'height']) {
                const field = this.spec.latent[key];
                const step = Number.isInteger(sizing.divisor) && sizing.divisor > 0 ? sizing.divisor : 1;
                fixedInputs[key] = numericInput(field.label, key, value[key], { ...field, min: Math.ceil(field.min / step) * step, step },
                    number => this.state.changeLatent({}, { [key]: number }), () => value[key]);
            }
        } else {
            if (sizing.aspect === 'custom') {
                numericInput('Ratio W', 'ratioWidth', sizing.ratioWidth, spec.ratio,
                    ratioWidth => this.state.changeLatent({ ratioWidth }));
                numericInput('Ratio H', 'ratioHeight', sizing.ratioHeight, spec.ratio,
                    ratioHeight => this.state.changeLatent({ ratioHeight }));
            }
            if (sizing.mode === 'megapixels') numericInput('Megapixels', 'megapixels', sizing.megapixels, spec.megapixels,
                megapixels => this.state.changeLatent({ megapixels }));
        }
        const readout = element('div', 'sml-v2-size-readout'); readout.setAttribute('role', 'status'); parent.append(readout);
        const refresh = () => {
            const error = latentError(value, this.spec);
            readout.classList.toggle('sml-v2-error', !!error);
            readout.textContent = error || `${value.width} × ${value.height} · ${(value.width * value.height / 1_000_000).toFixed(2)} MP`;
            const summary = this.root.querySelector('[data-section="latent"] .sml-v2-summary');
            if (summary) summary.textContent = error ? 'Invalid size' : this.summary('latent');
            if (readSizing(value).mode === 'fixed') {
                const ratio = dimensionAspect(value); aspect.display(ratio.join(':'), ratio);
                const divisor = readSizing(value).divisor;
                for (const [key, input] of Object.entries(fixedInputs)) {
                    if (Number.isInteger(divisor) && divisor > 0) {
                        input.step = divisor; input.min = Math.ceil(this.spec.latent[key].min / divisor) * divisor;
                    }
                    if (document.activeElement !== input) input.value = value[key] ?? '';
                }
            }
        };
        refresh();
        if (!this.config.vae) parent.append(element('div', 'sml-v2-note sml-v2-error', 'Enable VAE for latent creation.'));
    }
    seed(parent) {
        const row = element('div', 'sml-v2-seed');
        row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Seed controls');
        const input = this.input(row, 'seed.value', 'Seed', this.state.seedInput(), value => {
            this.state.setSeedInput(value); sync();
        }, { inputMode: 'numeric' });
        input.title = 'A fixed seed, -1 to randomize each run, -2 to increment, or -3 to decrement.';
        const steps = [-1, 1].map(delta => {
            const control = button(delta < 0 ? '−' : '+', () => this.edit(state => state.stepSeed(delta)),
                delta < 0 ? 'Decrease seed by 1' : 'Increase seed by 1');
            control.className = 'sml-v2-seed-step'; control.dataset.field = `seed.step.${delta}`;
            row.append(control);
            return { control, delta };
        });
        const randomize = button('🌑', () => this.edit(state => state.setSeedInput('-1')), 'Randomize each run');
        const last = button('🌘', () => this.edit(state => state.useLastSeed()), 'Use last queued seed');
        const fixed = button('🌕', () => this.edit(state => state.createFixedSeed()), 'Create fixed random seed');
        for (const [index, control] of [randomize, last, fixed].entries()) {
            control.dataset.field = `seed.action.${index}`;
            row.append(control);
        }
        const sync = () => {
            for (const { control, delta } of steps) control.disabled = !this.state.canStepSeed(delta);
            randomize.setAttribute('aria-pressed', String(this.config.seed.policy === 'random'));
            last.disabled = !this.state.canUseLastSeed;
            last.title = this.state.editor.lastSeed == null ? 'Use last queued seed (queue a prompt first)'
                : `Use last queued seed: ${this.state.editor.lastSeed}`;
        };
        sync(); parent.append(row);
    }
    loras(parent) {
        const rows = this.state.rows();
        const list = element('div', 'sml-v2-rows'); parent.append(list);
        for (const [index, { row, enabled }] of rows.entries()) {
            const toggle = button(enabled ? '✓' : '×', () => this.edit(state => state.toggleLora(row.id)), 'Enable LoRA');
            toggle.className = 'sml-v2-row-toggle'; toggle.dataset.field = `${row.id}.enabled`;
            toggle.setAttribute('aria-pressed', String(enabled));
            const { box, main, actions } = this.resourceRow(list, row, 'loras', `LoRA ${index + 1}`, toggle);
            box.dataset.enabled = String(enabled);
            const up = button('↑', () => this.edit(state => state.moveLora(row.id, -1)), 'Move LoRA up'); up.disabled = index === 0;
            const down = button('↓', () => this.edit(state => state.moveLora(row.id, 1)), 'Move LoRA down'); down.disabled = index === rows.length - 1;
            const order = element('div', 'sml-v2-row-order'); order.append(up, down); actions.prepend(order);
            const remove = button('×', () => this.edit(state => state.removeLora(row.id)), 'Remove LoRA');
            remove.className = 'sml-v2-row-remove'; actions.append(remove);
            const strength = element('div', 'sml-v2-strength');
            const input = this.input(strength, `${row.id}.strength`, 'Strength', row.strength, value => { row.strength = value; },
                { type: 'number', min: -100, max: 100, step: 0.1 });
            input.parentElement.firstElementChild.textContent = 'STR'; input.title = 'LoRA strength';
            main.insertBefore(strength, actions);
        }
        const add = button('+ LoRA', () => this.edit(state => state.addLora()));
        add.className = 'sml-v2-add'; add.disabled = rows.length >= this.spec.maxLoras; parent.append(add);
    }
    advanced(parent) {
        this.input(parent, 'memory.cleanup', 'Memory cleanup before load', this.config.memory.cleanup,
            value => { this.config.memory.cleanup = value; }, { type: 'checkbox' });
        if (this.state.canBlockSwap) {
            this.input(parent, 'memory.blockSwap.enabled', 'Block swap', !!this.config.memory.blockSwap, enabled => {
                if (enabled) this.config.memory.blockSwap = this.state.editor.blockSwap ?? defaults(this.spec.blockSwap);
                else { this.state.editor.blockSwap = this.config.memory.blockSwap; delete this.config.memory.blockSwap; }
            }, { type: 'checkbox' });
            if (this.config.memory.blockSwap) {
                this.fields(parent, 'memory.blockSwap', this.config.memory.blockSwap, this.spec.blockSwap);
            }
        }
        this.localIntegrity(parent);
    }
    localIntegrity(parent) {
        this.input(parent, 'integrity.enabled', 'Local integrity', this.config.integrity !== 'off',
            enabled => { this.config.integrity = enabled ? 'verify' : 'off'; }, { type: 'checkbox' });
        if (this.config.integrity !== 'off') {
            this.select(parent, 'integrity', 'Integrity policy', this.config.integrity, ['verify', 'sidecar'],
                value => { this.config.integrity = value; });
            const integrityHelp = {
                sidecar: 'Records local SHA-256 sidecars without comparing against an expected hash.',
                verify: 'Checks every active file before loading. Each needs a saved or entered expected SHA-256.',
            };
            parent.append(element('div', 'sml-v2-note', integrityHelp[this.config.integrity]));
        }
    }
    openDialog(title) {
        this.dropdown.close(false);
        this.closeDialog();
        const dialog = element('dialog', 'sml-v2-dialog'); dialog.setAttribute('aria-label', title);
        const header = element('header'); header.append(element('h2', '', title), button('Close', () => this.closeDialog()));
        dialog.append(header); document.body.append(dialog); this.dialog = dialog;
        dialog.onclose = () => { if (this.dialog === dialog) this.closeDialog(); };
        dialog.showModal(); return dialog;
    }
    closeDialog() {
        this.refreshPicker = null;
        const dialog = this.dialog; this.dialog = null;
        if (dialog) { dialog.close(); dialog.remove(); }
    }
    renameDialog(key, role, resource, label) {
        const state = this.state, original = resource.name;
        const current = () => !this.disposed && this.state === state
            && locateResource(state, key, role) === resource && resource.name === original;
        const dialog = this.openDialog(`Rename ${label} file`);
        dialog.classList.add('sml-v2-rename-dialog');
        dialog.append(element('p', 'sml-v2-note',
            'Renames the local file and its source/hash sidecars. The folder and file extension stay the same.'
            + (this.spec.profile === 'clip' ? '' : ' Save presets manually to keep the new name.')));
        const filename = original.replaceAll('\\', '/').split('/').at(-1);
        const extension = filename.slice(filename.lastIndexOf('.'));
        const form = element('form'), row = element('div', 'sml-v2-rename-input');
        const name = element('input'); name.type = 'text'; name.required = true;
        name.value = filename.slice(0, -extension.length); name.setAttribute('aria-label', 'New filename');
        row.append(name, element('span', '', extension));
        const status = element('div', 'sml-v2-note sml-v2-error'); status.setAttribute('role', 'status');
        name.oninput = () => { status.textContent = ''; };
        const submit = button('Rename', null); submit.type = 'submit';
        const cancel = button('Cancel', () => this.closeDialog());
        const actions = element('div', 'sml-v2-rename-actions'); actions.append(cancel, submit);
        form.append(element('p', 'sml-v2-note', original), row, status, actions); dialog.append(form);
        let pending = false;
        form.onsubmit = async event => {
            event.preventDefault();
            if (pending) return;
            if (!current()) { status.textContent = 'The selected file changed. Close this panel and try again.'; return; }
            pending = true; submit.disabled = true; name.disabled = true; status.textContent = '';
            try {
                await this.renameModel({ key, role, resource }, name.value + extension);
                if (!this.disposed) {
                    this.status('File and sidecars renamed.'
                        + (this.spec.profile === 'clip' ? '' : ' Save the preset to keep its new filename.'));
                    if (this.dialog === dialog) {
                        this.closeDialog();
                        [...this.root.querySelectorAll('[data-field]')].find(item => item.dataset.field === `${key}.rename`)?.focus();
                    }
                }
            } catch (error) {
                if (this.dialog === dialog) status.textContent = error.message;
                else if (!this.disposed) this.status(error.message, true);
            } finally { pending = false; submit.disabled = false; name.disabled = false; }
        };
        name.focus(); name.select();
    }
    async selectFile(key, role, resource, name) {
        this.edit(() => {
            if (resource.name !== name) { delete resource.sha256; delete resource.source; }
            resource.name = name;
        });
        this.closeDialog();
        [...this.root.querySelectorAll('[data-field]')].find(node => node.dataset.field === key)?.focus();
        const field = `${role}:${key}`, token = Symbol(field);
        this.resourceSelections.set(field, token);
        this.metadataStatus = token;
        const state = this.state;
        const snapshot = JSON.stringify(resource);
        const current = () => !this.disposed && this.resourceSelections.get(field) === token && this.state === state
            && locateResource(state, key, role) === resource && JSON.stringify(resource) === snapshot;
        const status = (message, error = false) => {
            if (!this.disposed && this.metadataStatus === token) this.status(message, error);
        };
        const reading = 'Reading saved source / integrity…';
        status(reading);
        try {
            const { metadata, hashOrigin } = await this.readModelMetadata(role, name);
            if (!current()) return;
            this.edit(() => {
                if (!resource.sha256 && metadata.sha256) resource.sha256 = metadata.sha256;
                if (metadata.source && (!resource.source ||
                    (resource.source.provider === metadata.source.provider && !resource.source.reference))) {
                    resource.source = metadata.source;
                } else if (metadata.source?.revision && resource.source?.provider === metadata.source.provider
                    && resource.source.reference === metadata.source.reference && !resource.source.revision) {
                    resource.source.revision = metadata.source.revision;
                }
            });
            status(hashOrigin === 'local' || hashOrigin === 'legacy'
                ? 'Loaded a saved local hash baseline; no provider lookup was made.'
                : Object.keys(metadata).length ? 'Loaded saved source / integrity.' : 'No saved source / integrity found.');
        } catch (error) {
            if (current()) status(error.message, true);
        } finally {
            if (this.resourceSelections.get(field) === token) this.resourceSelections.delete(field);
            if (this.message === reading) status('');
        }
    }
    encoderType(parent, clip) {
        const field = element('div', 'sml-v2-field'); field.append(element('span', '', 'Encoder type'));
        const label = this.spec.clipTypes.includes(clip.type) ? clip.type : `${clip.type} (unavailable)`;
        const picker = button(label, () => {
            const state = this.state;
            this.listPicker({ title: 'Select encoder type', searchLabel: 'Search encoder types', noun: 'types',
                values: () => this.spec.clipTypes, selected: clip.type, onSelect: type => {
                    if (this.state !== state || this.config.clip !== clip) return;
                    this.edit(() => { clip.type = type; this.state.dependencies(); });
                    this.closeDialog();
                    this.root.querySelector('[data-field="clip.type"]')?.focus();
                } });
        }, 'Encoder type');
        picker.className = 'sml-v2-picker'; picker.dataset.field = 'clip.type';
        picker.setAttribute('aria-haspopup', 'dialog'); field.append(picker); parent.append(field);
    }
    picker(key, role, resource, label) {
        this.listPicker({ title: `Select ${label}`, searchLabel: 'Search local files', noun: 'files',
            values: () => this.catalog().files?.[role] ?? [], selected: resource.name,
            onSelect: name => this.selectFile(key, role, resource, name), refresh: () => this.refresh() });
    }
    listPicker({ title, searchLabel, noun, values, selected, onSelect, refresh }) {
        const dialog = this.openDialog(title);
        const search = document.createElement('input'); search.type = 'search'; search.placeholder = `${searchLabel}…`;
        search.setAttribute('aria-label', searchLabel);
        const results = element('div', 'sml-v2-results');
        const count = element('div', 'sml-v2-note'); let limit = 100;
        const status = element('div', 'sml-v2-note'); status.setAttribute('role', 'status');
        const active = () => !this.disposed && this.dialog === dialog;
        const render = () => {
            if (!active()) return;
            const focused = results.contains(document.activeElement) ? document.activeElement.textContent : null;
            results.replaceChildren();
            const choices = values().filter(name => name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
            count.textContent = `${choices.length} ${noun}`;
            for (const name of choices.slice(0, limit)) {
                const choice = button(name, () => this.action(() => { if (active()) return onSelect(name); }));
                choice.setAttribute('aria-current', String(name === selected)); results.append(choice);
            }
            if (choices.length > limit) results.append(button('Show more', () => { limit += 100; render(); }));
            if (focused) [...results.querySelectorAll('button')].find(item => item.textContent === focused)?.focus();
        };
        this.refreshPicker = render;
        search.oninput = () => { limit = 100; render(); };
        dialog.onkeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); this.closeDialog(); return;
            }
            if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const items = [...results.querySelectorAll('button')];
            const index = items.indexOf(document.activeElement);
            const down = event.key === 'ArrowDown';
            const next = index < 0 ? (down ? 0 : items.length - 1) : (index + (down ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        };
        dialog.append(search, count, results, status); render(); search.focus();
        // Opening a file picker updates every role without changing selections.
        refresh?.().then(render).catch(error => {
            if (active()) { status.textContent = error.message; status.classList.add('sml-v2-error'); }
        });
    }
    presetDialog(saving = false) {
        const dialog = this.openDialog('Loader presets'); dialog.classList.add('sml-v2-presets');
        dialog.append(element('p', 'sml-v2-note', this.spec.profile === 'lora'
            ? 'Presets save the mode and all rows, including bypass state and strengths. Local integrity stays with each node.'
            : 'Presets include enabled LoRAs. Denoise, Latent, Advanced settings and seeds stay with each node.'));
        this.presetConversionHint(dialog);
        const label = element('label', '', 'Preset name'); const name = document.createElement('input');
        name.setAttribute('aria-label', 'Preset name'); name.maxLength = 128;
        name.value = this.state.editor.presetName || ''; label.append(name);
        const overwriteLabel = element('label', '', ' Overwrite existing preset');
        const overwrite = document.createElement('input'); overwrite.type = 'checkbox'; overwriteLabel.prepend(overwrite);
        const status = element('div', 'sml-v2-note'); status.setAttribute('role', 'status');
        const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search presets…';
        search.setAttribute('aria-label', 'Search presets');
        const results = element('div', 'sml-v2-results'); results.setAttribute('aria-label', 'Presets');
        const count = element('div', 'sml-v2-note');
        let busy = false, confirming = null, limit = 100;
        const active = () => !this.disposed && this.dialog === dialog;
        const run = async task => {
            if (busy) return;
            busy = true; status.textContent = ''; status.classList.remove('sml-v2-error');
            for (const control of dialog.querySelectorAll('input, button')) control.disabled = true;
            try { await task(); }
            catch (error) { if (active()) { status.textContent = error.message; status.classList.add('sml-v2-error'); } }
            finally {
                busy = false;
                if (active()) {
                    for (const control of dialog.querySelectorAll('input, button')) control.disabled = false;
                    render();
                }
            }
        };
        const save = button('Save preset', () => run(async () => {
            await this.savePreset(name.value.trim(), overwrite.checked);
            if (active()) this.closeDialog();
        }));
        const saveRow = element('div', 'sml-v2-preset-save'); saveRow.append(label, save);
        const render = () => {
            if (!active()) return;
            const existing = (this.catalog().presets ?? []).includes(name.value.trim());
            overwriteLabel.hidden = !existing;
            save.disabled = busy || !name.value.trim() || (existing && !overwrite.checked);
            results.replaceChildren();
            const names = (this.catalog().presets ?? []).filter(value => value.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
            count.textContent = `${names.length} presets`;
            for (const value of names.slice(0, limit)) {
                const row = element('div', 'sml-v2-preset-row'); row.dataset.name = value;
                if (confirming === value) {
                    row.append(element('span', 'sml-v2-preset-delete-name', `Delete “${value}”?`),
                        button('Delete', () => run(async () => {
                            await this.deletePreset(value);
                            if (!active()) return;
                            if (name.value === value) name.value = '';
                            overwrite.checked = false; confirming = null; status.textContent = 'Preset deleted.';
                            search.focus();
                        }), `Confirm delete ${value}`),
                        button('Cancel', () => { confirming = null; render(); }));
                } else {
                    const load = button(value, () => run(async () => {
                        this.resourceSelections.clear();
                        if (await this.loadPreset(value)) {
                            if (active()) this.closeDialog();
                        } else if (active()) status.textContent = 'The loader changed while this preset was loading. Select it again to apply.';
                    }), `Load ${value}`);
                    load.className = 'sml-v2-preset-load'; load.title = value;
                    load.setAttribute('aria-current', String(this.state.editor.presetName === value));
                    const remove = button('×', () => { confirming = value; render(); }, `Delete ${value}`);
                    remove.className = 'sml-v2-preset-delete'; row.append(load, remove);
                }
                results.append(row);
            }
            if (names.length > limit) results.append(button('Show more', () => { limit += 100; render(); }));
        };
        name.oninput = () => { overwrite.checked = false; render(); };
        overwrite.onchange = render;
        search.oninput = () => { limit = 100; confirming = null; render(); };
        const refresh = button('↻', () => run(() => this.refresh(true)), 'Refresh presets');
        const searchRow = element('div', 'sml-v2-preset-search'); searchRow.append(search, refresh);
        dialog.append(saveRow, overwriteLabel, searchRow, count, results, status);
        render();
        if (saving) { name.focus(); name.select(); } else search.focus();
        // Refresh the global list when opening; keep typed names/search intact.
        this.refresh().then(() => { if (!busy) render(); }).catch(error => {
            if (active()) { status.textContent = error.message; status.classList.add('sml-v2-error'); }
        });
    }
    dispose() { this.disposed = true; this.dropdown.close(false); this.closeDialog(); }
}
