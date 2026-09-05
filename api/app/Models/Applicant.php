<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class Applicant extends Model
{
    protected $guarded = [];

    /**
     * The extracted CV text and the parser's raw guess are large, and neither
     * is fit to leak into a response by accident — the text is the whole
     * document, personal details included. Hidden from serialisation so only
     * the endpoints that deliberately read them ever hand them out.
     */
    protected $hidden = ['resume_text', 'resume_parsed'];

    protected function casts(): array
    {
        return [
            'applied_on' => 'date',
            'birthdate' => 'date',
            'available_from' => 'date',
            'resume_uploaded_at' => 'datetime',
            'consented_at' => 'datetime',
            /* Without these the offer dates come back as plain strings, and
               `optional($applicant->offer_start_date)->toDateString()` in the
               presenters silently returns null on a string — so a start date
               that was saved correctly reached the candidate as nothing at
               all. */
            'offer_start_date' => 'date',
            'offer_expires_on' => 'date',
            'offer_sent_at' => 'datetime',
            'offer_responded_at' => 'datetime',
            'offer_orientation_at' => 'datetime',
            'skills' => 'array',
            'resume_parsed' => 'array',
            'assessment' => 'array',
        ];
    }

    /**
     * The code the candidate is given to look their application up with.
     *
     * Random rather than sequential: it is handed out, and a running number
     * would tell every applicant how many others there were.
     */
    public static function newReferenceCode(): string
    {
        do {
            $code = 'TRN-'.strtoupper(Str::random(3)).'-'.strtoupper(Str::random(4));
        } while (self::where('reference_code', $code)->exists());

        return $code;
    }

    /** Whatever name parts exist, assembled the way HR writes them. */
    public function composedName(): string
    {
        $parts = array_filter([
            trim((string) $this->first_name),
            trim((string) $this->middle_name),
            trim((string) $this->last_name),
        ]);

        return $parts ? implode(' ', $parts) : (string) $this->full_name;
    }

    public function jobRequisition(): BelongsTo
    {
        return $this->belongsTo(JobRequisition::class);
    }

    public function jobPosting(): BelongsTo
    {
        return $this->belongsTo(JobPosting::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    public function recruiter(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'recruiter_id');
    }
}
