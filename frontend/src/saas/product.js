// Which product this build is: 'personal' (SteelDay, for personal trainers) or 'academia' (the
// white label for gyms). Same code and server; the build decides what a new sign-up creates and
// the words the screens use. Each workspace keeps its own kind (gym.kind) for its menus.
const fromEnv = (() => { try { return import.meta.env?.VITE_PRODUCT } catch { return undefined } })()
export const PRODUCT = fromEnv === 'academia' ? 'academia' : 'personal'
export const isPersonal = gym => (gym ? gym.kind === 'personal' : PRODUCT === 'personal')
export const WORDS = {
  personal: { space: 'consultoria', Space: 'Consultoria', admin: 'Personal', area: 'Meu acompanhamento', entry: 'Área do personal' },
  academy: { space: 'academia', Space: 'Academia', admin: 'Administrador', area: 'Minha academia', entry: 'Gestão da academia' }
}
export const wordsFor = gym => WORDS[isPersonal(gym) ? 'personal' : 'academy']
