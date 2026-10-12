import { app, api } from './comfy/index.js';
import { showSmartModelLoaderToast } from './smart-model-loader-notifications.js';
import { initializeNodeDesign } from './smart-model-loader-design.js';

const PREFIX = '/smart-model-loader-v2/config';
const TOKEN_MASK = '••••••••';
const CATEGORY = ['SML2', 'General'];

async function update(values) {
    try {
        const response = await api.fetchApi(`${PREFIX}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Update failed');
    } catch (error) {
        const credential = 'hf_token' in values || 'civitai_api_key' in values;
        showSmartModelLoaderToast('Setting update failed', credential
            ? 'The credential could not be saved. Check the server log.' : error);
        throw error;
    }
}

function afterInitialChange(handler) {
    let initialized = false;
    return async function (value) {
        if (!initialized) {
            initialized = true;
            return;
        }
        return handler.call(this, value);
    };
}

app.registerExtension({
    name: 'SML2.Settings',
    async init(appRef) {
        let config = {};
        try {
            const response = await api.fetchApi(`${PREFIX}/all`);
            if (!response.ok) throw new Error(`Settings request failed (HTTP ${response.status}).`);
            config = await response.json();
        } catch (error) {
            showSmartModelLoaderToast('Could not read settings', error, 'warn');
        }
        await initializeNodeDesign(appRef, config);
        const add = (setting) => appRef.ui.settings.addSetting(setting);
        add({
            id: 'SML2.LogLevel', category: [...CATEGORY, 'LogLevel'], name: '📝 Log Level',
            type: 'combo', options: ['error', 'warning', 'info', 'debug'], defaultValue: config.log_level || 'warning',
            tooltip: 'Standalone loader and Download Manager logging verbosity.', sortOrder: 600,
            onChange: afterInitialChange((value) => update({ log_level: value })),
        });
        add({
            id: 'SML2.AllowLegacyModelFormats', category: [...CATEGORY, 'AllowLegacyModelFormats'], name: '⚠️ Allow Legacy Model Formats',
            type: 'boolean', defaultValue: config.allow_legacy_model_formats === true,
            tooltip: 'Local administrator override for pickle-capable .ckpt, .pt, .pth, and .bin artifacts.', sortOrder: 400,
            onChange: afterInitialChange((value) => update({ allow_legacy_model_formats: value === true })),
        });
        for (const [provider, label, configured, order] of [
            ['civitai_api_key', 'CivitAI API Key', config.civitai_api_key_configured, 200],
            ['hf_token', 'Hugging Face Token', config.hf_token_configured, 100],
        ]) {
            const id = `SML2.${provider}`;
            add({
                id, category: [...CATEGORY, provider], name: `🔑 ${label}`, type: 'text',
                defaultValue: configured ? TOKEN_MASK : '', sortOrder: order,
                tooltip: 'The secret is stored only in private server-side config and is never returned.',
                onChange: afterInitialChange(async (value) => {
                    if (value === TOKEN_MASK) return;
                    await update({ [provider]: value });
                    appRef.ui.settings.setSettingValue?.(id, value ? TOKEN_MASK : '');
                }),
            });
            appRef.ui.settings.setSettingValue?.(id, configured ? TOKEN_MASK : '');
        }
    },
});
