// Sizing intent and resolved pixel dimensions share one serialized latent record.
const numeric = (value, field) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max
        || (field.step === 1 && !Number.isInteger(value))) {
        throw Error(`${field.label} must be between ${field.min} and ${field.max}.`);
    }
    return value;
};
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

export function dimensionAspect(latent) {
    if (![latent.width, latent.height].every(value => Number.isInteger(value) && value > 0)) return [1, 1];
    const common = gcd(latent.width, latent.height);
    return [latent.width / common, latent.height / common];
}

export function readSizing(latent) {
    if (latent.sizing) return { ...latent.sizing };
    // A request with explicit dimensions needs no aspect/area calculation.
    // Merely opening it must preserve its dimensions exactly.
    const [width, height] = [latent.width, latent.height];
    const divisor = [32, 16, 8].find(value => width % value === 0 && height % value === 0)
        ?? ([width, height].every(value => Number.isInteger(value) && value > 0) ? gcd(width, height) : 32);
    return { mode: 'fixed', divisor };
}

export function aspectFor(latent, spec) {
    let [width, height] = dimensionAspect(latent);
    const name = `${width}:${height}`;
    if (Object.hasOwn(spec.latentSizing.aspects, name)) return { aspect: name };
    if (Math.max(width, height) > spec.latentSizing.ratio.max) {
        const scale = 100 / Math.max(width, height); width *= scale; height *= scale;
    }
    return { aspect: 'custom', ratioWidth: width, ratioHeight: height };
}

export function resolveDimensions(latent, spec) {
    const sizing = latent.sizing;
    if (!sizing) return { width: latent.width, height: latent.height };
    const settings = spec.latentSizing;
    const divisor = numeric(sizing.divisor, settings.divisor);
    let width, height;
    if (sizing.mode === 'fixed') {
        width = numeric(latent.width, spec.latent.width);
        height = numeric(latent.height, spec.latent.height);
    } else {
        const ratio = sizing.aspect === 'custom'
            ? [numeric(sizing.ratioWidth, settings.ratio), numeric(sizing.ratioHeight, settings.ratio)]
            : settings.aspects[sizing.aspect];
        if (!ratio) throw Error('Select a supported aspect ratio.');
        let area;
        if (sizing.mode === 'preset') area = settings.resolutions[sizing.resolution]?.area;
        else if (sizing.mode === 'megapixels') area = numeric(sizing.megapixels, settings.megapixels) * 1_000_000;
        else throw Error('Select a supported sizing mode.');
        if (!Number.isFinite(area)) throw Error('Select a supported resolution.');
        width = Math.sqrt(area * ratio[0] / ratio[1]);
        height = Math.sqrt(area * ratio[1] / ratio[0]);
    }
    const snap = (value, field) => {
        const result = Math.max(Math.ceil(field.min / divisor), Math.floor(value / divisor + .5)) * divisor;
        if (result > field.max) throw Error('Latent dimensions exceed the supported size.');
        return result;
    };
    return { width: snap(width, spec.latent.width), height: snap(height, spec.latent.height) };
}

export function latentError(latent, spec) {
    try {
        for (const [key, field] of Object.entries(spec.latent)) numeric(latent[key], field);
        const dimensions = resolveDimensions(latent, spec);
        if (dimensions.width !== latent.width || dimensions.height !== latent.height) {
            throw Error('Dimensions do not match the selected aspect, resolution or divisor.');
        }
        if (latent.width * latent.height * latent.batch_size > spec.latentSizing.maxPixels) {
            throw Error('Latent size exceeds the supported pixel batch.');
        }
        return '';
    } catch (error) { return error.message; }
}
