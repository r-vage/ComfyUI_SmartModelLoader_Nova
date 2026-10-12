/** Saved SML2 node and dialog designs. @license Apache-2.0 */
import { app, api } from './comfy/index.js';
import { showSmartModelLoaderToast } from './smart-model-loader-notifications.js';

export const DESIGN_SETTING = 'SML2.NodeDesign';
const NODE_BACKGROUND = '#1a1a1a';
const NEUTRAL_BACKGROUND = '#3a3a3a';
export const DESIGNS = Object.freeze({
    jade: { label: 'Jade', accent: '#00ffcc', menu: '#17221f', selectText: '#abc6ba', mutedAccent: '#8eb5a8',
        bar: '#0d1217', barBorder: '#344452', barText: '#9fb3c2', pillBorder: '#40515e', selected: '#b180ff', glow: '#975bff', hover: '#7eeba7' },
    neutral: { label: 'Neutral', accent: '#d4d4d4', menu: '#303030', selectText: '#ddd', mutedAccent: '#bbb',
        bar: '#303030', barBorder: '#555', barText: '#ccc', pillBorder: '#666', selected: '#aaaaaa', glow: null, hover: '#dddddd' },
    ocean: { label: 'Ocean', accent: '#70c9ff', menu: '#182b3a', selectText: '#c1d9e8', mutedAccent: '#95bdd4',
        bar: '#101e2b', barBorder: '#36516a', barText: '#acc7dc', pillBorder: '#41617b', selected: '#70c9ff', glow: '#4b9bd5', hover: '#8cdbff' },
    amethyst: { label: 'Amethyst', accent: '#ceacff', menu: '#2d223a', selectText: '#d7c4e8', mutedAccent: '#bfa4d4',
        bar: '#1a1423', barBorder: '#503f64', barText: '#c2aed5', pillBorder: '#5c4971', selected: '#d3adff', glow: '#ae7ce0', hover: '#e4beff' },
});

// Recognize previously saved automatic colors without overriding custom node colors.
const automaticBackgrounds = new Set([NODE_BACKGROUND, NEUTRAL_BACKGROUND, '#353535', '#262626', '#19232d', '#241d2b']);
let activeBackground = NODE_BACKGROUND;

function normalizedColor(value) {
    if (typeof value !== 'string') return value;
    const hex = value.toLowerCase();
    return /^#[0-9a-f]{3}$/.test(hex) ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
}

export function applyNodeDesign(node) {
    // Serialized IDs determine ownership; user titles do not.
    if (![node.comfyClass, node.type, node.constructor?.type].some(id => typeof id === 'string' && id.endsWith(' [SML2]'))) return;
    const current = normalizedColor(node.bgcolor);
    if (current && !automaticBackgrounds.has(current) && current !== normalizedColor(globalThis.LiteGraph?.NODE_DEFAULT_BGCOLOR)) return;
    node.bgcolor = activeBackground;
}

export function applyGraphDesign(graph) {
    if (!graph) return;
    const graphs = new Set(), nodes = new Set();
    const visit = current => {
        if (!current || graphs.has(current)) return;
        graphs.add(current);
        for (const node of current._nodes ?? []) {
            if (!nodes.has(node)) { nodes.add(node); applyNodeDesign(node); }
            if (node.subgraph) visit(node.subgraph);
        }
        for (const subgraph of current.subgraphs?.values() ?? []) visit(subgraph);
    };
    visit(graph.rootGraph ?? graph);
    graph.setDirtyCanvas?.(true, true);
}

export function applyDesign(id, graph) {
    if (!Object.hasOwn(DESIGNS, id)) throw Error('Unknown SML2 design.');
    const p = DESIGNS[id], neutral = id === 'neutral';
    activeBackground = neutral ? NEUTRAL_BACKGROUND : NODE_BACKGROUND;
    const tokens = {
        'node-bg': activeBackground, text: '#dddddd', muted: '#aaaaaa',
        accent: p.accent, 'control-border': p.accent + '55', 'control-bg': p.accent + '18',
        'control-hover': p.accent + '28', 'control-selected': p.accent + '30',
        'control-strong': p.accent + '99', 'control-primary': p.accent + '22',
        'input-bg': neutral ? '#252525' : '#111111', 'input-border': '#555555',
        'select-border': p.accent + '40', 'select-bg': p.accent + '0a', 'select-hover-border': p.accent + '80',
        'select-text': p.selectText, 'muted-accent': p.mutedAccent, 'ratio-bg': p.accent + '14',
        'bar-bg': p.bar, 'bar-border': p.barBorder, 'bar-text': p.barText, 'pill-border': p.pillBorder,
        'pill-radius': neutral ? '5px' : '999px', 'selected-border': p.selected + 'cc',
        'selected-text': neutral ? '#ffffff' : '#efe6ff', 'selected-bg': neutral ? '#555555' : 'transparent',
        'selected-shadow': p.glow ? `0 0 10px ${p.glow}99` : 'none', 'bar-hover': p.hover + '1a',
        'hover-shadow': p.glow ? `0 0 10px ${p.hover}80` : 'none', 'bar-focus': p.selected,
        'menu-bg': p.menu, 'menu-border': p.accent + '60', 'option-bg': p.accent + '1c',
        'dialog-shadow': `${p.glow ? '0 0 25px ' + p.accent + '33, ' : ''}0 12px 60px #0009`,
    };
    const root = document.documentElement;
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--sml2-design-${key}`, value);
    root.dataset.sml2Design = id;
    applyGraphDesign(graph);
}

export async function initializeNodeDesign(appRef, config) {
    let saved = Object.hasOwn(DESIGNS, config.node_design) ? config.node_design : 'jade';
    applyDesign(saved, appRef.graph);
    const settings = appRef.ui.settings;
    let ready = false, synchronizing = false, revision = 0, pending = Promise.resolve();
    const showSaved = async () => {
        synchronizing = true;
        try { await settings.setSettingValueAsync(DESIGN_SETTING, DESIGNS[saved].label); }
        catch (error) { console.error('[SML2] Could not synchronize the design selector:', error); }
        finally { synchronizing = false; }
    };
    settings.addSetting({
        id: DESIGN_SETTING, category: ['SML2', 'General', 'NodeDesign'],
        name: 'Node design', type: 'combo', defaultValue: DESIGNS[saved].label,
        options: Object.values(DESIGNS).map(design => design.label), sortOrder: 500,
        tooltip: 'Colors for SML2 panels, controls and Download Manager. Jade, Ocean and Amethyst share a dark background; Neutral keeps its lighter gray background. Saved in config.json and applied immediately. Node title colors and custom backgrounds are preserved.',
        onChange(value) {
            if (!ready || synchronizing) return;
            const id = Object.keys(DESIGNS).find(key => DESIGNS[key].label === value);
            if (!id) return showSaved();
            const request = ++revision;
            pending = pending.then(async () => {
                try {
                    const response = await api.fetchApi('/smart-model-loader-v2/config/update', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ node_design: id }),
                    });
                    const result = await response.json();
                    if (!response.ok || !result.success) throw Error(result.error || 'Could not save node design.');
                    saved = id;
                    if (request === revision) applyDesign(saved, appRef.graph);
                } catch (error) {
                    console.error('[SML2] Could not save node design:', error);
                    if (request === revision) {
                        applyDesign(saved, appRef.graph);
                        await showSaved();
                        showSmartModelLoaderToast('SML2 design', 'Could not save the design. The saved design is still active.');
                    }
                }
            });
            return pending;
        },
    });
    // The server config takes precedence over stale ComfyUI settings on startup.
    await showSaved(); ready = true;
}

app.registerExtension({
    name: 'SML2.NodeDesign',
    nodeCreated(node) { applyNodeDesign(node); },
    loadedGraphNode(node) { applyNodeDesign(node); },
    afterConfigureGraph() { applyGraphDesign(app.graph); },
});
