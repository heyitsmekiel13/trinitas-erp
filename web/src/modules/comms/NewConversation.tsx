import * as React from 'react'
import { Search, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createGroup, listDirectory, openDirect, type ChatConversation, type DirectoryEntry } from '@/lib/chatApi'
import { Avatar, Button, Field, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'

/**
 * Starting a conversation.
 *
 * One dialog for both cases rather than two, because the choice between "a
 * message to Maria" and "a group with Maria and Jose" is not a decision anybody
 * makes up front — it is just how many people they end up ticking. Pick one and
 * it opens the direct thread; pick two and it asks for a name.
 */
export function NewConversation({
  open,
  onClose,
  onOpened,
}: {
  open: boolean
  onClose: () => void
  /** Hands back the room that was created or found, so the page can select it. */
  onOpened: (conversation: ChatConversation) => void
}) {
  const toast = useToast()
  const [people, setPeople] = React.useState<DirectoryEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [picked, setPicked] = React.useState<number[]>([])
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return

    setQuery('')
    setPicked([])
    setName('')
    setLoading(true)

    void listDirectory()
      .then(setPeople)
      .catch((err) => toast({ tone: 'error', title: 'Could not load the directory.', description: (err as Error).message }))
      .finally(() => setLoading(false))
  }, [open, toast])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.department ?? '').toLowerCase().includes(q),
    )
  }, [people, query])

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const isGroup = picked.length > 1

  const submit = async () => {
    if (!picked.length) return

    setBusy(true)
    try {
      const conversation = isGroup
        ? await createGroup({ name: name.trim() || 'New group', memberIds: picked })
        : await openDirect(picked[0]!)

      onOpened(conversation)
      onClose()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not start that conversation.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New conversation"
      description="Pick one person for a direct message, or several to start a group."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!picked.length || busy}>
            {busy ? 'Opening…' : isGroup ? `Create group (${picked.length})` : 'Open conversation'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isGroup && (
          <Field label="Group name" hint="Shown to everyone in the room.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dispatch Coordination" />
          </Field>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people or departments…"
            className="pl-9"
            aria-label="Search people"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
          {loading ? (
            <p className="px-3 py-6 text-center text-xs text-ink-3">Loading the directory…</p>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Users} title="Nobody matches that" description="Try a different name or department." />
          ) : (
            <ul>
              {filtered.map((person) => {
                const checked = picked.includes(person.id)
                return (
                  <li key={person.id}>
                    <button
                      onClick={() => toggle(person.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0',
                        checked ? 'bg-brand-50 dark:bg-brand-950' : 'hover:bg-surface-3',
                      )}
                      aria-pressed={checked}
                    >
                      <Avatar name={person.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>
                        <span className="block truncate text-[11px] text-ink-3">{person.department ?? 'No department'}</span>
                      </span>
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold text-white',
                          checked ? 'grad-brand border-transparent' : 'border-line-strong',
                        )}
                      >
                        {checked ? '✓' : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
