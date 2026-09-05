<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'changes' => 'array',
            'occurred_at' => 'datetime',
        ];
    }

    /**
     * The exact fields — and exact order — the hash chain covers. Shared
     * between writing a row (AuditLogger) and verifying the chain
     * (AuditIntegrity) so the two can never quietly drift apart.
     */
    public function canonicalPayload(): string
    {
        return json_encode([
            'user_id' => $this->user_id,
            'user_label' => $this->user_label,
            'actor_type' => $this->actor_type,
            'action' => $this->action,
            'entity_type' => $this->entity_type,
            'entity_id' => $this->entity_id,
            'entity_label' => $this->entity_label,
            'module' => $this->module,
            'outcome' => $this->outcome,
            'changes' => $this->changes,
            'ip_address' => $this->ip_address,
            'user_agent' => $this->user_agent,
            'occurred_at' => $this->occurred_at?->toAtomString(),
            'request_id' => $this->request_id,
            'prev_hash' => $this->prev_hash,
        ], JSON_UNESCAPED_SLASHES);
    }
}
