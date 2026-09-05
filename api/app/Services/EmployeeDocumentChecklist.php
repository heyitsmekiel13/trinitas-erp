<?php

namespace App\Services;

use App\Models\DocumentType;
use App\Models\Employee;
use Illuminate\Support\Collection;

/**
 * The 201 file as paper, not fields.
 *
 * Companion to EmployeeProfile, which answers "is the data complete". This
 * answers "have the documents actually been collected" — every required type
 * from `document_types` checked off against what has been uploaded and
 * verified for one employee, so a completion percentage replaces a walk to
 * the filing cabinet.
 *
 * A document only counts once it is Verified. Pending is not enough: a scan
 * that turns out to be somebody else's ID, or the wrong page of a contract,
 * has to be caught before it counts as done — the same reasoning EmployeeFile
 * applies to signing a data file off.
 */
class EmployeeDocumentChecklist
{
    /**
     * One employee's checklist: every applicable type, with what is on file.
     *
     * @return array{items: list<array<string, mixed>>, completion: array<string, mixed>}
     */
    public function forEmployee(Employee $employee): array
    {
        $types = DocumentType::query()->orderBy('sort_order')->get();
        $documents = $employee->documents()->with(['documentType', 'uploadedBy', 'verifiedBy'])->get()
            ->keyBy('document_type_id');

        $items = $types->map(function (DocumentType $type) use ($documents) {
            $doc = $documents->get($type->id);

            $expired = $doc && $type->expires && $doc->expiry_date && $doc->expiry_date->isPast();

            return [
                'documentTypeId' => $type->id,
                'key' => $type->key,
                'name' => $type->name,
                'category' => $type->category,
                'required' => $type->required,
                'expires' => $type->expires,
                'validityMonths' => $type->validity_months,
                'documentId' => $doc?->id,
                'status' => $expired ? 'Expired' : ($doc->status ?? 'Missing'),
                'originalName' => $doc?->original_name,
                'uploadedAt' => $doc?->created_at?->toIso8601String(),
                'uploadedBy' => $doc?->uploadedBy?->name,
                'verifiedAt' => $doc?->verified_at?->toIso8601String(),
                'verifiedBy' => $doc?->verifiedBy?->name,
                'expiryDate' => $doc?->expiry_date?->toDateString(),
                'notes' => $doc?->notes,
            ];
        });

        return [
            'items' => $items->values()->all(),
            'completion' => $this->completion($items),
        ];
    }

    /**
     * The percentage and the count a list row or a dashboard tile shows.
     *
     * @param  Collection<int, array<string, mixed>>  $items
     * @return array{percent: int, verified: int, required: int, missing: int, expiringSoon: int}
     */
    private function completion(Collection $items): array
    {
        $required = $items->where('required', true);
        $verified = $required->where('status', 'Verified')->count();
        $total = max($required->count(), 1);

        return [
            'percent' => (int) round(($verified / $total) * 100),
            'verified' => $verified,
            'required' => $required->count(),
            'missing' => $required->whereIn('status', ['Missing', 'Rejected', 'Expired'])->count(),
            'expiringSoon' => $items->filter(fn ($i) => $this->isExpiringSoon($i))->count(),
        ];
    }

    private function isExpiringSoon(array $item): bool
    {
        if (! $item['expiryDate'] || $item['status'] === 'Expired') {
            return false;
        }

        return now()->diffInDays($item['expiryDate'], false) <= 30 && now()->diffInDays($item['expiryDate'], false) >= 0;
    }

    /**
     * The 201-file document completeness figure the BI dashboard leads with:
     * required documents verified, against required documents that exist to
     * be verified, across the whole active workforce.
     *
     * @return array{percent: int, verified: int, required: int}
     */
    public function orgWideCompletion(): array
    {
        $employees = Employee::query()
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->limit(400)
            ->get();

        $verified = 0;
        $required = 0;

        foreach ($employees as $employee) {
            $completion = $this->forEmployee($employee)['completion'];
            $verified += $completion['verified'];
            $required += $completion['required'];
        }

        return [
            'percent' => $required > 0 ? (int) round(($verified / $required) * 100) : 0,
            'verified' => $verified,
            'required' => $required,
        ];
    }

    /** Every active employee this checklist evaluates — the true "tracked" count, capped or not. */
    public function trackedCount(): int
    {
        return Employee::query()->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)->count();
    }

    /**
     * Every employee whose required documents are not all verified, worst
     * (lowest completion) first. Feeds the dashboard panel and the bell.
     *
     * `$limit` is an intentional preview cap for those small feeds (10, or
     * 200 for the alerts digest) — pass null (the default) for the actual
     * 201 Files & Documents screen, which tables 195+ rows fine elsewhere
     * (Employees, Masterfile) and has no reason to stop at some arbitrary
     * cut. It used to default to 50 with no way to ask for more, which
     * silently hid whoever fell past that cut regardless of how incomplete
     * their file was — that was the bug, not the existence of a limit.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function outstanding(?int $limit = null): Collection
    {
        $employees = Employee::query()
            ->with(['hrDepartment', 'branchUnit'])
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->get();

        $rows = $employees
            ->map(function (Employee $employee) {
                $sheet = $this->forEmployee($employee);

                return [
                    'id' => $employee->id,
                    'employeeNo' => $employee->employee_no,
                    'name' => $employee->full_name,
                    'department' => $employee->hrDepartment->name ?? null,
                    'branch' => $employee->branchUnit->name ?? null,
                ] + $sheet['completion'];
            })
            ->filter(fn (array $row) => $row['missing'] > 0 || $row['expiringSoon'] > 0)
            ->sortBy('percent');

        return ($limit !== null ? $rows->take($limit) : $rows)->values();
    }

    /**
     * Verified documents lapsing within the given window, across everybody —
     * what the daily expiry check and its digest email read.
     *
     * @return Collection<int, \App\Models\EmployeeDocument>
     */
    public function expiringWithin(int $days = 30): Collection
    {
        return \App\Models\EmployeeDocument::query()
            ->with(['employee', 'documentType'])
            ->where('status', 'Verified')
            ->whereNotNull('expiry_date')
            ->whereBetween('expiry_date', [now()->toDateString(), now()->addDays($days)->toDateString()])
            ->get();
    }
}
