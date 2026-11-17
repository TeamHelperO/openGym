// Meal plan arithmetic for the editor and the student's day: portions from the TACO table (per
// 100 g), totals per meal and per day, and how far the day's plan is from its targets. Pure.

const r1 = n => Math.round((Number(n) || 0) * 10) / 10

/** An item of `grams` of a TACO food (values per 100 g). */
export function portion(food, grams) {
  const k = (Number(grams) || 0) / 100
  return {
    name: food.name, tacoId: food.id, grams: Number(grams) || 0,
    kcal: r1((food.kcal || 0) * k), protein: r1((food.protein || 0) * k), carbs: r1((food.carbs || 0) * k), fat: r1((food.fat || 0) * k)
  }
}
/** Same food, new amount: scales the stored values (works for typed-in foods too). */
export function regram(item, grams) {
  const g = Number(grams) || 0
  if (!item.grams) return { ...item, grams: g }
  const k = g / item.grams
  return { ...item, grams: g, kcal: r1(item.kcal * k), protein: r1(item.protein * k), carbs: r1(item.carbs * k), fat: r1(item.fat * k) }
}
export function sum(items) {
  return items.reduce((t, i) => ({ kcal: r1(t.kcal + (i.kcal || 0)), protein: r1(t.protein + (i.protein || 0)), carbs: r1(t.carbs + (i.carbs || 0)), fat: r1(t.fat + (i.fat || 0)) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 })
}
export const dayTotals = meals => sum(meals.flatMap(m => m.items || []))
/** Share of each macro in the day's calories (4/4/9 kcal per gram). */
export function macroSplit(t) {
  const kcal = t.protein * 4 + t.carbs * 4 + t.fat * 9
  if (!kcal) return { protein: 0, carbs: 0, fat: 0 }
  return { protein: Math.round((t.protein * 4 / kcal) * 100), carbs: Math.round((t.carbs * 4 / kcal) * 100), fat: Math.round((t.fat * 9 / kcal) * 100) }
}
/** Accent-insensitive search over the TACO names. */
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function searchFoods(foods, q, limit = 40) {
  const words = fold(q).split(/[\s,]+/).filter(Boolean)
  if (!words.length) return []
  return foods.filter(f => { const n = fold(f.name); return words.every(w => n.includes(w)) }).slice(0, limit)
}
let seq = 0
export const newMeal = (name, time = '') => ({ key: 'm' + Date.now().toString(36) + (seq++), name, time, items: [], notes: '' })
export const DEFAULT_MEALS = () => [newMeal('Café da manhã', '07:00'), newMeal('Lanche da manhã', '10:00'), newMeal('Almoço', '12:30'), newMeal('Lanche da tarde', '16:00'), newMeal('Jantar', '19:30')]
