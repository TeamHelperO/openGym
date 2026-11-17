// The workout sheet editor's model: a plan in the app's share format (lib/plan-share.js),
// { routines: [{ id, name, ex: [{ id, sets, reps, weight, restSec, note }] }], week }.
// Pure, so the editor's moves are tested; the server cleans the result again (api/saas/training.js).

const LETTERS = 'ABCDEFGHIJKLMN'
export const newSheet = () => ({ routines: [{ id: 'r1', name: 'Treino A', ex: [] }], week: {} })

function nextRoutineId(plan) {
  const used = new Set(plan.routines.map(r => r.id))
  for (let i = 1; ; i++) if (!used.has('r' + i)) return 'r' + i
}
export function addRoutine(plan) {
  if (plan.routines.length >= 14) return plan
  const name = 'Treino ' + (LETTERS[plan.routines.length] || plan.routines.length + 1)
  return { ...plan, routines: [...plan.routines, { id: nextRoutineId(plan), name, ex: [] }] }
}
export function removeRoutine(plan, rid) {
  const week = {}
  for (const [d, ids] of Object.entries(plan.week || {})) {
    const left = ids.filter(x => x !== rid)
    if (left.length) week[d] = left
  }
  return { ...plan, routines: plan.routines.filter(r => r.id !== rid), week }
}
export const renameRoutine = (plan, rid, name) => ({ ...plan, routines: plan.routines.map(r => (r.id === rid ? { ...r, name } : r)) })

const mapEx = (plan, rid, fn) => ({ ...plan, routines: plan.routines.map(r => (r.id === rid ? { ...r, ex: fn(r.ex) } : r)) })
export const addExercise = (plan, rid, exId, defaults = {}) =>
  mapEx(plan, rid, ex => (ex.length >= 40 ? ex : [...ex, { id: exId, sets: 3, reps: 12, restSec: 60, ...defaults }]))
export const updateExercise = (plan, rid, idx, patch) => mapEx(plan, rid, ex => ex.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
export const removeExercise = (plan, rid, idx) => mapEx(plan, rid, ex => ex.filter((_, i) => i !== idx))
export function moveExercise(plan, rid, idx, dir) {
  return mapEx(plan, rid, ex => {
    const j = idx + dir
    if (j < 0 || j >= ex.length) return ex
    const out = ex.slice();
    [out[idx], out[j]] = [out[j], out[idx]]
    return out
  })
}
/** Toggle a routine on a weekday (0 = Sunday .. 6 = Saturday). */
export function toggleDay(plan, rid, day) {
  const week = { ...(plan.week || {}) }
  const cur = week[day] || []
  week[day] = cur.includes(rid) ? cur.filter(x => x !== rid) : [...cur, rid]
  if (!week[day].length) delete week[day]
  return { ...plan, week }
}
export const WEEKDAYS = [['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['0', 'Dom']]

/** Problems that would stop a save, in words for the trainer. */
export function sheetProblems(plan) {
  const out = []
  if (!plan.routines.length) out.push('Adicione pelo menos um treino.')
  plan.routines.forEach(r => { if (!r.ex.length) out.push(`"${r.name}" não tem exercícios.`) })
  return out
}
