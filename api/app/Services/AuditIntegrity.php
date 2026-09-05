<?php

namespace App\Services;

use App\Models\AuditLog;

/**
 * Proves — or disproves — that the audit trail's hash chain is intact.
 *
 * Walks every row in id order and recomputes each one's hash from its own
 * content plus the previous row's hash, comparing that against what is
 * actually stored. A row that was altered after being written recomputes to
 * a different hash than the one stored on it; a row that was deleted breaks
 * the very next row's `prev_hash` link. Either shows up as a specific,
 * pinpointed failure rather than a vague "something looks wrong" — see
 * `AuditLog::canonicalPayload()` for exactly what is hashed.
 */
class AuditIntegrity
{
    /** @return array{valid: bool, checked: int, brokenAt: ?int, reason: ?string} */
    public function verify(): array
    {
        $checked = 0;
        $previousHash = null;
        $anchored = false;

        foreach (AuditLog::query()->orderBy('id')->cursor() as $row) {
            // Rows written before this hash chain existed have no hash at
            // all — not tampered, just out of the feature's reach. Skipped
            // rather than counted as broken.
            if ($row->hash === null) {
                continue;
            }

            $checked++;

            // The first hash-bearing row is the chain's anchor. Its own
            // `prev_hash` is trusted as given rather than required to be
            // null, because a legitimate `audit:purge` can remove the row
            // that hash actually belonged to — retention purging is a
            // sanctioned break in what remains readable, not tampering.
            // Every row after this one is held to the full standard: its
            // `prev_hash` must match the row immediately before it that is
            // still in the table.
            if (! $anchored) {
                $anchored = true;
            } elseif ($row->prev_hash !== $previousHash) {
                return [
                    'valid' => false,
                    'checked' => $checked,
                    'brokenAt' => $row->id,
                    'reason' => "Row {$row->id}'s prev_hash does not match the hash of the row before it — a row was inserted, removed, or reordered outside the application.",
                ];
            }

            $expected = hash('sha256', $row->canonicalPayload());

            if (! hash_equals($expected, (string) $row->hash)) {
                return [
                    'valid' => false,
                    'checked' => $checked,
                    'brokenAt' => $row->id,
                    'reason' => "Row {$row->id}'s content does not match its own recorded hash — it was altered after being written.",
                ];
            }

            $previousHash = $row->hash;
        }

        return ['valid' => true, 'checked' => $checked, 'brokenAt' => null, 'reason' => null];
    }
}
