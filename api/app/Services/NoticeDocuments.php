<?php

namespace App\Services;

use App\Models\EmployeeCase;
use Carbon\CarbonImmutable;

/**
 * The two letters the twin-notice rule actually requires — generated, not
 * just tracked.
 *
 * `DueProcess` already computes whether each step happened and when; this
 * is the piece that was missing on top of it. A case could be marked
 * "Notice Issued" without a notice ever having been produced, because
 * recording a date and handing someone a letter were never the same
 * action. These methods turn the same data `DueProcess` already reads
 * (`nte_details`, `decision_findings`, `penalty`, the dates) into the
 * actual document HR prints and the employee signs for.
 *
 * PDF for the reason `OfferDocuments` gives: no PDF library on a shared
 * host, and PDF is the one format nobody can quietly re-word after HR
 * has handed it over — which matters more for a disciplinary notice than
 * for almost anything else this system generates.
 */
class NoticeDocuments
{
    /**
     * The first notice — what the employee is accused of, and the deadline
     * to answer. Refuses to build one with nothing to say: an NTE that
     * does not state specific acts is not a valid notice under D.O. 147-15,
     * and generating one anyway would produce a document that looks real
     * but would not hold up.
     *
     * @return array{filename: string, bytes: string}
     *
     * @throws \RuntimeException when the case has no NTE details recorded yet
     */
    public function noticeToExplain(EmployeeCase $case): array
    {
        $case->loadMissing(['employee.hrDepartment', 'employee.position']);

        if (! $case->nte_details) {
            throw new \RuntimeException(
                'Record what the employee is being asked to explain first — Employee Relations → this case → Due Process.'
            );
        }

        $c = $this->context($case);
        $doc = new PdfWriter;

        $doc->letterhead($c['company'], $c['companyAddress'])
            ->title('Notice to Explain')
            ->meta($c['today'].' · '.$case->case_no);

        $doc->runs([['To: ', false], [$c['employeeName'], true]], ['after' => 2]);
        $doc->paragraph($c['positionLine'], ['after' => 16]);

        $doc->paragraph('Dear '.$c['firstName'].',');

        $doc->paragraph(
            'This is to formally notify you that the Company is looking into the following report concerning you:'
        );

        $doc->heading('Particulars')
            ->paragraph($case->nte_details);

        $dueDate = $case->nte_response_due_on
            ? CarbonImmutable::parse($case->nte_response_due_on)->format('F j, Y')
            : CarbonImmutable::parse($case->nte_issued_on ?? now())->addDays(DueProcess::EXPLANATION_DAYS)->format('F j, Y');

        $doc->runs([
            ['You are directed to submit a written explanation within ', false],
            [DueProcess::EXPLANATION_DAYS.' calendar days', true],
            [' of receipt of this notice, or on or before ', false],
            [$dueDate, true],
            [', addressed to the undersigned or to HR. State your side of the matter in full, and attach any '
                .'document or witness statement you wish the Company to consider.', false],
        ]);

        $doc->paragraph(
            'Failure to submit a written explanation within the period given will be construed as a waiver of '
            .'your right to be heard, and the Company will proceed to a decision on the basis of the evidence on '
            .'record.'
        );

        $doc->paragraph(
            'You may, if you wish, request a hearing or conference to clarify the matter further. This notice '
            .'does not itself constitute a finding of guilt or a penalty.'
        );

        $doc->spacer(20)
            ->paragraph('Very truly yours,', ['after' => 4])
            ->paragraph($c['company'], ['bold' => true, 'after' => 30]);

        $doc->paragraph($c['signatory'], ['bold' => true, 'after' => 0])
            ->paragraph($c['signatoryTitle'], ['after' => 20]);

        $doc->heading('Acknowledgement of Receipt')
            ->paragraph(
                'I acknowledge receipt of this notice on the date indicated below. Receipt of this notice does '
                .'not constitute agreement with its contents.'
            )
            ->signatureLine('Signature over Printed Name — '.$c['employeeName'])
            ->spacer(16)
            ->paragraph('Date received: ______________________');

        return [
            'filename' => 'NTE - '.$case->case_no.' - '.$this->slug($c['employeeName']).'.pdf',
            'bytes' => $doc->render(),
        ];
    }

    /**
     * The second notice — the findings and the penalty, served once a
     * decision has actually been reached.
     *
     * @return array{filename: string, bytes: string}
     *
     * @throws \RuntimeException when no decision has been recorded yet
     */
    public function noticeOfDecision(EmployeeCase $case): array
    {
        $case->loadMissing(['employee.hrDepartment', 'employee.position']);

        if (! $case->decision_findings) {
            throw new \RuntimeException(
                'Record the findings and the decision first — Employee Relations → this case → Due Process.'
            );
        }

        $c = $this->context($case);
        $doc = new PdfWriter;

        $doc->letterhead($c['company'], $c['companyAddress'])
            ->title('Notice of Decision')
            ->meta($c['today'].' · '.$case->case_no);

        $doc->runs([['To: ', false], [$c['employeeName'], true]], ['after' => 2]);
        $doc->paragraph($c['positionLine'], ['after' => 16]);

        $doc->paragraph('Dear '.$c['firstName'].',');

        $doc->paragraph(
            'This refers to the Notice to Explain served on you'
            .($case->nte_issued_on ? ' on '.CarbonImmutable::parse($case->nte_issued_on)->format('F j, Y') : '')
            .', and to '.($case->explanation_received_on ? 'your written explanation, ' : 'the fact that no written explanation was received within the period given, ')
            .'and to the investigation the Company conducted into the matter.'
        );

        $doc->heading('Findings')
            ->paragraph($case->decision_findings);

        if ($case->hearing_notes) {
            $doc->heading('Hearing / Conference')
                ->paragraph($case->hearing_notes);
        }

        $doc->heading('Decision')
            ->runs($case->penalty
                ? [['After careful evaluation, the Company has decided to impose the penalty of ', false], [$case->penalty, true], ['.', false]]
                : [['After careful evaluation, the Company has decided not to impose any disciplinary penalty in this matter.', false]]);

        $doc->paragraph(
            'This decision is effective immediately upon your receipt of this notice. Should you disagree with '
            .'this decision, you may raise the matter through the Company\'s grievance procedure.'
        );

        $doc->spacer(20)
            ->paragraph('Very truly yours,', ['after' => 4])
            ->paragraph($c['company'], ['bold' => true, 'after' => 30]);

        $doc->paragraph($c['signatory'], ['bold' => true, 'after' => 0])
            ->paragraph($c['signatoryTitle'], ['after' => 20]);

        $doc->heading('Acknowledgement of Receipt')
            ->paragraph(
                'I acknowledge receipt of this notice on the date indicated below. Receipt of this notice does '
                .'not constitute agreement with its findings.'
            )
            ->signatureLine('Signature over Printed Name — '.$c['employeeName'])
            ->spacer(16)
            ->paragraph('Date received: ______________________');

        return [
            'filename' => 'NOD - '.$case->case_no.' - '.$this->slug($c['employeeName']).'.pdf',
            'bytes' => $doc->render(),
        ];
    }

    /** @return array<string, mixed> */
    private function context(EmployeeCase $case): array
    {
        $employee = $case->employee;
        $settings = app(Settings::class);
        $company = $settings->group('company');
        $legal = $company['legal_name'] ?? config('app.name');

        $position = $employee->position->title ?? null;
        $department = $employee->hrDepartment->name ?? null;

        return [
            'today' => CarbonImmutable::now()->format('F j, Y'),
            'employeeName' => $employee->full_name,
            'firstName' => $employee->first_name ?: strtok((string) $employee->full_name, ' '),
            'positionLine' => trim(implode(' · ', array_filter([$employee->employee_no, $position, $department]))),
            'company' => $legal,
            'companyAddress' => $company['address'] ?? null,
            'signatory' => $company['signatory_name'] ?? '',
            'signatoryTitle' => $company['signatory_title'] ?? 'Human Resources',
        ];
    }

    private function slug(string $name): string
    {
        return trim(preg_replace('/[^A-Za-z0-9 ]/', '', $name) ?? $name) ?: 'Employee';
    }
}
