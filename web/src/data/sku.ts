import { company } from '@/lib/company'

/**
 * The SKU naming convention.
 *
 *   PKE-EQP-0001
 *   │   │   └── sequence within the category, zero padded so codes sort
 *   │   └────── category — sorts the catalogue without opening it
 *   └────────── company prefix, so a code pasted into an email is unambiguous
 *
 * A running number (`TRN-1042`) tells you nothing without a lookup, and two
 * people naming the same new item invent two different codes. This is
 * derivable: given the category, everyone reaches the same prefix, and only the
 * sequence has to be issued.
 *
 * A fourth block carries the brand when there is one — `PKE-BEV-COR-0001` — for
 * catalogues where the brand is the second thing anyone asks. The imported
 * QuickBooks catalogue has no brand recorded, so it uses the three-block form
 * rather than stamping a filler value on two thousand codes.
 */

/** Initials of the trading name: "Premium Kitchen Equipment" → PKE. */
export function companyPrefix() {
  const initials = company()
    .name.split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .map((word) => word[0]!.toUpperCase())
    .join('')

  return initials.length >= 2 ? initials.slice(0, 4) : 'PKE'
}

export const CATEGORY_CODES: Record<string, string> = {
  // The imported catalogue.
  'Small Items': 'SML',
  'Spare Parts': 'SPR',
  Equipment: 'EQP',
  'Electrical Supplies': 'ELC',
  'Local Fabrication': 'FAB',
  'Construction Materials': 'CON',
  'Defective Units': 'DEF',
  'Service Unit': 'SVC',
  Convan: 'CVN',
  Uncategorised: 'GEN',

  // Retained so existing demo and trading categories keep their codes.
  Beverages: 'BEV',
  'Packaged Food': 'FOD',
  'Household Care': 'HHC',
  'Personal Care': 'PCR',
  'Industrial Supplies': 'IND',
  Electrical: 'ELC',
  'Safety & PPE': 'PPE',
  'Packaging Materials': 'PAK',
  Blinds: 'BLD',
  Fabric: 'FAB',
  'Motor Kits': 'MTR',
  'Curtain Accessories': 'CTA',
}

/** Strips accents and punctuation, then takes the first three letters. */
function alphaCode(value: string, fallback: string) {
  const cleaned = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
  return cleaned.length >= 3 ? cleaned.slice(0, 3) : (cleaned + fallback).slice(0, 3)
}

export function categoryCode(category: string) {
  return CATEGORY_CODES[category] ?? alphaCode(category, 'GEN')
}

export function brandCode(brand: string) {
  return alphaCode(brand || 'General', 'GEN')
}

/** Omits the brand block when there is no brand to put in it. */
export function buildSku(category: string, brand: string, sequence: number, prefix = companyPrefix()) {
  const blocks = [prefix, categoryCode(category)]
  if (brand.trim()) blocks.push(brandCode(brand))
  blocks.push(String(sequence).padStart(4, '0'))
  return blocks.join('-')
}

export type ParsedSku = { prefix: string; category: string; brand: string | null; sequence: number }

/** Accepts both the three-block and four-block forms. */
export function parseSku(sku: string): ParsedSku | null {
  const value = sku.trim().toUpperCase()

  const withBrand = /^([A-Z]{2,4})-([A-Z]{3})-([A-Z]{3})-(\d{3,5})$/.exec(value)
  if (withBrand) {
    return {
      prefix: withBrand[1]!,
      category: withBrand[2]!,
      brand: withBrand[3]!,
      sequence: Number(withBrand[4]),
    }
  }

  const plain = /^([A-Z]{2,4})-([A-Z]{3})-(\d{3,5})$/.exec(value)
  if (plain) {
    return { prefix: plain[1]!, category: plain[2]!, brand: null, sequence: Number(plain[3]) }
  }

  return null
}

/** The human name behind a category code, for reading a SKU back out loud. */
export function categoryForCode(code: string) {
  return Object.entries(CATEGORY_CODES).find(([, value]) => value === code)?.[0] ?? null
}
