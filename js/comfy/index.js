/**
 * ComfyUI Import Hub - Smart Model Loader v2
 *
 * Centralizes all imports from ComfyUI core via window.comfyAPI.
 * All consumer files import from this hub — when ComfyUI updates
 * their public API, only this file needs to change.
 *
 * Public imports use window.comfyAPI. Preview coordination below requires
 * an isolated bridge to ComfyUI's internal reactive output store.
 */

// ── Stable public API ───────────────────────────────────────────────────
const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;
const { ComfyWidgets } = window.comfyAPI.widgets;

// The legacy app.nodePreviewImages map is only a mirror: deleting it does not
// update Nodes 2.0 or the current classic preview loader. ComfyUI frontend 1.53 exposes
// no public preview-retirement API. Keep the Pinia dependency at this boundary
// and let ComfyUI release shared blob URLs through its own store action.
export function revokeNodePreview(node) {
    const manager = app.extensionManager;
    const store = manager._p._s.get('nodeOutput');
    store.revokePreviewsByLocatorId(manager.workflow.nodeToNodeLocatorId(node));
}

export function hasNodePreview(node) {
    // Read the reactive record so Vue also observes its creation and retirement.
    return !!app.extensionManager._p._s.get('nodeOutput').getNodePreviews(node)?.length;
}

export { app, api, ComfyWidgets };
