// Grouped DOM choices with one top-layer popup, shared by both ComfyUI hosts.
const make = (tag, className, text = '') => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
function label(button, text, ratio) {
    const value = make('span', 'sml-v2-select-value', text);
    if (ratio) {
        const icon = make('span', 'sml-v2-ratio-icon');
        icon.setAttribute('aria-hidden', 'true');
        const rectangle = make('span', '');
        rectangle.style.width = `${15 * Math.min(1, ratio[0] / ratio[1])}px`;
        rectangle.style.height = `${15 * Math.min(1, ratio[1] / ratio[0])}px`;
        icon.append(rectangle); value.prepend(icon);
    }
    const caret = make('span', 'sml-v2-select-caret', '▾'); caret.setAttribute('aria-hidden', 'true');
    button.replaceChildren(value, caret);
}

export class GroupedDropdown {
    constructor(root) { this.root = root; }
    field(parent, { name, key, value, choices, onChange, disabled = false, display, searchLabel }) {
        const field = make('div', 'sml-v2-field sml-v2-select-field');
        field.append(make('span', '', name));
        const trigger = make('button', 'sml-v2-select'); trigger.type = 'button';
        trigger.dataset.field = key; trigger.disabled = disabled;
        trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-label', name);
        trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
        const selected = display ?? choices.find(choice => choice.value === value) ?? { label: String(value) };
        label(trigger, selected.label, selected.ratio);
        const open = () => this.open(trigger, name, value, choices, onChange, searchLabel);
        trigger.onclick = () => this.trigger === trigger ? this.close(true) : open();
        trigger.onkeydown = event => {
            if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); open();
        };
        field.append(trigger); parent.append(field);
        return { trigger, display: (text, ratio) => label(trigger, text, ratio) };
    }
    open(trigger, name, value, choices, onChange, searchLabel) {
        this.close(false);
        const menu = make('div', 'sml-v2-popup'); menu.popover = 'manual';
        menu.id = `sml-v2-list-${crypto.randomUUID()}`;
        const search = searchLabel ? make('input', 'sml-v2-select-search') : null;
        const list = search ? make('div', 'sml-v2-select-results') : menu;
        if (search) {
            menu.classList.add('sml-v2-popup-searchable');
            search.type = 'search'; search.placeholder = `${searchLabel}…`;
            search.setAttribute('aria-label', searchLabel); search.autocomplete = 'off'; search.spellcheck = false;
            list.id = `${menu.id}-options`; search.setAttribute('aria-controls', list.id);
            menu.append(search, list);
        }
        list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', name);
        const columns = new Map(), buttons = [];
        for (const choice of choices) {
            const group = choice.group ?? '';
            if (!columns.has(group)) {
                const column = make('div', 'sml-v2-select-column');
                if (group) column.append(make('div', 'sml-v2-select-heading', group));
                columns.set(group, column); list.append(column);
            }
            const option = make('button', 'sml-v2-select-option'); option.type = 'button'; option.tabIndex = -1;
            label(option, choice.label, choice.ratio);
            option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(choice.value === value));
            option.onclick = () => { this.close(true); onChange(choice.value); };
            columns.get(group).append(option); buttons.push(option);
        }
        let index = Math.max(0, choices.findIndex(choice => choice.value === value));
        let visible = buttons;
        if (search) {
            const empty = make('div', 'sml-v2-select-empty', 'No matching options');
            empty.setAttribute('role', 'status'); empty.hidden = buttons.length > 0; menu.append(empty);
            search.oninput = event => {
                event.stopPropagation();
                const query = search.value.trim().toLocaleLowerCase();
                visible = buttons.filter((option, i) => {
                    option.hidden = !choices[i].label.toLocaleLowerCase().includes(query);
                    return !option.hidden;
                });
                for (const column of columns.values()) {
                    column.hidden = ![...column.children].some(option => option.getAttribute('role') === 'option' && !option.hidden);
                }
                empty.hidden = visible.length > 0; index = 0; list.scrollTop = 0;
                position();
            };
        }
        menu.onkeydown = event => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); this.close(true); return; }
            if (event.key === 'Tab') { this.close(true); return; }
            if (search && event.target === search) {
                if (event.key === 'Enter') { event.preventDefault(); visible[index]?.click(); return; }
                // Horizontal arrows and Home/End retain their text-editing behavior.
                if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
                event.preventDefault();
                index = event.key === 'ArrowDown' ? 0 : visible.length - 1;
                visible[index]?.focus({ preventScroll: true }); visible[index]?.scrollIntoView({ block: 'nearest' });
                return;
            }
            if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (!visible.length) return;
            index = visible.indexOf(document.activeElement);
            if (search && index === 0 && event.key === 'ArrowUp') { search.focus({ preventScroll: true }); return; }
            index = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
                : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + visible.length) % visible.length;
            visible[index].focus({ preventScroll: true }); visible[index].scrollIntoView({ block: 'nearest' });
        };
        menu.addEventListener('pointerdown', event => event.stopPropagation());
        menu.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
        document.body.append(menu); menu.showPopover();
        this.menu = menu; this.trigger = trigger;
        trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', list.id);
        // Top-layer coordinates are viewport pixels, including canvas zoom.
        const position = () => {
            const rect = trigger.getBoundingClientRect();
            const scale = rect.width / trigger.offsetWidth;
            menu.style.maxWidth = `${(window.innerWidth - 16) / scale}px`;
            menu.style.maxHeight = `${Math.min(420, (window.innerHeight - 16) / scale)}px`;
            menu.style.transform = `scale(${scale})`;
            const width = menu.offsetWidth * scale, height = menu.offsetHeight * scale;
            menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
            const below = rect.bottom + 4;
            menu.style.top = `${Math.max(8, Math.min(below + height <= window.innerHeight - 8 ? below
                : rect.top - height - 4, window.innerHeight - height - 8))}px`;
        };
        position();
        // Keep the menu width stable as matching names become shorter.
        if (search) menu.style.width = `${menu.offsetWidth}px`;
        (search ?? buttons[index])?.focus({ preventScroll: true });
        buttons[index]?.scrollIntoView({ block: 'nearest' });
        const controller = new AbortController(); this.events = controller;
        document.addEventListener('pointerdown', event => {
            if (!menu.contains(event.target) && !trigger.contains(event.target)) this.close(false);
        }, { capture: true, signal: controller.signal });
        document.addEventListener('wheel', event => {
            if (!menu.contains(event.target)) this.close(false);
        }, { capture: true, passive: true, signal: controller.signal });
        window.addEventListener('resize', () => this.close(false), { signal: controller.signal });
        // Close on host moves/unmounts/zoom; no graph-wide polling or draw hook.
        this.hostObserver = new MutationObserver(() => this.close(false));
        for (let ancestor = trigger.parentElement; ancestor; ancestor = ancestor.parentElement) {
            this.hostObserver.observe(ancestor, { childList: true, attributes: true, attributeFilter: ['style', 'class'] });
        }
    }
    close(focus = false) {
        const trigger = this.trigger;
        this.events?.abort(); this.events = null;
        this.hostObserver?.disconnect(); this.hostObserver = null;
        if (this.menu) { this.menu.hidePopover(); this.menu.remove(); this.menu = null; }
        this.trigger = null;
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls');
            if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
        }
    }
}
