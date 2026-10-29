/**
 * Download Manager Nova.
 * Standalone modal, grid, state, API client, events, and launcher surfaces.
 */

import { app, api } from './comfy/index.js';
import { showSmartModelLoaderToast } from './smart-model-loader-notifications.js';
import { DownloadReturns } from './smart-model-loader-v2-downloads.js';

const COMMAND_ID = 'SML2.DownloadManager.Open';
const SIDEBAR_TAB_ID = 'smart-model-loader-v2-download-manager';
const CSS_ID = 'smart-model-loader-v2-download-manager-css';
const PAGE_SIZE = 50;

// Jade controls and Director option bars match the loader forms. The modal
// keeps its own comfortable control sizing and does not depend on a canvas host.
const CSS = `
.sml2-dlm-backdrop {
    position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center;
    justify-content: center; padding: 18px; background: var(--sml2-design-backdrop); box-sizing: border-box;
}
.sml2-dlm-dialog {
    --sml2-dlm-accent: var(--sml2-design-accent); --sml2-dlm-border: var(--sml2-design-divider);
    box-sizing: border-box; width: min(1540px, 98vw); height: min(900px, 95vh);
    min-width: min(720px, calc(100vw - 36px)); min-height: min(480px, calc(100vh - 36px));
    max-width: calc(100vw - 36px); max-height: calc(100vh - 36px);
    display: flex; flex-direction: column; overflow: hidden; resize: both;
    border: 1px solid var(--sml2-design-control-border); border-radius: 12px; background: var(--sml2-design-node-bg);
    color: var(--sml2-design-text); box-shadow: var(--sml2-design-dialog-shadow); font: 13px/1.45 Arial, sans-serif; color-scheme: var(--sml2-design-color-scheme);
}
.sml2-dlm-dialog *, .sml2-dlm-dialog *::before, .sml2-dlm-dialog *::after { box-sizing: border-box; }
.sml2-dlm-dialog [hidden] { display: none !important; }
.sml2-dlm-header, .sml2-dlm-footer { display: flex; align-items: center; gap: 12px; padding: 14px 18px; flex: 0 0 auto; }
.sml2-dlm-header h2 { flex: 1; margin: 0; font-size: 18px; font-weight: 600; }
.sml2-dlm-footer { border-top: 1px solid var(--sml2-dlm-border); flex-wrap: wrap; }
.sml2-dlm-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sml2-dlm-panel { display: flex; flex: 1; min-height: 0; flex-direction: column; overflow: auto; padding: 0 18px; }
.sml2-dlm-bar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 7px; min-width: 0; padding: 8px 10px;
    border: 1px solid var(--sml2-design-bar-border); border-radius: 7px; background: var(--sml2-design-bar-bg); color: var(--sml2-design-bar-text);
}
.sml2-dlm-bar-label { font-weight: 600; margin-right: 2px; }
.sml2-dlm-navigation { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 18px 12px; flex: 0 0 auto; }
.sml2-dlm-navigation > .sml2-dlm-bar { flex: 1 1 auto; }
.sml2-dlm-inspector, .sml2-dlm-filters, .sml2-dlm-toolbar {
    display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; min-width: 0;
}
.sml2-dlm-filters { padding: 14px 0; flex: 0 0 auto; }
.sml2-dlm-field { display: flex; flex-direction: column; gap: 6px; min-width: 140px; }
.sml2-dlm-field--grow { flex: 1; min-width: 260px; }
.sml2-dlm-field label { font-size: 12px; color: var(--sml2-design-label); }
.sml2-dlm-dialog input, .sml2-dlm-dialog select, .sml2-dlm-button {
    font: inherit; min-height: 36px; padding: 7px 10px; border: 1px solid var(--sml2-design-input-border); border-radius: 5px;
    background: var(--sml2-design-input-bg); color: inherit;
}
.sml2-dlm-dialog select { border-color: var(--sml2-design-control-border); background: var(--sml2-design-select-bg); }
.sml2-dlm-dialog option { background: var(--sml2-design-menu-bg); color: var(--sml2-design-text); }
.sml2-dlm-dialog input[type=checkbox] { min-height: 0; width: 18px; height: 18px; margin: 8px 0; accent-color: var(--sml2-dlm-accent); cursor: pointer; }
.sml2-dlm-button { border-color: var(--sml2-design-control-border); background: var(--sml2-design-control-bg); color: var(--sml2-dlm-accent); cursor: pointer; }
.sml2-dlm-button:hover:not(:disabled) { background: var(--sml2-design-control-hover); border-color: var(--sml2-design-control-strong); }
.sml2-dlm-dialog :is(button, input, select):disabled { opacity: .45; cursor: default; }
.sml2-dlm-dialog :is(button, input, select, [tabindex]):focus-visible { outline: 2px solid var(--sml2-dlm-accent); outline-offset: 2px; }
.sml2-dlm-button--primary { border-color: var(--sml2-design-control-strong); background: var(--sml2-design-control-primary); }
.sml2-dlm-button--danger { color: var(--sml2-design-error); border-color: var(--sml2-design-danger); background: var(--sml2-design-control-bg); }
.sml2-dlm-button--danger:hover:not(:disabled) { background: var(--sml2-design-control-hover); border-color: var(--sml2-design-danger); }
.sml2-dlm-bar .sml2-dlm-choice {
    border-radius: var(--sml2-design-pill-radius); border-color: var(--sml2-design-pill-border); background: transparent; color: var(--sml2-design-bar-text); padding: 6px 12px;
}
.sml2-dlm-bar .sml2-dlm-choice:hover { background: var(--sml2-design-option-bg); border-color: var(--sml2-design-bar-focus); }
.sml2-dlm-bar .sml2-dlm-choice[aria-pressed=true] {
    color: var(--sml2-design-selected-text); font-weight: 600; border-color: var(--sml2-design-selected-border); background: var(--sml2-design-selected-bg);
    box-shadow: var(--sml2-design-selected-shadow);
}
.sml2-dlm-section { border-bottom: 1px solid var(--sml2-dlm-border); flex: 0 0 auto; }
.sml2-dlm-section-heading {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 0;
    border: 0; background: transparent; color: var(--sml2-design-text); text-align: left; font: inherit; cursor: pointer;
}
.sml2-dlm-section-heading:hover { color: var(--sml2-design-text); }
.sml2-dlm-section-title { flex: 0 0 auto; font-weight: 600; }
.sml2-dlm-section-title::before { content: '▸'; display: inline-block; width: 16px; color: var(--sml2-design-muted); }
.sml2-dlm-section-heading[aria-expanded=true] .sml2-dlm-section-title::before { content: '▾'; }
.sml2-dlm-section-summary { flex: 1; min-width: 0; color: var(--sml2-design-muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sml2-dlm-section-content { padding: 0 0 14px; }
.sml2-dlm-table-wrap { overflow: auto; min-height: 190px; flex: 1 0 190px; border: 1px solid var(--sml2-dlm-border); border-radius: 7px; margin: 14px 0; }
.sml2-dlm-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; }
.sml2-dlm-table th, .sml2-dlm-table td { padding: 12px; border-bottom: 1px solid var(--sml2-dlm-border); vertical-align: top; text-align: left; max-width: 360px; }
.sml2-dlm-table th { position: sticky; top: 0; z-index: 2; background: var(--sml2-design-menu-bg); color: var(--sml2-design-select-text); white-space: nowrap; font-weight: 500; font-size: 12px; }
.sml2-dlm-table th button { font: inherit; padding: 7px 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
.sml2-dlm-table th[aria-sort=ascending] button::after { content: ' ↑'; color: var(--sml2-dlm-accent); }
.sml2-dlm-table th[aria-sort=descending] button::after { content: ' ↓'; color: var(--sml2-dlm-accent); }
.sml2-dlm-table tbody tr:nth-child(even) { background: var(--sml2-design-row-bg); }
.sml2-dlm-table tbody tr:hover { background: var(--sml2-design-option-bg); }
.sml2-dlm-table tbody tr:has(input[type=checkbox]:checked) { background: var(--sml2-design-select-bg); }
.sml2-dlm-table tbody tr:last-child td { border-bottom: 0; }
.sml2-dlm-table tr[aria-disabled=true] { opacity: .62; }
.sml2-dlm-table td input[type=text] { width: 180px; }
.sml2-dlm-table td select { max-width: 220px; }
.sml2-dlm-remote { word-break: break-word; min-width: 240px; }
.sml2-dlm-reason, .sml2-dlm-filename-note { display: block; margin-top: 5px; font-size: 12px; }
.sml2-dlm-reason { color: var(--sml2-design-error); }
.sml2-dlm-filename-note, .sml2-dlm-muted { color: var(--sml2-design-muted); }
.sml2-dlm-digest { font: 12px/1.5 monospace; word-break: break-all; max-width: 180px; }
.sml2-dlm-pager { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 14px; flex: 0 0 auto; }
.sml2-dlm-pager span { margin-left: auto; color: var(--sml2-design-muted); }
.sml2-dlm-toolbar { padding: 6px 0 0; flex: 0 0 auto; }
.sml2-dlm-action-group { display: flex; flex-wrap: wrap; gap: 8px; }
.sml2-dlm-bundles { margin-left: auto; }
.sml2-dlm-queue-actions { display: flex; gap: 8px; }
.sml2-dlm-progress { min-width: 220px; }
.sml2-dlm-progress progress { width: 100%; height: 6px; margin-top: 8px; accent-color: var(--sml2-dlm-accent); border: 0; border-radius: 3px; overflow: hidden; }
.sml2-dlm-progress progress::-webkit-progress-bar { background: var(--sml2-design-divider); }
.sml2-dlm-progress progress::-webkit-progress-value { background: var(--sml2-dlm-accent); }
.sml2-dlm-progress progress::-moz-progress-bar { background: var(--sml2-dlm-accent); }
.sml2-dlm-job-state[data-state=completed] { color: var(--sml2-design-success); }
.sml2-dlm-job-state[data-state=failed] { color: var(--sml2-design-error); }
.sml2-dlm-status { flex: 1; min-width: min(260px, 100%); color: var(--sml2-design-muted); overflow-wrap: anywhere; }
.sml2-dlm-status[data-kind=error] { color: var(--sml2-design-error); }
.sml2-dlm-status[data-kind=warn] { color: var(--sml2-design-warning); }
.sml2-dlm-status[data-kind=success] { color: var(--sml2-design-success); }
.sml2-dlm-classic { width: 100%; margin: 6px 0; padding: 9px; border: 1px solid var(--sml2-design-control-border); border-radius: 6px; background: var(--sml2-design-control-bg); color: var(--sml2-design-accent); cursor: pointer; }
@media(max-width: 760px) {
    .sml2-dlm-backdrop { padding: 4px; }
    .sml2-dlm-dialog { width: 100%; height: 98vh; min-width: 0; min-height: 0; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); resize: none; }
    .sml2-dlm-header, .sml2-dlm-footer { padding: 12px; }
    .sml2-dlm-header h2 { font-size: 16px; }
    .sml2-dlm-navigation { margin-inline: 12px; }
    .sml2-dlm-navigation > .sml2-dlm-bar { flex-basis: 100%; }
    .sml2-dlm-panel { padding-inline: 12px; }
    .sml2-dlm-field, .sml2-dlm-field--grow { min-width: min(240px, 100%); flex: 1; }
    .sml2-dlm-field input, .sml2-dlm-field select { width: 100%; min-width: 0; }
    .sml2-dlm-bundles { margin-left: 0; }
}
`;

function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function button(label, handler, testid = '') {
    const node = el('button', 'sml2-dlm-button', label);
    node.type = 'button';
    if (testid) node.dataset.testid = testid;
    node.addEventListener('click', handler);
    return node;
}

function labeledField(labelText, input, grow = false) {
    const wrap = el('div', `sml2-dlm-field${grow ? ' sml2-dlm-field--grow' : ''}`);
    const label = el('label', '', labelText);
    if (!input.id) input.id = `sml2-dlm-${crypto.randomUUID()}`;
    label.htmlFor = input.id;
    wrap.append(label, input);
    return wrap;
}

function selectInput(values = []) {
    const select = document.createElement('select');
    for (const item of values) {
        const option = document.createElement('option');
        if (typeof item === 'string') {
            option.value = item;
            option.textContent = item;
        } else {
            option.value = item.value;
            option.textContent = item.label;
        }
        select.appendChild(option);
    }
    return select;
}

function optionBar(label) {
    const bar = el('div', 'sml2-dlm-bar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', label);
    bar.appendChild(el('span', 'sml2-dlm-bar-label', `${label}:`));
    return bar;
}

function optionButton(label, handler, testid = '') {
    const control = button(label, handler, testid);
    control.className += ' sml2-dlm-choice';
    control.setAttribute('aria-pressed', 'false');
    return control;
}

function collapsibleSection(title, id, content, open = true) {
    const section = el('section', 'sml2-dlm-section');
    const heading = button('', () => setOpen(content.hidden));
    heading.className = 'sml2-dlm-section-heading';
    heading.setAttribute('aria-label', title);
    heading.setAttribute('aria-controls', id);
    const summary = el('span', 'sml2-dlm-section-summary');
    content.id = id;
    content.className += ' sml2-dlm-section-content';
    heading.append(el('span', 'sml2-dlm-section-title', title), summary);
    section.append(heading, content);
    function setOpen(value) {
        content.hidden = !value;
        heading.setAttribute('aria-expanded', String(value));
    }
    setOpen(open);
    return { element: section, summary, setOpen };
}

async function request(path, body = null) {
    const response = await api.fetchApi(path, body === null ? undefined : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* bounded server errors may be empty */ }
    if (!response.ok || payload.success === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
}

function formatBytes(value) {
    if (!Number.isFinite(value)) return 'Unknown';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let amount = value;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function saveJSON(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

const downloadReturns = new DownloadReturns((uuid, role) => request(
    `/smart-model-loader-v2/download-manager/queue/${encodeURIComponent(uuid)}/loader-result?${new URLSearchParams({ role })}`));

class DownloadManagerModal {
    constructor() {
        this.provider = 'civitai';
        this.compatibleOnly = true;
        this.showUnsupported = false;
        this.categories = [];
        this.categoryMap = new Map();
        this.rows = [];
        this.rowState = new Map();
        this.selected = new Set();
        this.inspectionId = null;
        this.page = 1;
        this.pages = 1;
        this.filteredTotal = 0;
        this.sortBy = 'supported';
        this.sortDir = 'desc';
        this.jobs = [];
        this.selectedJobs = new Set();
        this.queueRows = new Map();
        this.pendingQueueJobs = new Set();
        this.queueFrame = null;
        this.queueRevision = 0;
        this.queueJobRevisions = new Map();
        this.queueRequest = 0;
        this.originalFocus = null;
        this.busy = false;
        this.openRequest = 0;
        this.inspectionRequest = 0;
        this.pageRequest = 0;
        this.searchTimer = null;
    }

    async open(source = null, target = null) {
        // The return target belongs to this launch, not the singleton's latest job.
        // File selection and queue/start remain explicit actions.
        if (source !== null) {
            if (!['civitai', 'huggingface'].includes(source.provider)
                || typeof source.locator !== 'string' || source.locator.length > 2048
                || (source.revision !== undefined && (typeof source.revision !== 'string' || source.revision.length > 2048))) {
                throw new Error('Download Manager requires a provider and a valid source reference.');
            }
            source = { provider: source.provider, locator: source.locator.trim(),
                revision: source.provider === 'huggingface' ? (source.revision ?? '').trim() : '' };
        }
        if (this.backdrop?.isConnected && source === null && target === null) {
            this.dialog.focus();
            return;
        }
        if (this.returnTarget && !this.returnTarget.bound) this.returnTarget.release();
        this.returnTarget = target;
        const generation = ++this.openRequest;
        if (!this.backdrop?.isConnected) {
            injectCSS();
            this.originalFocus = document.activeElement;
            this.build();
            document.body.appendChild(this.backdrop);
            this.categoriesReady = this.loadCategories();
            void this.loadQueue();
        }
        this.resetInspection(true);
        if (source) {
            this.provider = source.provider;
            this.locator.value = source.locator;
            this.revision.value = source.revision;
            this.syncProvider();
        }
        this.sourceSection.setOpen(true);
        this.showPanel('files');
        this.locator.focus();
        this.setStatus('Choose a provider and get its file list.');
        this.busy = Boolean(source?.locator); this.inspectButton.disabled = this.busy;
        await this.categoriesReady;
        if (generation !== this.openRequest || !this.backdrop?.isConnected) return;
        this.busy = false; this.inspectButton.disabled = false;
        if (source?.locator) await this.inspect();
    }

    close() {
        if (this.returnTarget && !this.returnTarget.bound) this.returnTarget.release();
        this.returnTarget = null;
        this.openRequest++;
        this.inspectionRequest++;
        this.pageRequest++;
        this.busy = false;
        clearTimeout(this.searchTimer); this.searchTimer = null;
        if (this.queueFrame !== null) cancelAnimationFrame(this.queueFrame);
        this.queueFrame = null;
        this.pendingQueueJobs.clear();
        this.queueRows.clear();
        this.queueBody = null;
        this.backdrop?.remove();
        this.backdrop = null;
        if (this.originalFocus instanceof HTMLElement) this.originalFocus.focus();
    }

    setStatus(message, kind = '') {
        this.status.textContent = message;
        this.status.dataset.kind = kind;
        if (kind === 'error' || kind === 'warn') showSmartModelLoaderToast('Download Manager', message, kind);
    }

    build() {
        this.backdrop = el('div', 'sml2-dlm-backdrop');
        this.backdrop.dataset.testid = 'smart-model-loader-v2-download-manager';
        this.dialog = el('section', 'sml2-dlm-dialog');
        this.dialog.tabIndex = -1;
        this.dialog.setAttribute('role', 'dialog');
        this.dialog.setAttribute('aria-modal', 'true');
        this.dialog.setAttribute('aria-labelledby', 'sml2-dlm-title');
        this.backdrop.appendChild(this.dialog);
        this.backdrop.addEventListener('mousedown', event => { if (event.target === this.backdrop) this.close(); });
        this.backdrop.addEventListener('keydown', event => this.handleDialogKey(event));

        const header = el('header', 'sml2-dlm-header');
        const title = el('h2', '', 'Download Manager Nova');
        title.id = 'sml2-dlm-title';
        const views = optionBar('View');
        this.navigation = el('div', 'sml2-dlm-navigation');
        this.filesTab = optionButton('Files', () => this.showPanel('files'), 'smart-model-loader-v2-download-manager-files-tab');
        this.queueTab = optionButton('Queue', () => this.showPanel('queue'), 'smart-model-loader-v2-download-manager-queue-tab');
        views.append(this.filesTab, this.queueTab);
        header.append(title, button('Close', () => this.close(), 'smart-model-loader-v2-download-manager-close'));
        this.navigation.appendChild(views);
        this.dialog.append(header, this.navigation);

        const body = el('div', 'sml2-dlm-body');
        this.filesPanel = el('section', 'sml2-dlm-panel');
        this.filesPanel.dataset.panel = 'files';
        this.queuePanel = el('section', 'sml2-dlm-panel');
        this.queuePanel.dataset.panel = 'queue';
        this.queuePanel.hidden = true;
        body.append(this.filesPanel, this.queuePanel);
        this.dialog.appendChild(body);

        const footer = el('footer', 'sml2-dlm-footer');
        this.status = el('span', 'sml2-dlm-status', 'Choose a provider and inspect a locator.');
        this.status.setAttribute('role', 'status');
        this.queueButton = button('Add Selected to Queue', () => this.enqueueSelected(), 'smart-model-loader-v2-download-manager-enqueue');
        this.queueButton.disabled = true;
        this.queueButton.className += ' sml2-dlm-button--primary';
        footer.append(this.status, this.queueButton);
        this.buildFilesPanel();
        this.buildQueuePanel();
        this.dialog.appendChild(footer);
        this.showPanel('files');
    }

    handleDialogKey(event) {
        if (event.key === 'Escape') { this.close(); return; }
        if (event.key !== 'Tab') return;
        const focusable = [...this.dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')]
            .filter(node => !node.closest('[hidden]'));
        if (!focusable.length) { event.preventDefault(); this.dialog.focus(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === this.dialog)) {
            event.preventDefault(); first.focus();
        }
    }

    showPanel(name) {
        const files = name === 'files';
        this.filesPanel.hidden = !files;
        this.queuePanel.hidden = files;
        this.filesTab.setAttribute('aria-pressed', String(files));
        this.queueTab.setAttribute('aria-pressed', String(!files));
        this.queueButton.hidden = !files;
        if (!files) this.loadQueue();
    }

    buildFilesPanel() {
        const inspector = el('div', 'sml2-dlm-inspector');
        this.provider = 'civitai';
        const providerBar = optionBar('Source');
        this.navigation.prepend(providerBar);
        this.providerButtons = new Map();
        for (const [value, label] of [['civitai', 'CivitAI'], ['huggingface', 'Hugging Face']]) {
            const control = optionButton(label, () => {
                if (this.provider === value) return;
                this.provider = value;
                sourceChanged();
            }, `smart-model-loader-v2-download-manager-provider-${value}`);
            this.providerButtons.set(value, control);
            providerBar.appendChild(control);
        }
        this.locator = document.createElement('input');
        this.locator.type = 'text';
        this.locator.id = 'sml2-dlm-locator';
        this.locator.dataset.testid = 'smart-model-loader-v2-download-manager-locator';
        this.locator.placeholder = 'AIR, SHA-256, provider URL, or owner/repository';
        this.revision = document.createElement('input');
        this.revision.type = 'text';
        this.revision.id = 'sml2-dlm-revision';
        this.revision.placeholder = 'Optional branch, tag, or commit';
        this.revisionWrap = labeledField('Revision', this.revision);
        this.inspectButton = button('Get File List', () => this.inspect(), 'smart-model-loader-v2-download-manager-inspect');
        const sourceChanged = () => {
            this.openRequest++;
            this.resetInspection();
            this.syncProvider();
            this.setStatus('Source changed. Get its file list to continue.');
        };
        this.locator.addEventListener('input', sourceChanged);
        this.revision.addEventListener('input', sourceChanged);
        this.locator.addEventListener('keydown', event => { if (event.key === 'Enter') this.inspect(); });
        this.inspectButton.className += ' sml2-dlm-button--primary';
        inspector.append(labeledField('Locator', this.locator, true), this.revisionWrap, this.inspectButton);
        const sourceContent = el('div');
        sourceContent.append(inspector);
        this.sourceSection = collapsibleSection('Source details', 'sml2-dlm-source-content', sourceContent);

        const filters = el('div', 'sml2-dlm-filters');
        this.search = document.createElement('input');
        this.search.type = 'search';
        this.search.id = 'sml2-dlm-search';
        this.search.placeholder = 'Search files';
        this.search.setAttribute('aria-label', 'Search inspected files');
        const filterBar = optionBar('Show');
        const refresh = () => { this.page = 1; this.loadPage(); };
        this.compatibleButton = optionButton('Compatible only', () => {
            this.compatibleOnly = !this.compatibleOnly; this.syncFilters(); refresh();
        });
        this.unsupportedButton = optionButton('Unsupported / informational', () => {
            this.showUnsupported = !this.showUnsupported; this.syncFilters(); refresh();
        });
        filterBar.append(this.compatibleButton, this.unsupportedButton);
        this.syncFilters();
        this.search.addEventListener('input', () => {
            clearTimeout(this.searchTimer); this.searchTimer = setTimeout(refresh, 180);
        });
        filters.append(labeledField('Search', this.search, true), filterBar);

        this.tableWrap = el('div', 'sml2-dlm-table-wrap');
        this.table = el('table', 'sml2-dlm-table');
        this.table.dataset.testid = 'smart-model-loader-v2-download-manager-table';
        this.table.setAttribute('aria-label', 'Inspected provider files');
        this.tableWrap.appendChild(this.table);
        this.pager = el('div', 'sml2-dlm-pager');
        this.prevButton = button('Previous', () => { if (this.page > 1) { this.page -= 1; this.loadPage(); } }, 'smart-model-loader-v2-download-manager-prev');
        this.nextButton = button('Next', () => { if (this.page < this.pages) { this.page += 1; this.loadPage(); } }, 'smart-model-loader-v2-download-manager-next');
        this.pageStatus = el('span', '', 'No results');
        this.pager.append(this.prevButton, this.nextButton, this.pageStatus);
        this.returnNote = el('p', 'sml2-dlm-muted');
        this.filesPanel.append(this.sourceSection.element, this.returnNote, filters, this.tableWrap, this.pager);
        this.syncProvider();
        this.renderTable();
    }

    buildQueuePanel() {
        const actions = el('div', 'sml2-dlm-toolbar');
        this.selectAllQueueButton = button('Select All', () => this.setAllQueueJobsSelected(true), 'smart-model-loader-v2-download-manager-queue-select-all');
        this.deselectAllQueueButton = button('Deselect All', () => this.setAllQueueJobsSelected(false), 'smart-model-loader-v2-download-manager-queue-deselect-all');
        this.startSelectedButton = button('Start Selected', () => this.selectedQueueAction('start'), 'smart-model-loader-v2-download-manager-start-selected');
        this.removeSelectedButton = button('Remove Selected', () => this.selectedQueueAction('remove'), 'smart-model-loader-v2-download-manager-remove-selected');
        this.selectAllQueueButton.disabled = true;
        this.deselectAllQueueButton.disabled = true;
        this.startSelectedButton.disabled = true;
        this.removeSelectedButton.disabled = true;
        this.startSelectedButton.className += ' sml2-dlm-button--primary';
        this.removeSelectedButton.className += ' sml2-dlm-button--danger';
        const selection = el('div', 'sml2-dlm-action-group');
        selection.append(this.selectAllQueueButton, this.deselectAllQueueButton);
        const transfers = el('div', 'sml2-dlm-action-group');
        transfers.append(this.startSelectedButton, this.removeSelectedButton);
        const bundles = el('div', 'sml2-dlm-action-group sml2-dlm-bundles');
        bundles.append(
            button('Export Bundle', () => this.exportBundle(), 'smart-model-loader-v2-download-manager-export-bundle'),
            button('Import Bundle', () => this.importBundleInput.click(), 'smart-model-loader-v2-download-manager-import-bundle'),
            button('Refresh Queue', () => this.loadQueue(), 'smart-model-loader-v2-download-manager-refresh-queue'),
        );
        actions.append(selection, transfers, bundles);
        this.importBundleInput = document.createElement('input');
        this.importBundleInput.type = 'file';
        this.importBundleInput.accept = 'application/json,.json';
        this.importBundleInput.hidden = true;
        this.importBundleInput.addEventListener('change', () => this.importBundle());
        actions.appendChild(this.importBundleInput);
        this.queueTableWrap = el('div', 'sml2-dlm-table-wrap');
        this.queueTable = el('table', 'sml2-dlm-table');
        this.queueTable.dataset.testid = 'smart-model-loader-v2-download-manager-queue-table';
        this.queueTable.setAttribute('aria-label', 'Persistent download queue');
        this.queueTableWrap.appendChild(this.queueTable);
        this.queuePanel.append(actions, this.queueTableWrap);
    }

    syncProvider() {
        const huggingface = this.provider === 'huggingface';
        this.revisionWrap.hidden = !huggingface;
        this.locator.placeholder = huggingface ? 'owner/repository or Hugging Face URL' : 'AIR, SHA-256 or CivitAI URL';
        for (const [value, control] of this.providerButtons) {
            control.setAttribute('aria-pressed', String(this.provider === value));
        }
        const summary = [huggingface ? 'Hugging Face' : 'CivitAI', this.locator.value.trim()];
        if (huggingface && this.revision.value.trim()) summary.push(this.revision.value.trim());
        this.sourceSection.summary.textContent = summary.filter(Boolean).join(' · ');
        this.sourceSection.summary.title = this.sourceSection.summary.textContent;
    }

    syncFilters() {
        this.compatibleButton.setAttribute('aria-pressed', String(this.compatibleOnly));
        this.unsupportedButton.setAttribute('aria-pressed', String(this.showUnsupported));
    }

    async loadCategories() {
        const backdrop = this.backdrop;
        try {
            const data = await request('/smart-model-loader-v2/download-manager/categories');
            if (this.backdrop !== backdrop || !backdrop?.isConnected) return;
            this.categories = data.categories || [];
            this.categoryMap = new Map(this.categories.map(category => [category.id, category]));
            this.renderTable();
        } catch (error) {
            if (this.backdrop === backdrop && backdrop?.isConnected) this.setStatus(error.message, 'error');
        }
    }

    filterPayload() {
        return {
            query: this.search.value,
            compatible_only: this.compatibleOnly,
            show_unsupported: this.showUnsupported,
            sort_by: this.sortBy,
            sort_dir: this.sortDir,
        };
    }

    resetInspection(resetFilters = false) {
        this.inspectionRequest++; this.pageRequest++;
        clearTimeout(this.searchTimer); this.searchTimer = null;
        this.busy = false; this.inspectButton.disabled = false;
        this.inspectionId = null; this.rows = [];
        this.returnKey = null;
        this.rowState.clear(); this.selected.clear();
        this.page = 1; this.pages = 1; this.filteredTotal = 0;
        if (resetFilters) {
            this.search.value = ''; this.compatibleOnly = true; this.showUnsupported = false;
            this.syncFilters();
            this.sortBy = 'supported'; this.sortDir = 'desc';
        }
        this.renderTable();
        this.prevButton.disabled = true; this.nextButton.disabled = true;
        this.pageStatus.textContent = 'No results';
    }

    async inspect() {
        if (this.busy) return;
        this.resetInspection();
        const generation = this.inspectionRequest, backdrop = this.backdrop;
        const current = () => generation === this.inspectionRequest && this.backdrop === backdrop && backdrop?.isConnected;
        this.busy = true;
        this.inspectButton.disabled = true;
        this.setStatus('Getting provider file list…');
        try {
            const data = await request('/smart-model-loader-v2/download-manager/inspect', {
                provider: this.provider,
                locator: this.locator.value,
                revision: this.provider === 'huggingface' ? this.revision.value : '',
                page: 1,
                page_size: PAGE_SIZE,
                ...this.filterPayload(),
            });
            if (!current()) return;
            this.inspectionId = data.inspection_id;
            this.page = 1;
            this.acceptPage(data);
            this.setStatus(`${data.inspection.label}: ${data.total} provider files inspected.`, 'success');
        } catch (error) {
            if (current()) this.setStatus(error.message, 'error');
        } finally {
            if (current()) { this.busy = false; this.inspectButton.disabled = false; }
        }
    }

    async loadPage() {
        if (!this.inspectionId) return;
        const generation = ++this.pageRequest, inspection = this.inspectionId, backdrop = this.backdrop;
        const current = () => generation === this.pageRequest && inspection === this.inspectionId
            && this.backdrop === backdrop && backdrop?.isConnected;
        const params = new URLSearchParams({
            page: String(this.page), page_size: String(PAGE_SIZE),
            query: this.search.value,
            compatible_only: String(this.compatibleOnly),
            show_unsupported: String(this.showUnsupported),
            sort_by: this.sortBy, sort_dir: this.sortDir,
        });
        try {
            const data = await request(`/smart-model-loader-v2/download-manager/inspection/${encodeURIComponent(inspection)}?${params}`);
            if (!current()) return;
            this.acceptPage(data);
        } catch (error) { if (current()) this.setStatus(error.message, 'error'); }
    }

    acceptPage(data) {
        this.rows = data.rows || [];
        this.pages = data.pages || 1;
        this.filteredTotal = data.filtered_total || 0;
        for (const row of this.rows) this.ensureRowState(row);
        this.renderTable();
        this.prevButton.disabled = this.page <= 1;
        this.nextButton.disabled = this.page >= this.pages;
        this.pageStatus.textContent = `Page ${this.page} of ${this.pages} — ${this.filteredTotal} filtered / ${data.total} total`;
    }

    ensureRowState(row) {
        if (this.rowState.has(row.key)) return this.rowState.get(row.key);
        const category = row.suggested_category || '';
        const root = this.categoryMap.get(category)?.roots?.[0]?.id || '';
        const state = {
            category, root_id: root, subfolder: '',
            filename: row.suggested_filename || row.remote_path.split('/').pop(),
            conflict_policy: 'skip', confirm_ambiguous: !row.category_ambiguous,
        };
        this.rowState.set(row.key, state);
        return state;
    }

    isSelected(key) { return this.selected.has(key); }

    setRowSelected(key, checked) {
        if (checked) this.selected.add(key); else this.selected.delete(key);
        if (!checked && this.returnKey === key) this.returnKey = null;
        if (this.returnTarget) this.renderTable(); else this.updateQueueButton();
    }

    returnCandidates() {
        return this.returnTarget?.current() ? [...this.selected].filter(key =>
            this.returnTarget.accepts(this.rowState.get(key)?.category)) : [];
    }

    selectedReturnKey() {
        const keys = this.returnCandidates();
        return keys.includes(this.returnKey) ? this.returnKey : keys.length === 1 ? keys[0] : null;
    }

    toggleSelectAll(checked) {
        for (const row of this.rows) {
            if (!row.supported) continue;
            if (checked) this.selected.add(row.key); else this.selected.delete(row.key);
        }
        this.renderTable();
    }

    updateQueueButton() {
        const count = this.selected.size;
        this.queueButton.disabled = count === 0;
        this.queueButton.textContent = count ? `Add ${count} Selected to Queue` : 'Add Selected to Queue';
        const available = this.rows.filter(row => row.supported);
        const checked = available.filter(row => this.selected.has(row.key)).length;
        this.selectAllFiles.disabled = available.length === 0;
        this.selectAllFiles.checked = available.length > 0 && checked === available.length;
        this.selectAllFiles.indeterminate = checked > 0 && checked < available.length;
        this.selectAllFiles.setAttribute('aria-label', `Select all ${available.length} files on this page`);
    }

    sortableHeader(row, text, field) {
        const th = document.createElement('th');
        th.scope = 'col';
        if (this.sortBy === field) th.setAttribute('aria-sort', this.sortDir === 'asc' ? 'ascending' : 'descending');
        const trigger = el('button', '', text);
        trigger.type = 'button';
        trigger.addEventListener('click', () => {
            if (this.sortBy === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
            else { this.sortBy = field; this.sortDir = 'asc'; }
            this.page = 1;
            this.loadPage();
        });
        th.appendChild(trigger);
        row.appendChild(th);
    }

    renderTable() {
        const target = this.returnTarget?.current() && !this.returnTarget.bound ? this.returnTarget : null;
        if (this.returnNote) {
            this.returnNote.hidden = !target;
            this.returnNote.textContent = target
                ? `Fill ${target.label} after verification. If selecting several compatible files, choose one under Use in caller.` : '';
        }
        this.table.replaceChildren();
        const thead = document.createElement('thead');
        const header = document.createElement('tr');
        const selectTh = document.createElement('th');
        selectTh.scope = 'col';
        const selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        this.selectAllFiles = selectAll;
        selectAll.dataset.testid = 'smart-model-loader-v2-download-manager-select-all';
        selectAll.addEventListener('change', () => this.toggleSelectAll(selectAll.checked));
        selectTh.appendChild(selectAll);
        header.appendChild(selectTh);
        if (target) header.appendChild(el('th', '', 'Use in caller'));
        this.sortableHeader(header, 'Remote filename / path', 'remote_path');
        this.sortableHeader(header, 'Provider / type', 'provider_type');
        this.sortableHeader(header, 'Format / precision', 'format');
        this.sortableHeader(header, 'Size', 'size');
        this.sortableHeader(header, 'Expected digest', 'supported');
        for (const text of ['Destination category', 'Destination folder', 'Safe subfolder', 'Local filename', 'Conflict policy']) {
            const th = el('th', '', text); th.scope = 'col'; header.appendChild(th);
        }
        thead.appendChild(header);
        const tbody = document.createElement('tbody');
        for (const row of this.rows) tbody.appendChild(this.renderRow(row));
        if (!this.rows.length) {
            const tr = document.createElement('tr');
            const td = el('td', 'sml2-dlm-muted', this.inspectionId ? 'No files match the current filter.' : 'Choose a provider and select Get File List to see available files.');
            td.colSpan = target ? 12 : 11; tr.appendChild(td); tbody.appendChild(tr);
        }
        this.table.append(thead, tbody);
        this.updateQueueButton();
    }

    renderRow(row) {
        const tr = document.createElement('tr');
        tr.dataset.testid = `smart-model-loader-v2-download-manager-row-${row.key}`;
        tr.setAttribute('aria-disabled', String(!row.supported));
        const state = this.ensureRowState(row);
        const selectTd = document.createElement('td');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = this.isSelected(row.key);
        check.disabled = !row.supported;
        check.setAttribute('aria-label', `Select ${row.suggested_filename || row.remote_path}`);
        check.addEventListener('change', () => this.setRowSelected(row.key, check.checked));
        selectTd.appendChild(check);
        const remote = el('td', 'sml2-dlm-remote', row.remote_path);
        if (row.suggested_filename && row.suggested_filename !== row.remote_path) {
            remote.appendChild(el('span', 'sml2-dlm-filename-note', `Author filename: ${row.suggested_filename}`));
        }
        if (row.disabled_reason) remote.appendChild(el('span', 'sml2-dlm-reason', row.disabled_reason));
        if (row.category_ambiguous) remote.appendChild(el('span', 'sml2-dlm-muted', 'Confirm a destination category.'));
        const provider = el('td', '', `${row.provider === 'civitai' ? 'CivitAI' : 'Hugging Face'} / ${row.provider_type || 'file'}`);
        const format = el('td', '', `${row.format || 'Unknown'}${row.precision ? ` / ${row.precision}` : ''}`);
        const size = el('td', '', formatBytes(row.size));
        const digest = el('td', 'sml2-dlm-digest');
        if (row.expected_digest?.value) {
            digest.textContent = `${row.expected_digest.algorithm}: ${row.expected_digest.value.slice(0, 12)}…`;
            digest.title = row.expected_digest.value;
        } else digest.textContent = 'Unverifiable';
        const categoryTd = document.createElement('td');
        const category = selectInput([{ value: '', label: 'Choose category' }]);
        category.setAttribute('aria-label', `Destination category for ${row.remote_path}`);
        for (const id of row.compatible_categories || []) {
            const item = this.categoryMap.get(id);
            category.appendChild(new Option(item?.label || id, id));
        }
        category.value = state.category;
        category.disabled = !row.supported;
        category.addEventListener('change', () => {
            state.category = category.value;
            state.confirm_ambiguous = Boolean(category.value);
            state.root_id = this.categoryMap.get(category.value)?.roots?.[0]?.id || '';
            this.renderTable();
        });
        categoryTd.appendChild(category);
        const rootTd = document.createElement('td');
        const root = selectInput([{ value: '', label: 'Choose folder' }]);
        root.setAttribute('aria-label', `Destination folder for ${row.remote_path}`);
        for (const item of this.categoryMap.get(state.category)?.roots || []) root.appendChild(new Option(item.label, item.id));
        root.value = state.root_id;
        root.disabled = !row.supported || !state.category;
        root.addEventListener('change', () => { state.root_id = root.value; });
        rootTd.appendChild(root);
        const subfolderTd = document.createElement('td');
        const subfolder = document.createElement('input');
        subfolder.type = 'text'; subfolder.value = state.subfolder;
        subfolder.placeholder = 'optional/subfolder';
        subfolder.setAttribute('aria-label', `Safe subfolder for ${row.remote_path}`);
        subfolder.disabled = !row.supported;
        subfolder.addEventListener('input', () => { state.subfolder = subfolder.value; });
        subfolderTd.appendChild(subfolder);
        const filenameTd = document.createElement('td');
        const filename = document.createElement('input');
        filename.type = 'text'; filename.value = state.filename;
        filename.setAttribute('aria-label', `Local filename for ${row.remote_path}`);
        filename.disabled = !row.supported;
        filename.addEventListener('input', () => { state.filename = filename.value; });
        filenameTd.appendChild(filename);
        const conflictTd = document.createElement('td');
        const conflict = selectInput(['skip', 'rename', 'overwrite']);
        conflict.value = state.conflict_policy;
        conflict.setAttribute('aria-label', `Conflict policy for ${row.remote_path}`);
        conflict.disabled = !row.supported;
        conflict.addEventListener('change', () => { state.conflict_policy = conflict.value; });
        conflictTd.appendChild(conflict);
        tr.append(selectTd);
        const target = this.returnTarget?.current() && !this.returnTarget.bound ? this.returnTarget : null;
        if (target) {
            const useTd = document.createElement('td'), use = document.createElement('input');
            use.type = 'radio'; use.name = 'sml2-dlm-use-in-caller';
            use.checked = this.selectedReturnKey() === row.key;
            use.disabled = !row.supported || !target.accepts(state.category);
            use.setAttribute('aria-label', `Use ${row.remote_path} in ${target.label}`);
            use.addEventListener('change', () => {
                this.returnKey = row.key; this.selected.add(row.key); this.renderTable();
            });
            useTd.append(use); tr.append(useTd);
        }
        tr.append(remote, provider, format, size, digest, categoryTd, rootTd, subfolderTd, filenameTd, conflictTd);
        return tr;
    }

    async enqueueSelected() {
        if (!this.inspectionId || this.queueButton.disabled) return;
        const generation = this.inspectionRequest, backdrop = this.backdrop;
        const current = () => generation === this.inspectionRequest && this.backdrop === backdrop && backdrop?.isConnected;
        const overrides = {};
        for (const [key, state] of this.rowState) {
            if (this.isSelected(key)) overrides[key] = { ...state };
        }
        const selection = { all_filtered: false, file_keys: [...this.selected] };
        const target = this.returnTarget?.current() && !this.returnTarget.bound ? this.returnTarget : null;
        const returnKey = target ? this.selectedReturnKey() : null;
        if (target && this.returnCandidates().length > 1 && !returnKey) {
            this.setStatus('Choose which selected file to use in the caller.', 'warn'); return;
        }
        // Reserve this launch immediately so double-clicks/late responses cannot
        // attach several jobs to one field. Failed requests release the reservation.
        if (target && returnKey) target.bound = true;
        this.queueButton.disabled = true;
        try {
            const result = await request('/smart-model-loader-v2/download-manager/queue', {
                inspection_id: this.inspectionId,
                selection,
                overrides,
            });
            if (target && returnKey) {
                const uuid = result.file_jobs?.[returnKey];
                const job = result.jobs.find(item => item.uuid === uuid);
                if (job) downloadReturns.bind(this.jobs.find(item => item.uuid === uuid) ?? job, target);
                else target.error('The queued file could not be linked to this loader field.');
            }
            if (current()) {
                this.setStatus(`${result.jobs.length} file(s) added and waiting to start.`, 'success');
                this.selected.clear();
                this.renderTable();
            }
            await this.loadQueue();
        } catch (error) {
            if (target && returnKey) target.bound = false;
            if (current()) this.setStatus(error.message, 'error');
        } finally { if (current()) this.updateQueueButton(); }
    }

    async loadQueue() {
        const requestId = ++this.queueRequest;
        const revision = this.queueRevision;
        try {
            const data = await request('/smart-model-loader-v2/download-manager/queue');
            if (requestId !== this.queueRequest) return;
            // Websocket progress received while this snapshot was in flight is
            // newer than the response. Keep it, including newly announced jobs.
            const updated = new Map(this.jobs.filter(job =>
                (this.queueJobRevisions.get(job.uuid) || 0) > revision
            ).map(job => [job.uuid, job]));
            this.jobs = (data.jobs || []).map(job => {
                const current = updated.get(job.uuid) || job;
                updated.delete(job.uuid);
                return current;
            });
            this.jobs.push(...updated.values());
            void downloadReturns.reconcile(this.jobs);
            const available = new Set(this.jobs.map(job => job.uuid));
            for (const uuid of this.queueJobRevisions.keys()) {
                if (!available.has(uuid)) this.queueJobRevisions.delete(uuid);
            }
            this.selectedJobs = new Set([...this.selectedJobs].filter(jobUuid => available.has(jobUuid)));
            if (this.backdrop?.isConnected) this.renderQueue();
        } catch (error) {
            if (requestId === this.queueRequest && this.backdrop?.isConnected) this.setStatus(error.message, 'error');
        }
    }

    updateJob(job) {
        void downloadReturns.observe(job);
        this.queueJobRevisions.set(job.uuid, ++this.queueRevision);
        const index = this.jobs.findIndex(item => item.uuid === job.uuid);
        const previous = index >= 0 ? this.jobs[index] : null;
        if (job.state === 'failed' && (previous?.state !== 'failed' || previous?.error !== job.error
            || previous?.completed_at !== job.completed_at)) {
            showSmartModelLoaderToast('Download failed', `${job.destination?.filename || 'Model'}: ${job.error || 'Check the Download Manager for details.'}`,
                'error', `download:${job.uuid}:${this.queueRevision}`);
        }
        if (!this.backdrop?.isConnected && job.state === 'completed'
            && (previous?.state !== 'completed' || previous?.completed_at !== job.completed_at)) {
            const filename = job.destination?.filename || 'Model';
            const skipped = job.conflict_result === 'skipped-existing';
            const context = `download:${job.uuid}:${this.queueRevision}`;
            if (job.provider_verified !== true) {
                showSmartModelLoaderToast('File not verified',
                    `${filename}: ${skipped ? 'download skipped; the existing file' : 'the file'} could not be verified against the selected source.`,
                    'warn', context);
            } else {
                showSmartModelLoaderToast(skipped ? 'Download skipped' : 'Download finished',
                    skipped ? `${filename} already exists and matches the selected source.` : `${filename} is ready.`,
                    skipped ? 'info' : 'success', context);
            }
        }
        if (index >= 0) this.jobs[index] = job; else this.jobs.push(job);
        if (!this.backdrop?.isConnected) return;
        this.pendingQueueJobs.add(job.uuid);
        if (this.queueFrame !== null) return;
        this.queueFrame = requestAnimationFrame(() => {
            this.queueFrame = null;
            const changed = this.pendingQueueJobs;
            this.pendingQueueJobs = new Set();
            if (!this.backdrop?.isConnected) return;
            if ([...changed].some(uuid => !this.queueRows.has(uuid))) {
                this.renderQueue();
                return;
            }
            for (const current of this.jobs) {
                if (changed.has(current.uuid)) this.updateQueueRow(current);
            }
            this.updateQueueActions();
        });
    }

    renderQueue() {
        if (!this.queueBody || this.queueBody.parentNode !== this.queueTable) {
            this.queueRows.clear();
            const thead = document.createElement('thead');
            const header = document.createElement('tr');
            for (const text of ['Select', 'File', 'Provider', 'Destination', 'State / progress', 'Local SHA-256', 'Actions']) {
                const th = el('th', '', text); th.scope = 'col'; header.appendChild(th);
            }
            thead.appendChild(header);
            this.queueBody = document.createElement('tbody');
            this.queueTable.replaceChildren(thead, this.queueBody);
        }
        const available = new Set(this.jobs.map(job => job.uuid));
        for (const [uuid, row] of this.queueRows) {
            if (available.has(uuid)) continue;
            row.tr.remove();
            this.queueRows.delete(uuid);
        }
        this.queueEmptyRow?.remove();
        this.queueEmptyRow = null;
        let previous = null;
        for (const job of [...this.jobs].reverse()) {
            this.updateQueueRow(job);
            const row = this.queueRows.get(job.uuid).tr;
            const expected = previous ? previous.nextSibling : this.queueBody.firstChild;
            if (expected !== row) this.queueBody.insertBefore(row, expected);
            previous = row;
        }
        if (!this.jobs.length) {
            const tr = document.createElement('tr'); const td = el('td', 'sml2-dlm-muted', 'The persistent queue is empty.'); td.colSpan = 7; tr.appendChild(td);
            this.queueBody.appendChild(tr);
            this.queueEmptyRow = tr;
        }
        this.updateQueueActions();
    }

    updateQueueRow(job) {
        let row = this.queueRows.get(job.uuid);
        if (!row) {
            const tr = document.createElement('tr');
            tr.dataset.jobUuid = job.uuid;
            const selectedTd = document.createElement('td');
            const selected = document.createElement('input');
            selected.type = 'checkbox'; selected.checked = this.selectedJobs.has(job.uuid);
            selected.setAttribute('aria-label', `Select queue job ${job.destination?.filename}`);
            selected.addEventListener('change', () => {
                if (selected.checked) this.selectedJobs.add(job.uuid); else this.selectedJobs.delete(job.uuid);
                this.updateQueueActions();
            });
            selectedTd.appendChild(selected);
            const file = el('td', 'sml2-dlm-remote');
            const provider = el('td');
            const destination = el('td');
            const progressTd = el('td', 'sml2-dlm-progress');
            const progress = document.createElement('progress');
            progress.max = 100;
            const state = el('div', 'sml2-dlm-job-state');
            progressTd.append(state, progress);
            const hash = el('td', 'sml2-dlm-digest');
            const actions = el('td', 'sml2-dlm-queue-actions');
            tr.append(selectedTd, file, provider, destination, progressTd, hash, actions);
            row = { tr, selected, file, provider, destination, state, progress, hash, actions };
            this.queueRows.set(job.uuid, row);
        }
        const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
        row.state.dataset.state = job.state;
        row.selected.checked = this.selectedJobs.has(job.uuid);
        row.selected.setAttribute('aria-label', `Select queue job ${job.destination?.filename}`);
        text(row.file, job.destination?.filename || 'Unknown');
        text(row.provider, job.provider_identity?.provider || 'Unknown');
        text(row.destination, `${job.destination?.category || ''} / ${job.destination?.relative_path || ''}`);
        const partial = job.has_partial ? ` — ${formatBytes(job.partial_bytes)} partial retained` : '';
        text(row.state, `${job.state}${job.error ? ` — ${job.error}` : ''}${partial}`);
        const percent = job.progress?.percent || 0;
        if (row.progress.value !== percent) row.progress.value = percent;
        row.progress.setAttribute('aria-label', `${job.state} ${percent} percent`);
        text(row.hash, job.local_sha256 ? `${job.local_sha256.slice(0, 12)}…` : '—');
        row.hash.title = job.local_sha256 || '';
        const canCancel = ['queued', 'transferring'].includes(job.state);
        const canRetry = ['failed', 'cancelled'].includes(job.state);
        const canDiscard = canRetry && !!job.has_partial;
        const actionKey = `${canCancel}/${canRetry}/${canDiscard}`;
        if (row.actionKey !== actionKey) {
            row.actions.replaceChildren();
            if (canCancel) row.actions.appendChild(button('Cancel', () => this.queueAction('cancel', job.uuid)));
            if (canRetry) row.actions.appendChild(button('Retry', () => this.queueAction('retry', job.uuid)));
            if (canDiscard) row.actions.appendChild(button('Delete Partial', () => this.queueAction('discard-partial', job.uuid)));
            row.actionKey = actionKey;
        }
    }

    async queueAction(action, jobUuid) {
        try {
            const data = await request(`/smart-model-loader-v2/download-manager/queue/${action}`, { job_uuid: jobUuid });
            if (action === 'discard-partial') {
                this.setStatus(
                    data.removed_bytes
                        ? `${formatBytes(data.removed_bytes)} of partial download data deleted.`
                        : 'No partial download data was present.',
                    'success',
                );
            }
            await this.loadQueue();
        } catch (error) { this.setStatus(error.message, 'error'); }
    }

    selectedJobIds() { return [...this.selectedJobs]; }

    setAllQueueJobsSelected(selected) {
        if (selected) this.selectedJobs = new Set(this.jobs.map(job => job.uuid));
        else this.selectedJobs.clear();
        this.renderQueue();
    }

    updateQueueActions() {
        const selected = this.jobs.filter(job => this.selectedJobs.has(job.uuid));
        const startable = new Set(['ready', 'failed', 'cancelled']);
        const removable = new Set(['ready', 'completed', 'failed', 'cancelled']);
        this.selectAllQueueButton.disabled = !this.jobs.length || selected.length === this.jobs.length;
        this.deselectAllQueueButton.disabled = !selected.length;
        this.startSelectedButton.disabled = !selected.length || selected.some(job => !startable.has(job.state));
        this.removeSelectedButton.disabled = !selected.length || selected.some(
            job => !removable.has(job.state) || job.has_partial,
        );
    }

    async selectedQueueAction(action) {
        const ids = this.selectedJobIds();
        if (!ids.length) return;
        try {
            const data = await request(`/smart-model-loader-v2/download-manager/queue/${action}`, { job_ids: ids });
            this.selectedJobs.clear();
            const count = action === 'start' ? data.jobs?.length || 0 : data.removed_job_ids?.length || 0;
            this.setStatus(
                action === 'start'
                    ? `${count} download(s) started.`
                    : `${count} queue ${count === 1 ? 'entry' : 'entries'} removed.`,
                'success',
            );
            await this.loadQueue();
        } catch (error) { this.setStatus(error.message, 'error'); }
    }

    async exportBundle() {
        const ids = this.selectedJobIds();
        if (!ids.length) { this.setStatus('Select queue jobs to export.', 'error'); return; }
        try {
            const data = await request('/smart-model-loader-v2/download-manager/bundles/export', { job_ids: ids });
            saveJSON('smart-model-loader-download-bundle.json', data.bundle);
            this.setStatus('Download bundle exported.', 'success');
        } catch (error) { this.setStatus(error.message, 'error'); }
    }

    async importBundle() {
        const file = this.importBundleInput.files?.[0];
        this.importBundleInput.value = '';
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error('Bundle exceeds the 1 MiB client limit.');
            const bundle = JSON.parse(await file.text());
            const data = await request('/smart-model-loader-v2/download-manager/bundles/import', { bundle });
            this.setStatus(`${data.jobs.length} bundle item(s) added and waiting to start.`, 'success');
            await this.loadQueue();
        } catch (error) { this.setStatus(error.message, 'error'); }
    }

}

const manager = new DownloadManagerModal();
// Public, pack-local launcher for explicit source actions in loader nodes.
export function openDownloadManager(source = null, target = null) { return manager.open(source, target); }
let sidebarRegistered = false;

async function isNewMenuActive() {
    try {
        const settingApi = app.extensionManager?.setting;
        if (typeof settingApi?.get === 'function') {
            return await settingApi.get('Comfy.UseNewMenu') !== 'Disabled';
        }
        return app.ui?.settings?.getSettingValue?.('Comfy.UseNewMenu') !== 'Disabled';
    } catch (_) { return true; }
}

async function injectClassicButton() {
    let existing = document.querySelector('[data-smart-model-loader-v2-download-manager-classic]');
    if (await isNewMenuActive()) { existing?.remove(); return; }
    existing = document.querySelector('[data-smart-model-loader-v2-download-manager-classic]');
    if (existing?.isConnected) return;
    const host = app.ui?.menuContainer;
    if (!host) return;
    const launch = el('button', 'sml2-dlm-classic', 'Download Manager Nova');
    launch.type = 'button';
    launch.dataset.smartModelLoaderV2DownloadManagerClassic = 'true';
    launch.addEventListener('click', () => manager.open());
    host.appendChild(launch);
}

function registerSidebarLauncher() {
    if (sidebarRegistered) return true;
    const extensionManager = app.extensionManager;
    if (!extensionManager || typeof extensionManager.registerSidebarTab !== 'function') return false;
    extensionManager.registerSidebarTab({
        id: SIDEBAR_TAB_ID,
        icon: 'pi pi-download',
        title: 'Download Manager Nova',
        tooltip: 'Inspect provider files and manage verified model downloads',
        type: 'custom',
        render: host => {
            host.replaceChildren();
            manager.open();
            queueMicrotask(() => {
                try {
                    Promise.resolve(extensionManager.command?.execute?.(`Workspace.ToggleSidebarTab.${SIDEBAR_TAB_ID}`)).catch(() => {});
                } catch (_) { /* launcher close is best effort */ }
            });
        },
    });
    sidebarRegistered = true;
    return true;
}

api.addEventListener('smart-model-loader-v2.download-manager-progress', event => {
    if (event.detail?.job) manager.updateJob(event.detail.job);
});
api.addEventListener('reconnected', () => { void manager.loadQueue(); });

app.registerExtension({
    name: 'SML2.DownloadManager',
    commands: [{
        id: COMMAND_ID,
        label: 'Download Manager Nova',
        icon: 'pi pi-download',
        tooltip: 'Open Download Manager Nova',
        function: () => manager.open(),
    }],
    menuCommands: [{ path: ['SML2'], commands: [COMMAND_ID] }],
    async init() { injectCSS(); },
    async setup() {
        if (!registerSidebarLauncher()) {
            let tries = 0;
            const timer = setInterval(() => {
                tries += 1;
                if (registerSidebarLauncher() || tries > 20) clearInterval(timer);
            }, 100);
        }
        await injectClassicButton();
        queueMicrotask(() => { void injectClassicButton(); });
        setTimeout(() => { void injectClassicButton(); }, 250);
        const observer = new MutationObserver(() => { void injectClassicButton(); });
        observer.observe(document.body, { childList: true, subtree: true });
    },
});
