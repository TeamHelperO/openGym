// Sign-in for a Supabase build (lib/supa-auth.js): e-mail and password, or a sign-in link by
// e-mail. Takes the place of the passkey and password screens, which need the self-hosted server.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button, Segmented } from './ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { MIN_PASSWORD } from './PasswordAuth.jsx'
import {
  signIn, signUp, sendMagicLink, sendPasswordReset, setPassword, signOut,
  pendingSignIn, clearPending, takeLinkError,
} from '../lib/supa-auth.js'

const errStyle = { color: 'var(--danger, #e5484d)', marginTop: 8, textAlign: 'start' }
const toast = m => useUI.getState().toast(m)

// What the Auth API or the app's own server said, as a sentence for the person.
function message(e, fallback) {
  const code = String(e?.code || '')
  if (code === 'invalid_credentials') return t('Wrong e-mail or password.')
  if (code === 'email_not_confirmed') return t('Confirm your e-mail first. Open the link we sent you.')
  if (code === 'user_already_exists' || code === 'email_exists') return t('Another profile already uses this e-mail address.')
  if (code === 'weak_password') return t('Use at least {0} characters.', MIN_PASSWORD)
  if (code === 'invite-invalid') return t('This app is invite-only. Enter the code you were given.')
  if (/rate_limit/.test(code) || e?.status === 429) return t('Too many attempts. Wait a few minutes and try again.')
  if (code === 'otp_expired' || code === 'flow_state_expired') return t('That link has expired or was already used. Ask for a new one.')
  // Anything else from the Auth API comes in English: the screen's own sentence says it in the app's language.
  return fallback
}

// The session is in; the app's own profile comes next, made on this first request when it is new.
// Then the same question a sign-in always asks about the data already on this device.
async function finishSignIn() {
  const { setUser, adoptProfile } = useStore.getState()
  let me
  try { me = await api('/api/me') }
  catch (e) {
    // An account the server will not take (no invite on an invite-only instance): signed out
    // again, so the next try starts clean.
    clearPending()
    await signOut()
    throw Object.assign(new Error(message(e.data || e, t('Sign-in failed'))), { shown: true })
  }
  clearPending()
  setUser(me.user, { adopt: true })
  await adoptProfile(askAddDeviceData)
  toast(t('Welcome, {0}', me.user.name))
}

export function SupaLogin() {
  const config = useStore(s => s.config)
  const inviteOnly = !!config?.invite_only
  const [mode, setMode] = useState('in')            // 'in' | 'up'
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(() => (takeLinkError() ? t('That link has expired or was already used. Ask for a new one.') : ''))
  const [sent, setSent] = useState('')
  const first = useRef(null)

  // Back from a sign-in link or a confirmation e-mail: finish it here.
  useEffect(() => {
    if (!pendingSignIn()) return
    setBusy(true)
    finishSignIn().catch(e => setErr(e.message)).finally(() => setBusy(false))
  }, [])

  const run = async fn => {
    setErr(''); setSent(''); setBusy(true)
    try { await fn() } catch (e) { setErr(e.shown ? e.message : message(e, mode === 'up' ? t('Registration failed') : t('Sign-in failed'))) }
    finally { setBusy(false) }
  }
  const needEmail = () => { if (!email.trim()) { setErr(t('Enter your e-mail address.')); first.current?.focus(); return false } return true }

  const submit = e => {
    e.preventDefault()
    if (!needEmail()) return
    if (mode === 'in') {
      if (!pw) { setErr(t('Enter your password.')); return }
      return run(async () => { await signIn(email, pw); await finishSignIn() })
    }
    if (!name.trim()) { setErr(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { setErr(t('An invite code is required')); return }
    if (pw.length < MIN_PASSWORD) { setErr(t('Use at least {0} characters.', MIN_PASSWORD)); return }
    if (pw !== again) { setErr(t('The two passwords are not the same.')); return }
    return run(async () => {
      const r = await signUp(email, pw, { name, invite: code })
      if (r.confirm) setSent(t('We sent a link to {0} to confirm your account. Open it on this device.', email.trim()))
      else await finishSignIn()
    })
  }
  const magic = () => {
    if (!needEmail()) return
    if (mode === 'up' && inviteOnly && !code.trim()) { setErr(t('An invite code is required')); return }
    run(async () => {
      await sendMagicLink(email, mode === 'up' ? { name, invite: code } : {})
      setSent(t('We sent a sign-in link to {0}. Open it on this device.', email.trim()))
    })
  }
  const forgot = () => {
    if (!needEmail()) return
    run(async () => {
      await sendPasswordReset(email)
      setSent(t('We sent a link to {0} to set a new password.', email.trim()))
    })
  }

  return <form onSubmit={submit} style={{ textAlign: 'start' }}>
    <Segmented options={[{ value: 'in', label: t('Sign in'), icon: 'key' }, { value: 'up', label: t('Create profile'), icon: 'plusCircle' }]}
      value={mode} onChange={v => { setMode(v); setErr(''); setSent('') }} />
    <div style={{ height: 12 }} />
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Sign in with your e-mail and password, or get a link by e-mail.')}</div>
    {mode === 'up' && <>
      <input className="input" placeholder={t('Your name')} maxLength={40} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} />
      <div style={{ height: 10 }} />
    </>}
    <input ref={first} className="input" type="email" name="email" autoComplete="email" inputMode="email" placeholder={t('E-mail address')}
      value={email} onChange={e => setEmail(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" name={mode === 'in' ? 'password' : 'new-password'} autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
      placeholder={mode === 'in' ? t('Password') : t('New password')} value={pw} onChange={e => setPw(e.target.value)} />
    {mode === 'up' && <>
      <div style={{ height: 10 }} />
      <input className="input" type="password" name="new-password-again" autoComplete="new-password" placeholder={t('Repeat the password')}
        value={again} onChange={e => setAgain(e.target.value)} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('At least {0} characters. A few unrelated words make a good one.', MIN_PASSWORD)}</div>
      {inviteOnly && <>
        <div style={{ height: 10 }} />
        <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
          onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
        <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
      </>}
    </>}
    {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
    {sent && <div className="card small" role="status" style={{ marginTop: 10 }}>{sent}</div>}
    <div style={{ height: 12 }} />
    <Button type="submit" variant="primary" disabled={busy}>{mode === 'in' ? t('Sign in') : t('Create profile')}</Button>
    <div style={{ height: 10 }} />
    <Button type="button" icon="envelope" onClick={magic} disabled={busy}>{t('Send me a sign-in link')}</Button>
    {mode === 'in' && <Button type="button" variant="ghost" className="dim" onClick={forgot} disabled={busy}>{t('Forgot your password?')}</Button>}
  </form>
}

// The sheet a password-reset link opens on: the new password, then on as usual.
function NewPasswordSheet({ close }) {
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async e => {
    e.preventDefault()
    if (pw.length < MIN_PASSWORD) { setErr(t('Use at least {0} characters.', MIN_PASSWORD)); return }
    if (pw !== again) { setErr(t('The two passwords are not the same.')); return }
    setBusy(true); setErr('')
    try { await setPassword(pw); toast(t('Your new password is saved.')); close() }
    catch (e2) { setErr(message(e2, t('Sign-in failed'))) }
    finally { setBusy(false) }
  }
  return <form onSubmit={save}>
    <h3>{t('Reset your password')}</h3>
    <input className="input" type="password" name="new-password" autoComplete="new-password" placeholder={t('New password')}
      value={pw} onChange={e => setPw(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" name="new-password-again" autoComplete="new-password" placeholder={t('Repeat the password')}
      value={again} onChange={e => setAgain(e.target.value)} />
    <div className="dim small" style={{ marginTop: 6 }}>{t('At least {0} characters. A few unrelated words make a good one.', MIN_PASSWORD)}</div>
    {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
    <div style={{ height: 12 }} />
    <Button type="submit" variant="primary" disabled={busy}>{t('Save')}</Button>
  </form>
}

// Opened once after a password-reset link brought the person back (lib/supa-auth.js takeRedirect).
export function useRecoveryPrompt() {
  const user = useStore(s => s.user)
  useEffect(() => {
    let wanted = false
    try { wanted = sessionStorage.getItem('gym_supa_recovery') === '1' } catch { /* private mode */ }
    if (!wanted || !user) return
    try { sessionStorage.removeItem('gym_supa_recovery') } catch { /* private mode */ }
    useUI.getState().openSheet(close => <NewPasswordSheet close={close} />)
  }, [user])
}

// Settings → Change password: the same sheet, for someone signed in.
export const openChangePassword = () => useUI.getState().openSheet(close => <NewPasswordSheet close={close} />)
