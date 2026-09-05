<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The audit trail.
 *
 * Records who changed what, when, from where, and — as of this pass —
 * whether it actually succeeded, so a denied or failed action leaves the
 * same kind of trail a successful one does rather than vanishing. The acting
 * user's name is denormalised onto the row so the history stays readable
 * after an account is deleted — an audit trail that loses its subject is not
 * an audit trail.
 *
 * Every row also carries a hash of its own content plus the previous row's
 * hash — a hash chain. Altering or deleting any row, by any means other than
 * this class, breaks every hash that comes after it, which is what
 * `AuditIntegrity::verify()` checks for. That is a detection mechanism, not
 * a prevention one; prevention is the append-only DB triggers this table's
 * migration installs (where the DB user has the privilege to create them).
 */
class AuditLogger
{
    /** Never record these, whatever the model does with them. */
    private const REDACTED = ['password', 'remember_token', 'code_hash', 'atm_account'];

    /**
     * One id per HTTP request (or console invocation), so every row written
     * while handling it can be tied back together. Static rather than
     * request-bound state because this class is resolved fresh per request
     * under the normal PHP-FPM/php artisan serve lifecycle this app runs
     * under — a static property here does not leak across requests.
     */
    private static ?string $requestId = null;

    public function log(
        string $action,
        ?string $entityType = null,
        ?int $entityId = null,
        ?string $entityLabel = null,
        ?string $module = null,
        ?array $changes = null,
        string $outcome = 'success',
    ): void {
        $user = Auth::user();
        $request = request();

        $attributes = [
            'user_id' => $user?->id,
            'user_label' => $user?->name ?? ($this->actorType() === 'console' ? 'Console' : 'System'),
            'actor_type' => $this->actorType(),
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'entity_label' => $entityLabel,
            'module' => $module,
            'outcome' => $outcome,
            'changes' => $changes,
            'ip_address' => $request?->ip(),
            'user_agent' => Str::limit((string) $request?->userAgent(), 250, ''),
            'occurred_at' => now(),
            'request_id' => $this->requestId(),
        ];

        // Locks the one chain-state row for the length of this write, so two
        // requests logging at the same instant cannot both read the same
        // "previous hash" and fork the chain — see the migration that
        // creates `audit_chain_state` for why reading `audit_logs` itself
        // cannot give that guarantee.
        DB::transaction(function () use ($attributes) {
            $state = DB::table('audit_chain_state')->lockForUpdate()->first();

            $row = new AuditLog($attributes);
            $row->prev_hash = $state->last_hash;
            $row->hash = hash('sha256', $row->canonicalPayload());
            $row->save();

            DB::table('audit_chain_state')->update(['last_hash' => $row->hash, 'updated_at' => now()]);
        });
    }

    /** Logs a model change with a before/after diff of what actually moved. */
    public function logModel(string $action, Model $model, string $module, ?array $original = null): void
    {
        $changes = null;

        if ($original !== null) {
            $changes = [];
            foreach ($model->getChanges() as $field => $new) {
                if (in_array($field, self::REDACTED, true) || $field === 'updated_at') {
                    continue;
                }
                $changes[$field] = ['from' => $original[$field] ?? null, 'to' => $new];
            }

            if ($changes === []) {
                return;   // nothing meaningful changed
            }
        }

        $this->log(
            action: $action,
            entityType: class_basename($model),
            entityId: $model->getKey(),
            entityLabel: $this->labelFor($model),
            module: $module,
            changes: $changes,
        );
    }

    /** A denied or failed action — the counterpart to every other call here logging a success. */
    public function logDenied(
        string $action,
        ?string $module = null,
        ?string $entityLabel = null,
        string $outcome = 'denied',
    ): void {
        $this->log(action: $action, entityLabel: $entityLabel, module: $module, outcome: $outcome);
    }

    /** Best-effort human label — whichever identifying column the model has. */
    private function labelFor(Model $model): ?string
    {
        foreach (['name', 'full_name', 'title', 'code', 'order_no', 'po_no', 'invoice_no', 'run_no'] as $attribute) {
            if (filled($model->{$attribute} ?? null)) {
                return (string) $model->{$attribute};
            }
        }

        return null;
    }

    private function actorType(): string
    {
        if (app()->runningInConsole() && ! app()->runningUnitTests()) {
            return 'console';
        }

        return Auth::check() ? 'user' : 'system';
    }

    private function requestId(): string
    {
        return self::$requestId ??= (string) Str::uuid();
    }
}
