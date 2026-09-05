<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One line in a conversation.
 *
 * `deleted_at` here is not Laravel's SoftDeletes — it deliberately is not, so
 * a withdrawn message still loads and renders as "this message was deleted"
 * the way Messenger does, rather than vanishing and leaving replies dangling.
 */
class Message extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_system' => 'boolean',
            'edited_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reply_to_id');
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(MessageReaction::class);
    }

    /** Files sent with this message. Ordered so a set of photos keeps its order. */
    public function attachments(): HasMany
    {
        return $this->hasMany(MessageAttachment::class)->orderBy('id');
    }

    public function hiddenBy(): HasMany
    {
        return $this->hasMany(MessageDeletion::class);
    }

    public function isWithdrawn(): bool
    {
        return $this->deleted_at !== null;
    }
}
