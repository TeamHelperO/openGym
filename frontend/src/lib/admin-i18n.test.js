import { describe, expect, it, vi, beforeEach } from 'vitest'

let lang = 'en'
vi.mock('./i18n-core.js', () => ({ getLang: () => lang, dateLocale: () => 'en' }))

const { a } = await import('./admin-i18n.js')
const { auditLine } = await import('./audit.js')

describe('admin dashboard words', () => {
  beforeEach(() => { lang = 'en' })

  it('stays as written in English, with its placeholders filled', () => {
    expect(a('Make {0} an admin?', 'Ana')).toBe('Make Ana an admin?')
  })

  it('is Portuguese when the app is in pt-BR or pt', () => {
    lang = 'pt-BR'
    expect(a('Make {0} an admin?', 'Ana')).toBe('Tornar Ana admin?')
    lang = 'pt'
    expect(a('Users')).toBe('Usuários')
  })

  it('falls back to the English sentence for one it has no Portuguese for', () => {
    lang = 'pt-BR'
    expect(a('Some new sentence {0}', 1)).toBe('Some new sentence 1')
  })

  it('reaches the activity log, including the events the Supabase API records', () => {
    lang = 'pt-BR'
    expect(auditLine({ ev: 'auth.register', ok: true, name: 'Ana' }).title).toBe('Criou um perfil')
    expect(auditLine({ ev: 'admin.user.recovery', ok: true, name: 'Ana', tname: 'Bia' }).title).toBe('Gerou um link de recuperação')
    expect(auditLine({ ev: 'auth.account.delete', ok: false, msg: 'bad-password' }).sub).toBe('origem desconhecida · senha errada')
  })
})
