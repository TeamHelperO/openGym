// The product name shown to people. A build sets VITE_BRAND_NAME (.env.production does, for the
// rebranded platform); tests and the dev server keep the upstream name, so the existing test
// expectations and the translation packs, which are keyed by English text that says "openGym",
// stay as they are. i18n-core.t() swaps the name in every translated line at runtime.
// Node-loadable on purpose (i18n-core is imported outside Vite too): import.meta.env may be absent.
const fromEnv = (() => { try { return import.meta.env?.VITE_BRAND_NAME } catch { return undefined } })()
export const UPSTREAM_NAME = 'openGym'
export const BRAND = (typeof fromEnv === 'string' && fromEnv.trim()) || UPSTREAM_NAME
export const rebranded = BRAND !== UPSTREAM_NAME
export const branded = s => (rebranded && typeof s === 'string' && s.includes(UPSTREAM_NAME) ? s.replaceAll(UPSTREAM_NAME, BRAND) : s)
