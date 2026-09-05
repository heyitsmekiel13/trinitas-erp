import * as React from 'react'
import { LogOut, Search, UserMinus, UserPlus } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  addMembers,
  listDirectory,
  listMembers,
  removeMember,
  updateConversation,
  type ChatConversation,
  type ChatMember,
  type DirectoryEntry,
} from '@/lib/chatApi'
import { Avatar, Badge, Button, Field, Input, Switch } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * Who is in a room, and what may be changed about it.
 *
 * The controls shown are the ones the server will actually accept: renaming
 * needs group admin, a department room is named by the org chart, and a direct
 * thread has neither a name nor a membership to manage. Hiding what would be
 * refused is kinder than offering it and then failing.
 */
export function RoomDetails({
  conversation,
  open,
  onClose,
  onChanged,
  onLeft,
}: {
  conversation: ChatConversation
  open: boolean
  onClose: () => void
  onChanged: (conversation: ChatConversation) => void
  onLeft: () => void
}) {
  const toast = useToast()
  const [members, setMembers] = React.useState<ChatMember[]>([])
  const [directory, setDirectory] = React.useState<DirectoryEntry[]>([])
  const [adding, setAdding] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [name, setName] = React.useState(conversation.name)
  const [topic, setTopic] = React.useState(conversation.topic ?? '')
  const [busy, setBusy] = React.useState(false)

  const isGroup = conversation.kind === 'group'
  const isAdmin = conversation.role === 'admin'
  const canManage = isGroup && isAdmin

  React.useEffect(() => {
    if (!open) return

    setName(conversation.name)
    setTopic(conversation.topic ?? '')
    setAdding(false)
    setQuery('')

    void listMembers(conversation.id)
      .then(setMembers)
      .catch((err) => toast({ tone: 'error', title: 'Could not load the members.', description: (err as Error).message }))
  }, [open, conversation.id, conversation.name, conversation.topic, toast])

  React.useEffect(() => {
    if (!adding || directory.length) return
    void listDirectory().then(setDirectory).catch(() => setDirectory([]))
  }, [adding, directory.length])

  const candidates = React.useMemo(() => {
    const inRoom = new Set(members.map((m) => m.id))
    const q = query.trim().toLowerCase()
    return directory
      .filter((p) => !inRoom.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.department ?? '').toLowerCase().includes(q))
      .slice(0, 40)
  }, [directory, members, query])

  const saveDetails = async () => {
    setBusy(true)
    try {
      const updated = await updateConversation(conversation.id, {
        name: name.trim(),
        topic: topic.trim(),
      })
      onChanged(updated)
      toast({ tone: 'success', title: 'Group updated.' })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not save that.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const toggleMute = async (muted: boolean) => {
    try {
      const updated = await updateConversation(conversation.id, { muted })
      onChanged(updated)
    } catch (err) {
      toast({ tone: 'error', title: 'Could not change that.', description: (err as Error).message })
    }
  }

  const add = async (userId: number) => {
    try {
      const { conversation: updated } = await addMembers(conversation.id, [userId])
      onChanged(updated)
      setMembers(await listMembers(conversation.id))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not add them.', description: (err as Error).message })
    }
  }

  const remove = async (member: ChatMember, self: boolean) => {
    try {
      await removeMember(conversation.id, member.id)
      if (self) {
        onLeft()
        onClose()
        return
      }
      setMembers(await listMembers(conversation.id))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not remove them.', description: (err as Error).message })
    }
  }

  /** The signed-in reader's own row, so "Leave" knows which id to send. */
  const mine = members.find((m) => m.mine)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={conversation.name}
      description={
        conversation.kind === 'direct'
          ? 'Direct conversation'
          : conversation.kind === 'department'
            ? 'Department room — membership follows the org chart'
            : `Group · ${conversation.memberCount} ${conversation.memberCount === 1 ? 'member' : 'members'}`
      }
      size="md"
      footer={
        <>
          {isGroup && mine && (
            <Button variant="ghost" onClick={() => void remove(mine, true)} className="mr-auto text-critical">
              <LogOut className="size-4" />
              Leave group
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {canManage && (
            <Button onClick={() => void saveDetails()} disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {canManage && (
          <>
            <Field label="Group name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
            </Field>
            <Field label="Topic" hint="One line describing what this room is for.">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={255} />
            </Field>
          </>
        )}

        <Field label="Notifications" composite>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
            <span className="text-[13px] text-ink-2">
              Mute this conversation
              <span className="mt-0.5 block text-[11px] text-ink-3">
                It stays in your list, but stops counting toward the badge.
              </span>
            </span>
            <Switch checked={conversation.muted} onChange={(v) => void toggleMute(v)} label="Mute this conversation" />
          </label>
        </Field>

        {conversation.kind !== 'direct' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-ink-2">
                Members{members.length ? ` (${members.length})` : ''}
              </h3>
              {isGroup && (
                <Button variant="ghost" size="sm" onClick={() => setAdding((a) => !a)}>
                  <UserPlus className="size-3.5" />
                  {adding ? 'Done' : 'Add people'}
                </Button>
              )}
            </div>

            {adding && (
              <div className="mb-3 rounded-xl border border-line p-2">
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search people…"
                    className="pl-9"
                    aria-label="Search people to add"
                  />
                </div>
                <ul className="max-h-40 overflow-y-auto">
                  {candidates.length === 0 ? (
                    <li className="px-2 py-3 text-center text-xs text-ink-3">Everyone matching is already here.</li>
                  ) : (
                    candidates.map((p) => (
                      <li key={p.id}>
                        <button
                          onClick={() => void add(p.id)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-3"
                        >
                          <Avatar name={p.name} size="xs" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-ink">{p.name}</span>
                            <span className="block truncate text-[11px] text-ink-3">{p.department ?? '—'}</span>
                          </span>
                          <UserPlus className="size-3.5 shrink-0 text-ink-3" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}

            <ul className="max-h-56 space-y-0.5 overflow-y-auto">
              {members.map((member) => (
                <li
                  key={member.id}
                  className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-3')}
                >
                  <Avatar name={member.name} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{member.name}</span>
                  {member.role === 'admin' && <Badge tone="brand">Admin</Badge>}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void remove(member, false)}
                      aria-label={`Remove ${member.name}`}
                    >
                      <UserMinus className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
