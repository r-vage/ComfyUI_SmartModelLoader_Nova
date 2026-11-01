// Shared pack-local requests and catalog invalidation for panels/native settings.
import { api } from './comfy/index.js';
import { onDownloadCatalogChange } from './smart-model-loader-v2-downloads.js';

const catalogs = new Map(), pendingReads = new Map(), listeners = new Set();
export const onCatalogChange = callback => { listeners.add(callback); return () => listeners.delete(callback); };
const notify = profile => { for (const callback of listeners) callback(profile); };

export function invalidateCatalog(profile) {
    if (profile) catalogs.delete(profile); else catalogs.clear();
    pendingReads.clear();
    notify(profile);
}
onDownloadCatalogChange(() => invalidateCatalog());

export async function request(path, payload) {
    if (payload === undefined && pendingReads.has(path)) return pendingReads.get(path);
    const pending = (async () => {
        const response = await api.fetchApi(`/smart-model-loader-v2/v2/${path}`, payload === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error ?? 'The loader request failed');
        return result;
    })();
    if (payload === undefined) pendingReads.set(path, pending);
    try { return await pending; }
    finally { if (pendingReads.get(path) === pending) pendingReads.delete(path); }
}

export function catalog(profile, refresh = false) {
    if (refresh || !catalogs.has(profile)) {
        const path = `catalog?${new URLSearchParams({ profile })}`;
        if (refresh) pendingReads.delete(path);
        const pending = request(path).catch(error => {
            if (catalogs.get(profile) === pending) catalogs.delete(profile);
            throw error;
        });
        catalogs.set(profile, pending);
        if (refresh) notify(profile);
    }
    return catalogs.get(profile);
}
