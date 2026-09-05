<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\URL;

class MessageAttachment extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'bytes' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
        ];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    /**
     * What sort of thing this is, from the browser's mime type.
     *
     * Decided on upload rather than on render, so the bubble does not have to
     * parse a mime string every time it draws. A type the browser cannot name
     * falls through to `file`, which is always safe to show as a chip.
     */
    public static function kindFor(?string $mime): string
    {
        return match (true) {
            str_starts_with((string) $mime, 'image/') => 'image',
            str_starts_with((string) $mime, 'video/') => 'video',
            str_starts_with((string) $mime, 'audio/') => 'audio',
            default => 'file',
        };
    }

    /**
     * A signed, expiring URL the browser can put straight in an <img>.
     *
     * Signed rather than token-guarded because an image tag cannot send an
     * Authorization header — a bearer-guarded route renders every photo as a
     * broken image. The signature does that job instead, and it is only ever
     * minted for somebody who has already passed the membership check on the
     * conversation.
     *
     * Six hours. Long enough to scroll back through a morning's thread,
     * short enough that a link pasted somewhere else stops working the same
     * day. Nothing is written under `public/`, so there is no permanent path
     * to find.
     */
    public function getUrlAttribute(): string
    {
        return URL::temporarySignedRoute('chat.attachment', now()->addHours(6), ['attachment' => $this->id]);
    }

    /** Human size for the file chip — "2.4 MB" beats "2519483". */
    public function getSizeLabelAttribute(): string
    {
        $bytes = (int) $this->bytes;

        return match (true) {
            $bytes >= 1_000_000 => number_format($bytes / 1_000_000, 1) . ' MB',
            $bytes >= 1_000 => number_format($bytes / 1_000, 0) . ' KB',
            default => $bytes . ' B',
        };
    }
}
