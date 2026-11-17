// Physical assessment helpers: the measurement sites, body mass index and waist-to-hip ratio,
// and the difference between two assessments. Pure.

export const PERIMETERS = [
  ['neck', 'Pescoço'], ['shoulders', 'Ombros'], ['chest', 'Tórax'],
  ['arm_r', 'Braço direito (relaxado)'], ['arm_l', 'Braço esquerdo (relaxado)'],
  ['arm_r_contracted', 'Braço direito (contraído)'], ['arm_l_contracted', 'Braço esquerdo (contraído)'],
  ['forearm_r', 'Antebraço direito'], ['forearm_l', 'Antebraço esquerdo'],
  ['waist', 'Cintura'], ['abdomen', 'Abdômen'], ['hip', 'Quadril'],
  ['thigh_r', 'Coxa direita'], ['thigh_l', 'Coxa esquerda'], ['calf_r', 'Panturrilha direita'], ['calf_l', 'Panturrilha esquerda']
]
export const BIO = [
  ['fat_pct', '% de gordura', '%'], ['fat_kg', 'Massa gorda', 'kg'], ['lean_kg', 'Massa magra', 'kg'], ['muscle_kg', 'Massa muscular', 'kg'],
  ['water_pct', 'Água corporal', '%'], ['bone_kg', 'Massa óssea', 'kg'], ['visceral', 'Gordura visceral', 'nível'],
  ['bmr_kcal', 'Taxa metabólica basal', 'kcal'], ['metabolic_age', 'Idade metabólica', 'anos']
]

export function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null
  const m = heightCm / 100
  return Math.round((weightKg / (m * m)) * 10) / 10
}
export function bmiLabel(v) {
  if (v == null) return ''
  if (v < 18.5) return 'abaixo do peso'
  if (v < 25) return 'peso adequado'
  if (v < 30) return 'sobrepeso'
  if (v < 35) return 'obesidade grau I'
  if (v < 40) return 'obesidade grau II'
  return 'obesidade grau III'
}
export const waistHip = a => (a?.perimeters?.waist && a?.perimeters?.hip ? Math.round((a.perimeters.waist / a.perimeters.hip) * 100) / 100 : null)

/** Rows of [label, unit, first, last, change] for everything both assessments have. */
export function compare(first, last) {
  if (!first || !last) return []
  const rows = []
  const add = (label, unit, a, b) => { if (a != null && b != null) rows.push({ label, unit, first: a, last: b, change: Math.round((b - a) * 100) / 100 }) }
  add('Peso', 'kg', first.weight_kg, last.weight_kg)
  add('IMC', '', bmi(first.weight_kg, first.height_cm || last.height_cm), bmi(last.weight_kg, last.height_cm || first.height_cm))
  for (const [k, l] of PERIMETERS) add(l, 'cm', first.perimeters?.[k], last.perimeters?.[k])
  for (const [k, l, u] of BIO) add(l, u, first.bio?.[k], last.bio?.[k])
  return rows
}
/** A series over time for one measure: [{ date, value }], oldest first. */
export function series(assessments, pick) {
  return [...assessments].sort((a, b) => (a.date < b.date ? -1 : 1)).map(a => ({ date: a.date, value: pick(a) })).filter(p => p.value != null)
}
