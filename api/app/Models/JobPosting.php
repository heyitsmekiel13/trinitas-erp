<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * A published vacancy — the outward-facing half of a manpower request.
 *
 * The slug is the URL a candidate is sent, so it is derived from the title
 * once and then left alone: a posting that has been shared on Facebook cannot
 * change its address because somebody fixed a typo in the heading.
 */
class JobPosting extends Model
{
    use SoftDeletes;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'published_at' => 'datetime',
            'closes_on' => 'date',
            'salary_visible' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $posting) {
            if (! $posting->slug) {
                $posting->slug = self::uniqueSlug($posting->title ?? 'role');
            }
        });
    }

    /**
     * A readable, permanent address. Collisions get a short numeric suffix.
     *
     * Checked against archived adverts too. The unique index on `slug` does
     * not care that a row is soft-deleted, so without `withTrashed()` the
     * first advert raised after archiving one of the same name would be
     * refused by the database with a constraint error nobody could act on.
     */
    public static function uniqueSlug(string $title): string
    {
        $base = Str::slug(Str::limit($title, 90, '')) ?: 'role';
        $slug = $base;
        $n = 2;

        while (self::withTrashed()->where('slug', $slug)->exists()) {
            $slug = "{$base}-{$n}";
            $n++;
        }

        return $slug;
    }

    /** Live to the outside world: published, and not past its closing date. */
    public function isOpen(): bool
    {
        return $this->status === 'Published'
            && (! $this->closes_on || $this->closes_on->endOfDay()->isFuture());
    }

    public function jobRequisition(): BelongsTo
    {
        return $this->belongsTo(JobRequisition::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }

    public function branchUnit(): BelongsTo
    {
        return $this->belongsTo(BranchUnit::class);
    }

    public function applicants(): HasMany
    {
        return $this->hasMany(Applicant::class);
    }

    /**
     * The list of requirements as lines.
     *
     * Stored as one text field because that is how it is written and edited;
     * split here because that is how it reads on the advert.
     *
     * @return list<string>
     */
    public function lines(string $column): array
    {
        /*
         * The bullet is stripped with a regex, not with `ltrim`.
         *
         * `ltrim($line, "-•*\t ")` looks obviously right and is a real bug:
         * the mask is a set of *bytes*, and "•" is three of them (E2 80 A2).
         * So any line opening with another character that shares one of those
         * leading bytes — an em dash is E2 80 94, and every en dash, curly
         * quote and ellipsis is in the same range — had its first two bytes
         * eaten and was left starting with an orphan continuation byte.
         *
         * That is not a cosmetic fault. The string stops being valid UTF-8, so
         * `json_encode` refuses it, so the whole response becomes a 500 — which
         * is what publishing an advert did, and what the public page for one
         * would have done. A recruiter pasting a bulleted list from Word could
         * trigger it without doing anything unusual at all.
         */
        return collect(preg_split('/\r\n|\r|\n/', (string) $this->{$column}))
            ->map(fn ($line) => trim(preg_replace('/^[\s\-\x{2013}\x{2014}\x{2022}\x{00B7}\x{25AA}\x{25CF}o\*]+/u', '', $line) ?? $line))
            // A line that was only a separator leaves nothing behind, and an
            // empty bullet on an advert is worse than no bullet.
            ->filter(fn (string $line) => $line !== '')
            ->values()
            ->all();
    }
}
