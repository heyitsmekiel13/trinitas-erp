<?php

namespace App\Services;

use App\Models\PerformanceReview;
use Carbon\CarbonImmutable;

/**
 * A completed performance review, as the signed record it should leave
 * behind.
 *
 * The cycle itself — self-assessment, manager review, calibration — was
 * already built and enforced through the API before this existed. What
 * wasn't there was the last step every one of those cycles is supposed to
 * end in: a document the employee and the reviewer actually sign, so the
 * rating is something that happened on paper, not only a row that says
 * "Completed". That distinction matters most exactly when it would be
 * needed — a performance-based case relies on there being a real record,
 * not a database value nobody but HR ever saw.
 */
class ReviewDocuments
{
    /**
     * @return array{filename: string, bytes: string}
     *
     * @throws \RuntimeException when the cycle has not closed yet
     */
    public function document(PerformanceReview $review): array
    {
        $review->loadMissing(['employee.hrDepartment', 'employee.position', 'reviewer']);

        if ($review->status !== 'Completed' || $review->rating === null) {
            throw new \RuntimeException('This review has not been completed yet — there is no settled rating to issue.');
        }

        $employee = $review->employee;
        $settings = app(Settings::class);
        $company = $settings->group('company');
        $legal = $company['legal_name'] ?? config('app.name');

        $doc = new PdfWriter;

        $doc->letterhead($legal, $company['address'] ?? null)
            ->title('Performance Review')
            ->meta(CarbonImmutable::now()->format('F j, Y'));

        $doc->runs([[$employee->full_name, true]], ['after' => 2]);
        $doc->paragraph(
            trim(implode(' · ', array_filter([
                $employee->employee_no, $employee->position->title ?? null, $employee->hrDepartment->name ?? null,
            ]))),
            ['after' => 16],
        );

        $doc->amounts(array_values(array_filter([
            ['Review period', $review->period],
            ['Reviewer', $review->reviewer->full_name ?? '—'],
            $review->due_date ? ['Due date', $review->due_date->format('F j, Y')] : null,
            ['Score', number_format((float) $review->score, 2).' / 5.00'],
            ['Rating', $review->rating, true],
        ])));

        $doc->heading('Strengths')
            ->paragraph($review->strengths ?: 'Not recorded.');

        $doc->heading('Development Areas')
            ->paragraph($review->development_areas ?: 'Not recorded.');

        $doc->spacer(20)
            ->paragraph(
                'This review has been discussed with the employee named above. Signing below acknowledges that '
                .'the review was received and discussed — it does not by itself mean the employee agrees with '
                .'every rating or comment in it.'
            );

        $doc->signatureLine('Employee — Signature over Printed Name')
            ->spacer(16)
            ->signatureLine('Reviewer — Signature over Printed Name')
            ->spacer(16)
            ->paragraph('Date: ______________________');

        return [
            'filename' => 'Performance Review - '.$review->period.' - '.$this->slug($employee->full_name).'.pdf',
            'bytes' => $doc->render(),
        ];
    }

    private function slug(string $name): string
    {
        return trim(preg_replace('/[^A-Za-z0-9 ]/', '', $name) ?? $name) ?: 'Employee';
    }
}
