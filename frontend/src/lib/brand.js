// The product's name and where its source is published. This build is SteelDay, a fork of
// openGym (github.com/DuarteSantos8/openGym, AGPL v3): the source link is this fork's, as AGPL §13
// asks of a hosted copy, and the credit to openGym stays in Settings and NOTICE.md.
export const APP_NAME = 'SteelDay'
export const SOURCE_URL = 'https://github.com/TeamHelperO/openGym'
// The address printed on PDFs and named in outgoing requests: wherever this copy is served.
export const SITE = (() => { try { return location.host || 'SteelDay' } catch { return 'SteelDay' } })()
