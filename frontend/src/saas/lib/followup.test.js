import { describe, it, expect } from 'vitest'
import { portion, regram, dayTotals, macroSplit, searchFoods } from './nutrition.js'
import { bmi, bmiLabel, waistHip, compare, series } from './assessment.js'
import { TACO } from './taco.js'

describe('nutrition', () => {
  it('portions TACO foods per gram and totals the day', () => {
    const arroz = TACO.find(f => f.name === 'Arroz, tipo 1, cozido')
    const p = portion(arroz, 150)
    expect(p).toMatchObject({ grams: 150, kcal: 192.5, carbs: 42.2 })
    expect(regram(p, 75).kcal).toBe(96.3)
    const t = dayTotals([{ items: [p] }, { items: [{ kcal: 100, protein: 20, carbs: 0, fat: 2 }] }])
    expect(t.kcal).toBe(292.5)
    expect(macroSplit({ protein: 25, carbs: 50, fat: 11 })).toEqual({ protein: 25, carbs: 50, fat: 25 })
  })
  it('searches names without caring for accents or order', () => {
    expect(searchFoods(TACO, 'feijao carioca cozido').map(f => f.name)).toContain('Feijão, carioca, cozido')
    expect(searchFoods(TACO, '')).toEqual([])
  })
  it('has the whole table', () => { expect(TACO.length).toBe(597) })
})

describe('assessment', () => {
  it('computes BMI and waist-to-hip', () => {
    expect(bmi(70, 175)).toBe(22.9)
    expect(bmiLabel(22.9)).toBe('peso adequado')
    expect(bmiLabel(31)).toBe('obesidade grau I')
    expect(waistHip({ perimeters: { waist: 80, hip: 100 } })).toBe(0.8)
  })
  it('compares two assessments and builds a series', () => {
    const a = { date: '2026-10-01', weight_kg: 70, height_cm: 165, perimeters: { waist: 80 }, bio: { fat_pct: 28 } }
    const b = { date: '2026-11-01', weight_kg: 68, perimeters: { waist: 76, hip: 99 }, bio: { fat_pct: 26 } }
    const rows = compare(a, b)
    expect(rows.find(r => r.label === 'Peso').change).toBe(-2)
    expect(rows.find(r => r.label === 'Cintura').change).toBe(-4)
    expect(rows.find(r => r.label === 'Quadril')).toBeUndefined()
    expect(series([b, a], x => x.weight_kg).map(p => p.value)).toEqual([70, 68])
  })
})
