/**
 * The vocabulary printed on the Fuel Purchase Order pad.
 *
 * Kept in one place because the request form, the printed sheet and the
 * approval dialog all render it, and a product list that drifts between the
 * three is a form that no longer matches the paper it replaced.
 *
 * Values are verbatim from the pad, punctuation included. "Diesel MAX" and
 * "Diesel - MAX" are the same fuel to the attendant reading it and two
 * different strings to a report grouped on them.
 */

/**
 * The station every order goes to.
 *
 * Retyping an identical value on every form is how a purchase order ends up
 * addressed to "Cherryfic Gas Servce Station" and gets refused at the counter.
 * Still editable — a second supplier is a change of default, not a rewrite.
 * Mirrored by FuelRequestController::DEFAULT_SUPPLIER, which applies it when
 * the field arrives empty from anywhere else.
 */
export const DEFAULT_SUPPLIER = 'Cherryfic Gas Service Station, Inc.'

export const FUEL_PRODUCTS = [
  'Diesel - MAX',
  'Diesel - TURBO',
  'Advance - XTRA',
  'XCS - EURO 4',
  'Lubricant',
  'Engine Oil',
  'Coolant',
] as const

/**
 * The three ownership boxes.
 *
 * The codes are what the pad prints and what everybody says out loud, so they
 * lead. The expansions are my reading of them — correct them here if the
 * business means something else by R&C.
 */
export const OWNERSHIP_CODES = [
  { value: 'CO', label: 'CO — Company-owned' },
  { value: 'PO', label: 'PO — Personally-owned' },
  { value: 'R&C', label: 'R&C — Rented or chartered' },
] as const

/**
 * Units the quantity can be expressed in.
 *
 * Litres for anything pumped, pieces and litres for what comes in a container.
 * A form ticking Lubricant and asking for "48 litres" is usually a form where
 * somebody left the unit alone.
 */
export const FUEL_UNITS = ['Litres', 'Pieces', 'Drums', 'Pails'] as const

/** Categories a purchase order is charged under. */
export const PO_CATEGORIES = [
  'Delivery',
  'Service call',
  'Hauling',
  'Administrative',
  'Emergency',
] as const
