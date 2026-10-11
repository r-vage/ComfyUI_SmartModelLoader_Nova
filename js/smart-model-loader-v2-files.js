// One caller-bound rename target; no graph searches, polling or watchers.
import { canonical } from './smart-model-loader-v2-state.js';
import { locateResource } from './smart-model-loader-v2-downloads.js';

export function captureRenameTarget(controller, { key, role, resource }) {
    const { node, state } = controller, graph = node.graph, id = node.id;
    const snapshot = canonical(resource), name = resource.name.replaceAll('\\', '/');
    const current = () => !controller.disposed && !controller.invalid && controller.state === state
        && graph && node.graph === graph && graph.getNodeById(id) === node
        && locateResource(state, key, role) === resource && canonical(resource) === snapshot;
    if (!current()) throw Error('The selected file is no longer available.');
    return result => {
        if (!current() || result.oldName !== name || !result.roles.includes(role)) return false;
        controller.edit(() => { resource.name = result.name; });
        return true;
    };
}
