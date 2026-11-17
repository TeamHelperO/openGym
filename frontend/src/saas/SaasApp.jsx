// The management area (/gestao): academies, their people, training, money, supplies and shop.
// Its own wide layout and its own pt-BR text, outside the training app's tab bar and i18n packs.
import { createContext, useContext, useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom'
import { sa } from './api.js'
import { useLoad, Loading, LoadError, Toaster } from './ui.jsx'
import { ROLE_LABEL } from './lib/format.js'
import GymPicker from './views/GymPicker.jsx'
import Dashboard from './views/Dashboard.jsx'
import Members from './views/Members.jsx'
import MemberDetail from './views/MemberDetail.jsx'
import Workouts from './views/Workouts.jsx'
import WorkoutEditor from './views/WorkoutEditor.jsx'
import Finance from './views/Finance.jsx'
import Supplies from './views/Supplies.jsx'
import Pos from './views/Pos.jsx'
import GymSettings from './views/GymSettings.jsx'
import StudentHome from './views/StudentHome.jsx'
import Platform from './views/Platform.jsx'
import Access from './views/Access.jsx'
import { isPersonal, wordsFor } from './product.js'
import './saas.css'

const GymCtx = createContext(null)
export const useGym = () => useContext(GymCtx)

export function SourceFooter({ config }) {
  return <footer className="sa-foot">
    {config?.platformName || 'SteelDay Gestão'} · Software livre sob a licença AGPL-3.0, baseado no openGym. {' '}
    <a href={config?.sourceUrl || 'https://github.com/TeamHelperO/openGym'} target="_blank" rel="noreferrer">Código-fonte</a>
  </footer>
}

// [path, label, roles, icon, where]: where is 'both', 'academy' or 'personal'.
const NAV = [
  ['', 'Painel', ['gym_admin', 'trainer'], '◧'],
  ['', 'Minha academia', ['student'], '◧', 'academy'],
  ['', 'Meu acompanhamento', ['student'], '◧', 'personal'],
  ['alunos', 'Alunos', ['gym_admin', 'trainer'], '☺'],
  ['equipe', 'Equipe', ['gym_admin'], '✦', 'academy'],
  ['treinos', 'Fichas de treino', ['gym_admin', 'trainer'], '≡'],
  ['acesso', 'Catracas e acesso', ['gym_admin', 'trainer'], '⇥', 'academy'],
  ['pdv', 'PDV / Loja', ['gym_admin', 'trainer'], '⌂', 'academy'],
  ['financeiro', 'Financeiro', ['gym_admin'], '$'],
  ['insumos', 'Insumos e compras', ['gym_admin'], '▣', 'academy'],
  ['configuracoes', 'Configurações', ['gym_admin'], '⚙']
]

function GymLayout({ me }) {
  const { gymId } = useParams()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const g = useLoad(() => sa.get(`/gyms/${gymId}`), [gymId])
  useEffect(() => { setOpen(false) }, [gymId])
  if (g.loading && !g.data) return <div className="sa-shell"><Loading /></div>
  if (g.error) return <div className="sa-shell"><div className="sa-main"><LoadError error={g.error} /><button className="sa-btn" onClick={() => nav('/gestao')}>Voltar</button></div></div>
  const { gym, role, memberId } = g.data
  const personal = isPersonal(gym)
  const links = NAV.filter(n => n[2].includes(role) && (!n[4] || n[4] === (personal ? 'personal' : 'academy')))
  const ctx = { gym, role, memberId, me, base: `/gestao/a/${gym.id}`, reloadGym: g.reload, isAdmin: role === 'gym_admin' }
  const style = { '--sa-brand': gym.primary_color || '#2563eb' }
  return <GymCtx.Provider value={ctx}>
    <div className={'sa-shell' + (open ? ' menu-open' : '')} style={style}>
      <aside className="sa-side">
        <div className="sa-brand">
          {gym.logoUrl ? <img src={gym.logoUrl} alt="" /> : <div className="sa-brand-mark">{gym.name.slice(0, 1).toUpperCase()}</div>}
          <div><strong>{gym.name}</strong><small>{role === 'gym_admin' ? wordsFor(gym).admin : ROLE_LABEL[role]}</small></div>
        </div>
        <nav>
          {links.map(([to, label, , icon]) => <NavLink key={label} end={to === ''} to={to ? `${ctx.base}/${to}` : ctx.base} onClick={() => setOpen(false)}>
            <span className="sa-ico" aria-hidden="true">{icon}</span>{label}
          </NavLink>)}
        </nav>
        <div className="sa-side-foot">
          {(me.memberships.length > 1 || me.platformAdmin) && <NavLink to="/gestao" end>Trocar de {wordsFor(gym).space}</NavLink>}
          {me.platformAdmin && <NavLink to="/gestao/plataforma">Administração da plataforma</NavLink>}
          <NavLink to="/home">App de treino</NavLink>
        </div>
      </aside>
      <div className="sa-scrim" onClick={() => setOpen(false)} />
      <div className="sa-main">
        <div className="sa-topbar">
          <button type="button" className="sa-btn" aria-label="Menu" onClick={() => setOpen(o => !o)}>☰</button>
          <strong>{gym.name}</strong>
        </div>
        {gym.status === 'suspended' && <div className="sa-error">Esta academia está suspensa pela plataforma.</div>}
        <Routes>
          <Route index element={role === 'student' ? <StudentHome /> : <Dashboard />} />
          {role !== 'student' && <>
            <Route path="alunos" element={<Members kind="student" />} />
            <Route path="alunos/:memberId" element={<MemberDetail />} />
            <Route path="equipe" element={<Members kind="staff" />} />
            <Route path="equipe/:memberId" element={<MemberDetail />} />
            <Route path="treinos" element={<Workouts />} />
            <Route path="treinos/:workoutId" element={<WorkoutEditor />} />
            <Route path="pdv" element={<Pos />} />
            <Route path="acesso" element={<Access />} />
          </>}
          {role === 'gym_admin' && <>
            <Route path="financeiro" element={<Finance />} />
            <Route path="insumos" element={<Supplies />} />
            <Route path="configuracoes" element={<GymSettings />} />
          </>}
          <Route path="*" element={<Navigate to={ctx.base} replace />} />
        </Routes>
        <SourceFooter config={me.config} />
      </div>
    </div>
    <Toaster />
  </GymCtx.Provider>
}

export default function SaasApp() {
  const me = useLoad(() => sa.get('/me'), [])
  useEffect(() => {
    document.body.classList.add('saas-wide')
    return () => document.body.classList.remove('saas-wide')
  }, [])
  if (me.loading && !me.data) return <div className="sa-shell"><Loading /></div>
  if (me.error) return <div className="sa-shell"><div className="sa-main"><LoadError error={me.error} retry={me.reload} /></div></div>
  return <Routes>
    <Route index element={<><GymPicker me={me.data} reload={me.reload} /><Toaster /></>} />
    <Route path="plataforma" element={me.data.platformAdmin ? <><Platform me={me.data} /><Toaster /></> : <Navigate to="/gestao" replace />} />
    <Route path="a/:gymId/*" element={<GymLayout me={me.data} />} />
    <Route path="*" element={<Navigate to="/gestao" replace />} />
  </Routes>
}
