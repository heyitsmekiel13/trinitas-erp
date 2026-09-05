<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Making an offer, and hearing back about it.
 *
 * The offer was the one step of recruitment that lived entirely outside the
 * system. A recruiter moved somebody to the Offer stage, then opened their
 * mail client and typed the terms from memory — so the figure that was
 * actually put in writing existed only in a sent-items folder, and the answer
 * came back as "he said yes on the phone". At hire the salary was keyed again
 * from whatever anybody remembered.
 *
 * Three things change that:
 *
 *   The terms are a record. What was offered, when, by whom, and until when.
 *   That figure is what the 201 file defaults to at hire, so the number in the
 *   email and the number on the payslip are the same number by construction.
 *
 *   The candidate answers for themselves. The email carries an accept and a
 *   decline link, both of which land on the careers status page — the same
 *   reference-plus-email pair that page already asks for, so there is no
 *   account and no token that works on its own. An answer typed by the person
 *   it belongs to is worth more than one relayed.
 *
 *   Declining is a first-class outcome. About a third of offers are, and a
 *   system that only models acceptance leaves the recruiter to work out from
 *   silence whether to reopen the vacancy.
 *
 * Sending is deliberately not automatic on reaching the Offer stage. An offer
 * is the most consequential email this system sends and the terms are usually
 * settled in a conversation first; firing one the moment a card is dragged
 * would send the wrong salary to somebody at least once.
 */
class JobOffers
{
    public function __construct(
        private readonly Mailer $mailer,
        private readonly OfferDocuments $documents,
    ) {}

    /**
     * Records the offer and emails it.
     *
     * @param  array<string, mixed>  $terms
     * @return array{applicant: Applicant, sent: bool, message: string}
     *
     * @throws \RuntimeException
     */
    public function send(Applicant $applicant, array $terms, ?User $actor = null): array
    {
        if ($applicant->stage === 'Hired') {
            throw new \RuntimeException('This applicant has already been hired.');
        }

        if ($applicant->stage === 'Rejected') {
            throw new \RuntimeException('This applicant was rejected. Move them back into the pipeline first.');
        }

        if (blank($applicant->email)) {
            throw new \RuntimeException(
                'There is no email address on this application, so the offer cannot be sent. '
                .'Add one to their details first.'
            );
        }

        $applicant->loadMissing(['position', 'jobPosting.hrDepartment', 'jobRequisition.hrDepartment', 'jobRequisition.branchUnit']);

        $saved = DB::transaction(function () use ($applicant, $terms, $actor) {
            $applicant->update([
                /* The advert's heading first. That is the title the candidate
                   applied to and the one they will recognise; the plantilla
                   position behind it is often worded for the org chart rather
                   than for a person — "ACCOUNTING HEAD" against an advert that
                   said Accounting Supervisor. */
                'offer_position' => $terms['position']
                    ?? $applicant->jobPosting->title
                    ?? $applicant->position->title
                    ?? 'the role',
                'offer_salary' => $terms['salary'] ?? null,
                /* What the letter actually states. A Philippine offer is
                   written as a daily rate plus a separate de minimis, and the
                   two are different things in law — only one is taxable — so a
                   letter that folds them into a monthly figure is one the
                   first payslip contradicts. */
                'offer_daily_rate' => $terms['dailyRate'] ?? null,
                'offer_de_minimis' => $terms['deMinimis'] ?? null,
                'offer_start_date' => $terms['startDate'] ?? null,
                'offer_orientation_at' => $terms['orientationAt'] ?? null,
                'offer_orientation_venue' => $terms['orientationVenue'] ?? null,
                'offer_expires_on' => $terms['expiresOn'] ?? null,
                'offer_notes' => $terms['notes'] ?? null,
                'offer_sent_at' => now(),
                'offer_sent_by' => $actor?->id,
                /* A re-sent offer is a new offer. Any previous answer is
                   cleared, because leaving "Declined" beside terms that have
                   since changed reads as a refusal of the new ones. */
                'offer_response' => null,
                'offer_responded_at' => null,
                'offer_decline_reason' => null,
            ]);

            // The pipeline stage follows the act rather than being set
            // separately, so the board can never say Interview next to an
            // offer that has gone out.
            if (! in_array($applicant->stage, ['Offer'], true)) {
                $applicant->update(['stage' => 'Offer']);
            }

            return $applicant->fresh();
        });

        $sent = $this->deliver($saved);

        return [
            'applicant' => $saved->fresh(),
            'sent' => $sent,
            'message' => $sent
                ? "The offer has been emailed to {$saved->email}."
                : 'The offer is recorded, but the email could not be sent — check Admin → Email settings. '
                    .'Nothing else about the offer has changed.',
        ];
    }

    /**
     * Builds and sends the message, with the paperwork attached.
     *
     * The covering email states the terms; the offer letter is the document
     * that gets printed, signed and brought back, and the referral slip is
     * handed across a clinic reception desk. All three are generated from the
     * same offer record, so there is no version of this where the email says
     * one start date and the letter says another.
     *
     * A failure to build a document must not lose the offer. The message goes
     * either way, and an offer that arrives without its attachments is a
     * recoverable annoyance — one that never arrives at all is not.
     */
    private function deliver(Applicant $applicant): bool
    {
        $data = $this->present($applicant);
        $attachments = [];

        try {
            foreach ([
                $this->documents->offerLetter($applicant),
                $this->documents->referralSlip($applicant),
            ] as $file) {
                $attachments[] = $file + ['mime' => 'application/pdf'];
            }
        } catch (\Throwable $e) {
            Log::warning('Could not build the offer documents.', [
                'applicant' => $applicant->id,
                'error' => $e->getMessage(),
            ]);
        }

        return $this->mailer->send(
            $applicant->email,
            $data['subject'],
            'emails.job-offer',
            $data,
            'job-offer',
            'applicant',
            $applicant->id,
            $attachments,
        );
    }

    /**
     * Everything the template needs, and everything the preview shows.
     *
     * Shared so that what a recruiter reads before pressing send is built from
     * the same values as the message that goes out — a preview assembled
     * separately is a preview that eventually lies.
     *
     * @return array<string, mixed>
     */
    public function present(Applicant $applicant): array
    {
        $applicant->loadMissing(['position', 'jobPosting.hrDepartment', 'jobRequisition.hrDepartment', 'jobRequisition.branchUnit']);

        $position = $applicant->offer_position
            ?: ($applicant->jobPosting->title ?? $applicant->position->title ?? 'the role');

        $department = $applicant->jobPosting->hrDepartment->name
            ?? $applicant->jobRequisition->hrDepartment->name
            ?? null;

        $branch = $applicant->jobPosting->location
            ?? $applicant->jobRequisition->branchUnit->name
            ?? null;

        /* The address the outside world reaches this app on, taken from the
           company settings the same way the credentials email does — a mail
           client cannot resolve a path against this server, and `app.url` on a
           split deployment is the API rather than the site. */
        $company = app(Settings::class)->group('company');
        $base = rtrim((string) ($company['app_url'] ?? config('app.frontend_url', config('app.url'))), '/');

        /* The credential is the pair, exactly as the status page asks for it.
           A link that works on its own would be a permanent, forwardable key
           to somebody's salary. */
        $query = http_build_query([
            'reference' => $applicant->reference_code,
            'email' => $applicant->email,
        ]);

        $letter = $this->documents->context($applicant);

        return [
            'subject' => "Job offer — {$position} at ".$this->companyName(),
            'companyName' => $this->companyName(),
            'firstName' => $applicant->first_name ?: strtok((string) $applicant->full_name, ' '),
            'position' => $position,
            'department' => $department,
            'branch' => $branch,

            /* The daily figures the letter states, so the email and the
               attachment quote the same compensation rather than two
               descriptions of it. */
            'dailyRate' => $letter['dailyRate'] > 0
                ? '₱'.number_format($letter['dailyRate'], 2)
                : null,
            'deMinimis' => $letter['deMinimis'] > 0
                ? '₱'.number_format($letter['deMinimis'], 2)
                : null,

            'orientationDate' => $letter['orientationAt']?->format('l, F j, Y'),
            'orientationTime' => $letter['orientationAt']?->format('g:i A'),
            'orientationVenue' => $letter['orientationVenue'],

            'salary' => $applicant->offer_salary
                ? '₱'.number_format((float) $applicant->offer_salary, 2)
                : null,
            'startDate' => $applicant->offer_start_date
                ? CarbonImmutable::parse($applicant->offer_start_date)->format('j F Y')
                : null,
            'expiresOn' => $applicant->offer_expires_on
                ? CarbonImmutable::parse($applicant->offer_expires_on)->format('j F Y')
                : null,
            'notes' => $applicant->offer_notes,
            'reference' => $applicant->reference_code,
            'acceptUrl' => $applicant->reference_code ? "{$base}/careers?{$query}&offer=accept" : null,
            'declineUrl' => $applicant->reference_code ? "{$base}/careers?{$query}&offer=decline" : null,
        ];
    }

    /**
     * Records the candidate's answer.
     *
     * Accepting does not create an employee. Hiring is a transaction that
     * needs a department, a branch and a payroll group, and none of those is
     * the candidate's to choose — so an acceptance moves the application to
     * the front of the recruiter's queue and stops there.
     *
     * @throws \RuntimeException
     */
    public function respond(Applicant $applicant, string $decision, ?string $reason = null): Applicant
    {
        if (blank($applicant->offer_sent_at)) {
            throw new \RuntimeException('There is no offer on this application to answer.');
        }

        if ($applicant->offer_response !== null) {
            throw new \RuntimeException(
                'This offer has already been answered. Talk to the recruiter if that needs to change.'
            );
        }

        if ($applicant->offer_expires_on && CarbonImmutable::parse($applicant->offer_expires_on)->endOfDay()->isPast()) {
            throw new \RuntimeException(
                'This offer has expired. Get in touch and we will look at it again.'
            );
        }

        $applicant->update([
            'offer_response' => $decision === 'Accepted' ? 'Accepted' : 'Declined',
            'offer_responded_at' => now(),
            'offer_decline_reason' => $decision === 'Declined' ? $reason : null,
        ]);

        /* A decline ends the application and frees the seat. Leaving them at
           Offer would leave the vacancy looking filled while nobody is coming
           — which is the exact thing that makes a recruiter stop trusting the
           board. */
        if ($decision !== 'Accepted') {
            $applicant->update(['stage' => 'Rejected']);
        }

        return $applicant->fresh();
    }

    private function companyName(): string
    {
        $company = app(Settings::class)->group('company');

        return $company['trade_name'] ?? $company['legal_name'] ?? config('app.name');
    }
}
