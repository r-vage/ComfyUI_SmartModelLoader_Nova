/** SML2's independent, user-editable node designs. */
import { app, api } from './comfy/index.js';
import { showSmartModelLoaderToast } from './smart-model-loader-notifications.js';
import { createNodeDesign } from './node-design-theme.js';

export const DESIGN_SETTING = 'SML2.NodeDesign';
const design = createNodeDesign({ app, api, settingId: DESIGN_SETTING,
    category: ['SML2', 'Appearance'], route: '/smart-model-loader-v2', prefix: '--sml2-design-',
    dataset: 'sml2Design', suffix: ' [SML2]',
    notice: message => showSmartModelLoaderToast('SML2 design', message),
});
export const { applyNodeDesign, applyGraphDesign, applyDesign } = design;
export async function initializeNodeDesign(appRef, config) { await design.initialize(config); }
app.registerExtension({
    name: DESIGN_SETTING,
    setup() { design.installNodeDesignHooks(globalThis.LiteGraph?.registered_node_types); },
    nodeCreated(node) { applyNodeDesign(node, true); },
    loadedGraphNode(node) { applyNodeDesign(node); },
    afterConfigureGraph() { applyGraphDesign(app.graph); },
});
