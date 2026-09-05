<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\JobPosting;
use App\Models\JobRequisition;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Putting a vacancy away, bringing it back, and finally destroying it.
 *
 * The delete button on a manpower request used to refuse almost every time it
 * was pressed: a request with an advert on the careers site was told to close
 * the advert first, one with anybody sourced against it was told to cancel
 * instead. The guard was right about the risk and useless as an answer — it
 * left people with a board full of dead vacancies and two jobs to do to clear
 * each one, so nobody cleared any.
 *
 * Archiving is what was missing. It is one act that does the whole job:
 *
 *   the request comes off every working list
 *   its advert comes off the careers site and goes with it
 *   everything is kept — the approved headcount, who raised it, who applied
 *
 * And then deletion becomes possible, because it is no longer the only option.
 * It is a second deliberate act from inside the archive, and it still refuses
 * where refusing is right: a request that produced a hire is the document that
 * authorised that headcount, and an advert somebody actually applied to is
 * part of their application. Neither of those is destroyable. A request raised
 * by mistake on a Tuesday is, and that is the case this exists for.
 */
class VacancyArchive
{
    /**
     * Takes a vacancy off the board, and its advert off the internet.
     *
     * Deliberately permissive. Archiving loses nothing, so refusing it would
     * only recreate the problem it was built to solve — the one thing it does
     * is report what was still live against the request, because a recruiter
     * who has just archived a vacancy with three people mid-interview needs to
     * know that now rather than next week.
     *
     * @return array{requisition: JobRequisition, adverts: int, applicants: int, message: string}
     */
    public function archive(JobRequisition $requisition, ?string $reason = null, ?User $actor = null): array
    {
        return DB::transaction(function () use ($requisition, $reason, $actor) {
            $adverts = JobPosting::where('job_requisition_id', $requisition->id)->get();

            foreach ($adverts as $advert) {
                // Closed *and* archived. Closing alone leaves it in the Job
                // Postings list as a live-looking record for a vacancy that no
                // longer exists.
                $advert->update(['status' => 'Closed']);
                $advert->delete();
            }

            $live = Applicant::where('job_requisition_id', $requisition->id)
                ->whereNotIn('stage', ['Hired', 'Rejected'])
                ->count();

            $requisition->update([
                'status' => 'Cancelled',
                'archived_reason' => $reason,
                'archived_by' => $actor?->id,
            ]);

            $requisition->delete();

            return [
                'requisition' => $requisition->fresh(),
                'adverts' => $adverts->count(),
                'applicants' => $live,
                'message' => $this->archiveMessage($requisition, $adverts->count(), $live),
            ];
        });
    }

    private function archiveMessage(JobRequisition $requisition, int $adverts, int $live): string
    {
        $parts = ["{$requisition->requisition_no} has been archived"];

        if ($adverts > 0) {
            $parts[] = $adverts === 1
                ? 'and its advert has been taken off the careers site'
                : "and its {$adverts} adverts have been taken off the careers site";
        }

        $message = implode(' ', $parts).'.';

        if ($live > 0) {
            $message .= " {$live} ".($live === 1 ? 'applicant is' : 'applicants are')
                .' still in the pipeline against it — they are untouched, so move them to another vacancy '
                .'or reject them.';
        }

        return $message;
    }

    /**
     * Brings one back.
     *
     * The advert comes back as a draft rather than published. It was taken off
     * the site by an act somebody meant; putting it back in front of the
     * public should be a second decision, not a side effect of un-archiving
     * the paperwork.
     */
    public function restore(JobRequisition $requisition): JobRequisition
    {
        return DB::transaction(function () use ($requisition) {
            $requisition->restore();
            $requisition->update(['status' => 'Approved', 'archived_reason' => null, 'archived_by' => null]);

            JobPosting::onlyTrashed()
                ->where('job_requisition_id', $requisition->id)
                ->get()
                ->each(function (JobPosting $advert) {
                    $advert->restore();
                    $advert->update(['status' => 'Draft', 'published_at' => null]);
                });

            return $requisition->fresh();
        });
    }

    /**
     * Why this record may not be destroyed. Null when it may.
     *
     * Two things make a vacancy permanent. A filled seat means it is the
     * document that authorised somebody's employment, which an audit will ask
     * for. An applicant means somebody's application points at it, and
     * deleting it would leave them in the pipeline for a vacancy that never
     * existed.
     *
     * Note what is *not* on the list: having an advert. That was the original
     * refusal and it was the wrong test — an advert nobody applied to is just
     * text, and it is destroyed along with the request.
     */
    public function blockedFrom(JobRequisition $requisition): ?string
    {
        if ((int) $requisition->filled > 0) {
            return "{$requisition->requisition_no} was used to hire "
                .$requisition->filled.' of its '.$requisition->headcount.' seats, so it is the record of '
                .'that headcount being approved. It stays in the archive.';
        }

        $applicants = Applicant::where('job_requisition_id', $requisition->id)->count();

        if ($applicants > 0) {
            return "{$requisition->requisition_no} has {$applicants} applicant"
                .($applicants === 1 ? '' : 's')
                .' against it, and deleting it would leave '
                .($applicants === 1 ? 'them' : 'them all')
                .' in the pipeline for a vacancy that no longer exists. It stays in the archive.';
        }

        $applied = Applicant::whereIn(
            'job_posting_id',
            JobPosting::withTrashed()->where('job_requisition_id', $requisition->id)->select('id'),
        )->count();

        if ($applied > 0) {
            return "Somebody applied to the advert for {$requisition->requisition_no}, which makes it part of "
                .'their application. It stays in the archive.';
        }

        return null;
    }

    /**
     * Destroys the record for good, and the advert with it.
     *
     * Only from the archive. Requiring the vacancy to have been archived first
     * is not ceremony: it means nothing is ever destroyed by one click on a
     * board, and anything destroyed was looked at twice.
     *
     * @throws \RuntimeException
     */
    public function destroy(JobRequisition $requisition): void
    {
        if (! $requisition->trashed()) {
            throw new \RuntimeException(
                "{$requisition->requisition_no} is still on the board. Archive it first — "
                .'nothing is deleted straight from the working list.'
            );
        }

        if ($refusal = $this->blockedFrom($requisition)) {
            throw new \RuntimeException($refusal);
        }

        DB::transaction(function () use ($requisition) {
            // The advert has no independent life once its request is gone, and
            // nothing has applied to it — `blockedFrom` has just established
            // that. Leaving it would orphan it behind a null foreign key.
            JobPosting::withTrashed()
                ->where('job_requisition_id', $requisition->id)
                ->get()
                ->each(fn (JobPosting $advert) => $advert->forceDelete());

            $requisition->forceDelete();
        });
    }

    /**
     * What is in the archive, and whether each one can still be destroyed.
     *
     * The reason is carried through: an archive of unexplained records is a
     * list nobody can act on, and "budget pulled" and "raised by mistake" lead
     * somewhere different when the question comes back six months later.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function archived(): Collection
    {
        return JobRequisition::onlyTrashed()
            ->with(['position', 'hrDepartment', 'branchUnit', 'archivedBy'])
            ->orderByDesc('deleted_at')
            ->get()
            ->map(fn (JobRequisition $r) => [
                'id' => $r->id,
                'no' => $r->requisition_no,
                'position' => $r->position->title ?? null,
                'department' => $r->hrDepartment->name ?? null,
                'branch' => $r->branchUnit->name ?? null,
                'headcount' => (int) $r->headcount,
                'filled' => (int) $r->filled,
                'archivedAt' => optional($r->deleted_at)->toDateString(),
                'archivedBy' => $r->archivedBy->name ?? null,
                'reason' => $r->archived_reason,
                'applicants' => Applicant::where('job_requisition_id', $r->id)->count(),
                'adverts' => JobPosting::withTrashed()->where('job_requisition_id', $r->id)->count(),
                // Null when it may be destroyed; the sentence to show when not.
                'blockedFrom' => $this->blockedFrom($r),
            ]);
    }
}
