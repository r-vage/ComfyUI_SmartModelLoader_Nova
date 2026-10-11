import { NODE_ID, SAMPLER_NODE_ID, EDITOR_KEY, canonical, queuedConfiguration, seedAfterAcceptance } from './smart-model-loader-v2-state.js';
import { parseSamplerConfiguration } from './smart-model-loader-v2-sampler-state.js';

function liveNode(graph, executionId) {
    let node;
    for (const id of executionId.split(':')) {
        node = graph?.getNodeById(id);
        graph = node?.subgraph;
    }
    return node;
}

function workflowNode(workflow, executionId) {
    let nodes = workflow.nodes;
    let node;
    for (const id of executionId.split(':')) {
        node = nodes?.find(item => String(item.id) === id);
        nodes = workflow.definitions?.subgraphs?.find(graph => graph.id === node?.type)?.nodes;
    }
    return node;
}

// One scoped submission hook. It changes only this node's already-built snapshot,
// and advances editor state only after the server accepts the prompt.
export function installQueueHook(api, app, controllers) {
    const original = api.queuePrompt;
    async function queuePrompt(number, prompt, ...rest) {
        const output = prompt.output;
        const entries = Object.entries(output ?? {}).filter(([, node]) => [NODE_ID, SAMPLER_NODE_ID].includes(node.class_type) && node.inputs.configuration);
        if (!entries.length) return original.call(this, number, prompt, ...rest);
        const snapshot = structuredClone(prompt);
        const updates = [];
        for (const [id, node] of entries) {
            const sampler = node.class_type === SAMPLER_NODE_ID;
            // Pipe values are only known during execution. Leave the local seed
            // policy untouched when the pipe owns settings; the backend resolves
            // and records a local seed only if the pipe has none.
            if (sampler && parseSamplerConfiguration(node.inputs.configuration).usePipe) continue;
            const config = queuedConfiguration(node.inputs.configuration, undefined, sampler ? parseSamplerConfiguration : undefined);
            if (!config.seed) continue;
            const concrete = { ...config, seed: { ...config.seed, policy: 'fixed' } };
            const serialized = canonical(concrete);
            snapshot.output[id].inputs.configuration = serialized;
            const saved = workflowNode(snapshot.workflow, id);
            if (saved) {
                saved.widgets_values = [serialized];
                saved.properties ??= {};
                saved.properties[EDITOR_KEY] ??= {};
                saved.properties[EDITOR_KEY].lastSeed = config.seed.value;
            }
            const controller = controllers.get(liveNode(app.rootGraph ?? app.graph, id));
            updates.push({ controller, before: node.inputs.configuration, seed: config.seed });
        }
        const result = await original.call(this, number, snapshot, ...rest);
        if (result?.prompt_id) {
            for (const { controller, before, seed } of updates) {
                if (controller && !controller.disposed) {
                    const unchanged = !controller.state.config.usePipe
                        && canonical(controller.state.config.seed) === canonical(JSON.parse(before).seed);
                    controller.edit(state => {
                        if (unchanged) state.config.seed = seedAfterAcceptance(seed);
                        state.editor.lastSeed = seed.value;
                    });
                }
            }
        }
        return result;
    }
    api.queuePrompt = queuePrompt;
    return () => { if (api.queuePrompt === queuePrompt) api.queuePrompt = original; };
}
