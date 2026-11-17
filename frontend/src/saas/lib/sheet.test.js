import { describe, it, expect } from 'vitest'
import { newSheet, addRoutine, removeRoutine, addExercise, updateExercise, moveExercise, removeExercise, toggleDay, sheetProblems } from './sheet.js'

describe('workout sheet editor', () => {
  it('adds routines with the next letter and free ids', () => {
    let p = addRoutine(addRoutine(newSheet()))
    expect(p.routines.map(r => [r.id, r.name])).toEqual([['r1', 'Treino A'], ['r2', 'Treino B'], ['r3', 'Treino C']])
    p = removeRoutine(p, 'r2')
    expect(addRoutine(p).routines.at(-1).id).toBe('r2')
  })
  it('edits, moves and removes exercises', () => {
    let p = addExercise(addExercise(newSheet(), 'r1', '0001'), 'r1', '0025', { sets: 4 })
    p = updateExercise(p, 'r1', 0, { reps: 8, weight: 40 })
    expect(p.routines[0].ex[0]).toMatchObject({ id: '0001', sets: 3, reps: 8, weight: 40 })
    p = moveExercise(p, 'r1', 1, -1)
    expect(p.routines[0].ex.map(e => e.id)).toEqual(['0025', '0001'])
    expect(moveExercise(p, 'r1', 0, -1)).toEqual(p)
    p = removeExercise(p, 'r1', 0)
    expect(p.routines[0].ex.map(e => e.id)).toEqual(['0001'])
  })
  it('schedules routines on weekdays and drops them with the routine', () => {
    let p = addRoutine(newSheet())
    p = toggleDay(toggleDay(p, 'r1', '1'), 'r2', '1')
    expect(p.week).toEqual({ 1: ['r1', 'r2'] })
    p = toggleDay(p, 'r1', '1')
    expect(p.week).toEqual({ 1: ['r2'] })
    expect(removeRoutine(p, 'r2').week).toEqual({})
  })
  it('reports what blocks a save', () => {
    expect(sheetProblems(newSheet())).toEqual(['"Treino A" não tem exercícios.'])
    expect(sheetProblems({ routines: [], week: {} })).toEqual(['Adicione pelo menos um treino.'])
  })
})
