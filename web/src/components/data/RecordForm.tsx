import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { API_BASE_URL } from '@/lib/api'
import { ApiError, createRecord, updateRecord } from '@/lib/adminApi'
import { money } from '@/lib/format'
import {
  Button,
  Combobox,
  Field,
  Input,
  RadioGroup,
  Select,
  Switch,
  Textarea,
  type ComboOption,
} from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'
import { AddressField, type AddressValues } from './AddressField'
import {
  JournalLinesEditor,
  LineItemsEditor,
  lineTotal,
  stripUids,
  withUids,
  type Line,
  type LineConfig,
} from './LineItems'

export type { LineConfig } from './LineItems'

/**
 * Schema-driven record forms.
 *
 * A module declares its fields once and gets create, edit and validation for
 * free — the same idea as the column builders, so a form and its table always
 * describe the same record. Validation messages come from the API, which means
 * the screen can never disagree with what the server will accept.
 *
 * Fields carry a `section`, and the form groups them under headings in the
 * declared order. A twenty-field document then reads as four short blocks
 * rather than one wall of inputs.
 */

/**
 * Reads a switch's seed value, whatever shape the list endpoint sent it in.
 *
 * Several registry entries publish their flags as `YES` / `NO`, because that
 * is what the AUB masterfile and the exports need to say. The edit form is
 * seeded from that same payload, and `Boolean('NO')` is `true` — so every one
 * of those switches opened in the on position regardless of the record, and
 * saving posted the string back to a `boolean` rule that rejects it. An
 * employee with any statutory exemption recorded could not be saved at all:
 * the four validation messages were the only sign, and they sat far below the
 * field the person had actually come to change.
 *
 * Handled here rather than in the employee form because the YES/NO projection
 * belongs to the registry and any resource may use it.
 */
function toBoolean(value: unknown): boolean {
  if (typeof value === 'string') {
    return ['yes', 'true', '1', 'y'].includes(value.trim().toLowerCase())
  }

  return Boolean(value)
}

export type FieldOption = { value: string | number; label: string; sublabel?: string }

export type FormField = {
  name: string
  label: string
  /**
   * `address` is a composite: one declaration renders the whole delivery
   * address block and resolves its coordinates. It owns several value keys
   * rather than the single one named by `name`.
   */
  type?: 'text' | 'number' | 'money' | 'date' | 'select' | 'textarea' | 'switch' | 'email' | 'tel' | 'percent' | 'address'
  required?: boolean
  hint?: string
  placeholder?: string
  /** Groups the field under a heading. Fields without one lead the form. */
  section?: string
  /** Static choices. Use `optionsFrom` to load them from another endpoint. */
  options?: FieldOption[]
  /** Pulls choices from a registry endpoint, e.g. { endpoint, label, value }. */
  optionsFrom?: {
    endpoint: string
    label: string
    value?: string
    /** Second field shown faintly beside the label — a code, a city, a status. */
    sublabel?: string
    /** Narrows the list from another field's value, e.g. orders for the chosen customer. */
    filterBy?: { field: string; on: string }
  }
  /** Full width in the two-column grid. */
  full?: boolean
  min?: number
  max?: number
  step?: number
  /** Hides the field unless the predicate passes — used for dependent fields. */
  visibleWhen?: (values: Record<string, unknown>) => boolean
  /** Recomputes other fields when this one changes. */
  onChange?: (value: unknown, values: Record<string, unknown>) => Record<string, unknown>
  /**
   * Formats the value as it is typed — a TIN, a phone number.
   *
   * The mask shapes what is stored, not just what is shown, so the record and
   * the screen never disagree about where the dashes go.
   */
  mask?: MaskName
}

/**
 * Everything the address block reads and writes.
 *
 * Declared once so seeding an edit and saving it agree about what an address
 * consists of. The coordinates and the geocode metadata are in here because
 * they belong to the address even though nobody types them.
 */
const ADDRESS_KEYS = [
  'address', 'barangay', 'city', 'province', 'postalCode',
  'latitude', 'longitude', 'geocodeSource', 'geocodePrecision', 'geocodeLabel',
] as const

/** A select becomes searchable past this many choices. */
const SEARCHABLE_THRESHOLD = 8

/**
 * A short list is laid out in full rather than hidden behind a dropdown.
 *
 * Four is the ceiling on purpose: beyond that the options wrap onto a second
 * line and stop being faster to read than a select.
 */
const RADIO_THRESHOLD = 4

/* -------------------------------------------------------------------------- */
/* Input masks                                                                 */
/* -------------------------------------------------------------------------- */

export type MaskName = 'tin' | 'phonePH'

/**
 * Masks for the two formats people get wrong constantly.
 *
 * Each is forgiving on input — paste a TIN with no dashes, or a mobile number
 * with +63 already on it, and it lands correctly formatted. Guiding as they
 * type beats rejecting them after they press save.
 */
const MASKS: Record<MaskName, { format: (raw: string) => string; placeholder: string; hint: string }> = {
  // BIR taxpayer identification: 3-3-3 with an optional 5-digit branch code.
  tin: {
    format: (raw) => {
      const digits = raw.replace(/\D/g, '').slice(0, 14)
      const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9), digits.slice(9)]
      return parts.filter(Boolean).join('-')
    },
    placeholder: '000-000-000-00000',
    hint: 'Nine digits, plus the branch code if there is one.',
  },
  // Philippine mobile and landline, normalised to +63.
  phonePH: {
    format: (raw) => {
      let digits = raw.replace(/\D/g, '')
      if (digits.startsWith('63')) digits = digits.slice(2)
      if (digits.startsWith('0')) digits = digits.slice(1)
      digits = digits.slice(0, 10)
      if (!digits) return ''

      const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)]
      return `+63 ${parts.filter(Boolean).join(' ')}`.trimEnd()
    },
    placeholder: '+63 917 000 0000',
    hint: 'Mobile or landline — 0 and +63 are both fine.',
  },
}

/* -------------------------------------------------------------------------- */
/* Option loading                                                              */
/* -------------------------------------------------------------------------- */

/** Raw rows from an options endpoint, cached across every form that uses it. */
function useOptionRows(endpoint?: string) {
  const { data } = useQuery({
    queryKey: ['options', endpoint],
    enabled: Boolean(endpoint),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const token = (() => {
        try {
          return JSON.parse(localStorage.getItem('trinitas.auth') ?? '{}')?.state?.token
        } catch {
          return null
        }
      })()

      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        headers: {
          Accept: 'application/json',
          ...(token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!response.ok) return []
      const body = await response.json()
      return (body?.data ?? []) as Record<string, unknown>[]
    },
  })

  return data ?? []
}

function useOptions(source: FormField['optionsFrom'], values: Record<string, unknown>) {
  const rows = useOptionRows(source?.endpoint)

  return React.useMemo<FieldOption[]>(() => {
    if (!source) return []

    // A dependent picker shows nothing until its parent is chosen, rather than
    // offering orders that belong to a different customer.
    const filter = source.filterBy
    const parent = filter ? values[filter.field] : undefined
    const scoped =
      filter && parent != null && parent !== ''
        ? rows.filter((row) => String(row[filter.on] ?? '') === String(parent))
        : filter
          ? []
          : rows

    return scoped.map((row) => ({
      value: row[source.value ?? 'id'] as string | number,
      label: String(row[source.label] ?? ''),
      sublabel: source.sublabel ? (row[source.sublabel] == null ? undefined : String(row[source.sublabel])) : undefined,
    }))
  }, [rows, source, values])
}

/* -------------------------------------------------------------------------- */
/* One field                                                                   */
/* -------------------------------------------------------------------------- */

function FieldControl({
  field,
  value,
  values,
  error,
  errors,
  onChange,
  onPatch,
}: {
  field: FormField
  value: unknown
  values: Record<string, unknown>
  error?: string
  /** All field errors — the composite controls own more than one. */
  errors?: Record<string, string[]>
  onChange: (value: unknown) => void
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const loaded = useOptions(field.optionsFrom, values)
  const options = field.options ?? loaded
  const searchable = Boolean(field.optionsFrom) || options.length > SEARCHABLE_THRESHOLD

  // Owns a block of fields rather than one, so it sits outside the usual
  // label-and-control wrapper entirely.
  if (field.type === 'address') {
    return (
      <AddressField
        values={values as AddressValues}
        onPatch={onPatch}
        errors={{
          address: errors?.address?.[0],
          barangay: errors?.barangay?.[0],
          city: errors?.city?.[0],
          province: errors?.province?.[0],
          postalCode: errors?.postalCode?.[0],
        }}
      />
    )
  }

  const control = () => {
    switch (field.type) {
      case 'select':
        if (searchable) {
          return (
            <Combobox
              value={value as string | number | null}
              options={options as ComboOption[]}
              onChange={onChange}
              allowClear={!field.required}
              placeholder={field.placeholder ?? (field.required ? 'Choose…' : 'None')}
              emptyLabel={
                field.optionsFrom?.filterBy && !values[field.optionsFrom.filterBy.field]
                  ? 'Choose the customer first'
                  : 'No matches'
              }
            />
          )
        }
        // A required choice between a few things is laid out in full: the
        // options are the question, so hiding them behind a click makes the
        // form ask something it could simply have shown.
        if (field.required && options.length > 1 && options.length <= RADIO_THRESHOLD) {
          return (
            <RadioGroup
              name={field.name}
              value={value as string | number | null}
              options={options}
              onChange={onChange}
            />
          )
        }

        return (
          <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
            <option value="">{field.required ? 'Choose…' : 'None'}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )

      case 'switch':
        return (
          <div className="flex h-9 items-center">
            <Switch checked={Boolean(value)} onChange={onChange} label={field.label} />
          </div>
        )

      case 'textarea':
        return (
          <Textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
        )

      case 'money':
      case 'percent':
      case 'number':
        // Numbers are right-aligned and carry their unit inside the box, so a
        // column of amounts lines up and the field says what it wants.
        return (
          <div className="relative">
            {field.type === 'money' && (
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3">₱</span>
            )}
            <Input
              type="number"
              inputMode="decimal"
              className={cn(
                'tabular text-right',
                field.type === 'money' && 'pl-7',
                field.type === 'percent' && 'pr-7',
              )}
              value={value === null || value === undefined ? '' : String(value)}
              min={field.min}
              max={field.max}
              step={field.step ?? (field.type === 'number' ? 1 : 0.01)}
              placeholder={field.placeholder}
              onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            />
            {field.type === 'percent' && (
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-3">%</span>
            )}
          </div>
        )

      case 'date':
        return (
          <Input
            type="date"
            // The API sends ISO timestamps; a date input needs yyyy-mm-dd.
            value={value ? String(value).slice(0, 10) : ''}
            onChange={(e) => onChange(e.target.value || null)}
          />
        )

      default: {
        const mask = field.mask ? MASKS[field.mask] : null

        return (
          <Input
            type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
            inputMode={field.mask ? 'numeric' : undefined}
            value={String(value ?? '')}
            placeholder={field.placeholder ?? mask?.placeholder}
            // The mask formats what is stored, so the value never disagrees
            // with what is on screen.
            onChange={(e) => onChange(mask ? mask.format(e.target.value) : e.target.value)}
          />
        )
      }
    }
  }

  const mask = field.mask ? MASKS[field.mask] : null

  return (
    <Field
      label={field.label}
      required={field.required}
      hint={field.hint ?? mask?.hint}
      error={error}
      composite={
        // A label may only wrap one control. These are several.
        (field.type === 'select' && (searchable || (field.required && options.length > 1 && options.length <= RADIO_THRESHOLD))) ||
        field.type === 'money' ||
        field.type === 'percent'
      }
      className={cn(field.full && 'sm:col-span-2')}
      // Lets the form find the first thing to fix after a failed save.
      data-invalid={error ? 'true' : undefined}
    >
      {control()}
    </Field>
  )
}

/* -------------------------------------------------------------------------- */
/* The form                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turns the API's line errors into a sentence naming the row.
 *
 * Laravel reports these as `lines.2.quantity`, which is precise and unreadable.
 * "Check the line items below" was worse — it told somebody with fifteen rows
 * that one of them was wrong and left them to find it. This says which.
 */
function lineError(errors: Record<string, string[]>): string | undefined {
  const key = Object.keys(errors).find((k) => k.startsWith('lines.'))
  if (!key) return undefined

  const [, index] = key.split('.')
  const message = errors[key]?.[0] ?? 'This line is not valid.'
  const row = Number(index)

  return Number.isFinite(row) ? `Line ${row + 1}: ${message}` : message
}

/** Splits fields into their declared sections, preserving order. */
function groupSections(fields: FormField[]) {
  const groups: { title: string | null; fields: FormField[] }[] = []

  for (const field of fields) {
    const title = field.section ?? null
    const last = groups[groups.length - 1]
    if (last && last.title === title) last.fields.push(field)
    else groups.push({ title, fields: [field] })
  }

  return groups
}

export function RecordForm({
  open,
  onClose,
  onSaved,
  endpoint,
  title,
  fields,
  lines,
  record,
  defaults = {},
  extras,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  endpoint: string
  /** Singular noun, e.g. "customer". Used in headings and messages. */
  title: string
  fields: FormField[]
  lines?: LineConfig
  /** Present when editing; absent when creating. */
  record?: Record<string, unknown> | null
  defaults?: Record<string, unknown>
  /**
   * Module-specific content rendered below the fields — a live calculation, a
   * map, a warning. Receives the current values so it can react as the form is
   * filled in.
   */
  extras?: (values: Record<string, unknown>) => React.ReactNode
}) {
  const toast = useToast()
  const editing = Boolean(record?.id)

  const [values, setValues] = React.useState<Record<string, unknown>>({})
  const [lineItems, setLineItems] = React.useState<Line[]>([])
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [saving, setSaving] = React.useState(false)
  const [failure, setFailure] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const formId = React.useId()

  // Seed the form whenever it opens, so a cancelled edit never leaks into the
  // next one.
  React.useEffect(() => {
    if (!open) return

    const seeded: Record<string, unknown> = { ...defaults }
    for (const field of fields) {
      // A composite owns a block of keys, not the one it is declared under.
      const owned = field.type === 'address' ? ADDRESS_KEYS : [field.name]

      for (const key of owned) {
        const seed = record?.[key] ?? defaults[key] ?? null
        seeded[key] = field.type === 'switch' ? toBoolean(seed) : seed
      }
    }
    setValues(seeded)
    // `lineItems` is the document's actual lines. Deliberately not `lines` —
    // on most documents that is the line *count* column, and treating a number
    // as an array is how editing a transfer used to fail before it opened.
    // Rows arrive from the API without identity; the editor keys on one, so
    // it is given here rather than falling back to the array index.
    setLineItems(Array.isArray(record?.lineItems) ? withUids(record.lineItems as Line[]) : [])
    setErrors({})
    setFailure('')
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record])

  const setValue = (field: FormField, value: unknown) => {
    setDirty(true)
    setValues((current) => {
      const next = { ...current, [field.name]: value }
      return field.onChange ? { ...next, ...field.onChange(value, next) } : next
    })
  }

  /** Writes several values at once, for controls that own a block of fields. */
  const patchValues = React.useCallback((patch: Record<string, unknown>) => {
    setDirty(true)
    setValues((current) => ({ ...current, ...patch }))
  }, [])

  const editLines = (next: Line[]) => {
    setDirty(true)
    setLineItems(next)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    setFailure('')

    const payload: Record<string, unknown> = { ...values }

    // A switch is a boolean to the API whatever it arrived as. Seeding already
    // coerces, but a field's `onChange` can write any key it likes into
    // `values`, so the guarantee is made here too — at the boundary the rule
    // is actually enforced on.
    for (const field of fields) {
      if (field.type === 'switch') {
        payload[field.name] = toBoolean(payload[field.name])
      }
    }

    // The row ids are a client-side concern and have no column to land in.
    if (lines) payload.lines = stripUids(lineItems)

    try {
      if (editing) await updateRecord(endpoint, record!.id as number, payload)
      else await createRecord(endpoint, payload)

      toast({ tone: 'success', title: editing ? `${title} updated` : `${title} created` })
      onSaved()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.errors).length) {
        setErrors(e.errors)
        // Scroll the first bad field into view and focus it. A validation
        // message three sections below the fold is the same as no message.
        requestAnimationFrame(() => {
          const first = document.querySelector<HTMLElement>(`#${CSS.escape(formId)} [data-invalid="true"]`)
          first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          first?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
        })
      } else {
        setFailure((e as Error).message)
      }
    } finally {
      setSaving(false)
    }
  }

  const visible = fields.filter((f) => !f.visibleWhen || f.visibleWhen(values))
  const sections = groupSections(visible)
  const documentTotal = lineItems.reduce((sum, l) => sum + lineTotal(l), 0)

  /**
   * Whether the footer is the one showing the grand total.
   *
   * Cost-priced documents price their lines from the item master and journals
   * total two sides — neither is a single figure the footer can state, so for
   * those the editor keeps its own.
   */
  const footerShowsTotal = Boolean(
    lines && !lines.readOnlyPrice && lines.kind !== 'journal' && lineItems.length > 0,
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={dirty && !saving}
      size={lines ? 'lg' : 'md'}
      title={editing ? `Edit ${title}` : `New ${title}`}
      description={
        editing
          ? String(record?.code ?? record?.no ?? record?.name ?? '')
          : `Fields marked with an asterisk are required.`
      }
      footer={
        <>
          {/* Stays put while the lines scroll, so the figure somebody is about
              to commit to is on screen when they reach for the button. */}
          {footerShowsTotal && (
            <span className="mr-auto text-[13px] text-ink-2">
              Total <strong className="tabular text-[15px] text-ink">{money(documentTotal)}</strong>
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" size="sm" loading={saving}>
            {editing ? 'Save changes' : `Create ${title}`}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5">
        {sections.map((section, i) => (
          <section key={section.title ?? `lead-${i}`}>
            {section.title && (
              <h3 className="mb-2.5 border-b border-line pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
                {section.title}
              </h3>
            )}
            <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {section.fields.map((field) => (
                <FieldControl
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  values={values}
                  error={errors[field.name]?.[0]}
                  errors={errors}
                  onChange={(value) => setValue(field, value)}
                  onPatch={patchValues}
                />
              ))}
            </div>
          </section>
        ))}

        {lines && (
          <div className="grid sm:grid-cols-2">
            {lines.kind === 'journal' ? (
              <JournalLinesEditor config={lines} lines={lineItems} onChange={editLines} error={lineError(errors)} />
            ) : (
              <LineItemsEditor
                config={lines}
                lines={lineItems}
                onChange={editLines}
                error={lineError(errors)}
                // The footer carries the total for priced documents, so the
                // editor does not repeat it directly above.
                showGrandTotal={!footerShowsTotal}
              />
            )}
          </div>
        )}

        {extras?.(values)}

        {failure && (
          <p className="rounded-lg bg-critical/10 p-2.5 text-xs text-critical ring-1 ring-critical/25 ring-inset">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  )
}
