/**
 * Deterministic pseudo-random source.
 *
 * Every dataset in the preview is generated from a fixed seed, so the numbers
 * on a dashboard are the same on every reload and across every machine —
 * screenshots, exports and demos stay reproducible.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private next: () => number

  constructor(seed: number) {
    this.next = mulberry32(seed)
  }

  float(min = 0, max = 1) {
    return min + this.next() * (max - min)
  }

  int(min: number, max: number) {
    return Math.floor(this.float(min, max + 1))
  }

  bool(probability = 0.5) {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!
  }

  /** Weighted pick: `weighted([['a', 3], ['b', 1]])` returns 'a' 75% of the time. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    let roll = this.next() * total
    for (const [value, weight] of entries) {
      roll -= weight
      if (roll <= 0) return value
    }
    return entries[entries.length - 1]![0]
  }

  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items]
    const out: T[] = []
    for (let i = 0; i < count && pool.length; i++) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]!)
    }
    return out
  }

  /** Roughly normal, clamped — gives believable spreads instead of flat noise. */
  gaussian(mean: number, stdDev: number, min = -Infinity, max = Infinity) {
    const u = 1 - this.next()
    const v = this.next()
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return Math.min(max, Math.max(min, mean + z * stdDev))
  }

  /** A date N days back from today, at a plausible working hour. */
  daysAgo(minDays: number, maxDays: number) {
    const d = new Date()
    d.setDate(d.getDate() - this.int(minDays, maxDays))
    d.setHours(this.int(8, 17), this.int(0, 59), 0, 0)
    return d
  }

  daysAhead(minDays: number, maxDays: number) {
    const d = new Date()
    d.setDate(d.getDate() + this.int(minDays, maxDays))
    d.setHours(this.int(8, 17), 0, 0, 0)
    return d
  }
}

/** Sequential document numbers: `docNo('SO', 2026, 41)` → "SO-2026-0041". */
export function docNo(prefix: string, year: number, index: number, pad = 4) {
  return `${prefix}-${year}-${String(index).padStart(pad, '0')}`
}

export const FIRST_NAMES = [
  'Maria', 'Jose', 'Angelo', 'Kristine', 'Rafael', 'Danilo', 'Liza', 'Miguel', 'Grace', 'Ramon',
  'Patricia', 'Enrique', 'Bernadette', 'Carlo', 'Jasmine', 'Noel', 'Cecilia', 'Arnel', 'Rowena', 'Victor',
  'Katherine', 'Emmanuel', 'Sheila', 'Ferdinand', 'Marilou', 'Julius', 'Divina', 'Reynaldo', 'Charmaine', 'Alfonso',
  'Teresa', 'Gerardo', 'Lourdes', 'Christian', 'Anna', 'Roberto', 'Michelle', 'Edgar', 'Vanessa', 'Nestor',
]

export const LAST_NAMES = [
  'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Aquino', 'Villanueva',
  'Ramos', 'Del Rosario', 'Castillo', 'Flores', 'Gonzales', 'Rivera', 'Domingo', 'Navarro', 'Salazar', 'Fernandez',
  'Alvarez', 'Corpuz', 'Pascual', 'Manalo', 'Espino', 'Lagman', 'Tolentino', 'Marquez', 'Yulo', 'Batac',
]

export function personName(rng: Rng) {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`
}

export const CITIES = [
  'Muntinlupa', 'Quezon City', 'Cebu City', 'Davao City', 'Makati', 'Pasig', 'Caloocan', 'Iloilo City',
  'Cagayan de Oro', 'Bacolod', 'Angeles', 'Baguio', 'Batangas City', 'General Santos', 'Zamboanga City', 'Naga',
]

export const REGIONS = ['NCR', 'Luzon', 'Visayas', 'Mindanao'] as const
export type Region = (typeof REGIONS)[number]

export function regionFor(city: string): Region {
  if (['Muntinlupa', 'Quezon City', 'Makati', 'Pasig', 'Caloocan'].includes(city)) return 'NCR'
  if (['Cebu City', 'Iloilo City', 'Bacolod'].includes(city)) return 'Visayas'
  if (['Davao City', 'Cagayan de Oro', 'General Santos', 'Zamboanga City'].includes(city)) return 'Mindanao'
  return 'Luzon'
}
