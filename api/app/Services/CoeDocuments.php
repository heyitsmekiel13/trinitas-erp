<?php

namespace App\Services;

use App\Models\CoeRequest;
use App\Models\EmployeeCase;
use Carbon\CarbonImmutable;

/**
 * The certificate itself — of employment, or of no derogatory record.
 *
 * Built from the same 201-file data every time, so a certificate issued in
 * January and one issued in August never disagree about a job title. Salary
 * only appears when the employee asked for it on the request — a bank or
 * embassy sometimes needs it, most COEs don't carry it, and it is the
 * employee's call which kind they're asking HR to sign.
 *
 * The no-derogatory-record letter is deliberately not just the COE with a
 * different heading — it states what it is actually attesting to (no
 * unresolved case at time of issue), rather than reading as a boilerplate
 * good-conduct letter with nothing behind it. `CoeRequests::decide()` is
 * what refuses to issue one while a case is genuinely open; this only
 * states the fact once that has already been confirmed.
 */
class CoeDocuments
{
    /** @return array{filename: string, bytes: string} */
    public function certificate(CoeRequest $request): array
    {
        return $request->type === 'No Derogatory Record'
            ? $this->noDerogatoryRecord($request)
            : $this->employment($request);
    }

    private function employment(CoeRequest $request): array
    {
        $request->loadMissing(['employee.hrDepartment', 'employee.position']);
        $employee = $request->employee;

        [$company, $legal] = $this->company();

        $doc = new DocxWriter;

        $doc->title('Certificate of Employment')
            ->spacer(120)
            ->paragraph('TO WHOM IT MAY CONCERN:', ['bold' => true, 'after' => 240]);

        $hired = $employee->date_hired ? CarbonImmutable::parse($employee->date_hired)->format('F j, Y') : null;
        $status = $this->statusAdjective($employee->employment_status);
        $position = $employee->position->title ?? 'N/A';
        $department = $employee->hrDepartment->name ?? null;
        $stillEmployed = ! $employee->date_separated;

        $body = 'This is to certify that '.mb_strtoupper((string) $employee->full_name)
            .' has been employed with '.$legal.' as a '.$status.' '.$position
            .($department ? " under the {$department} department" : '')
            .($hired ? ", since {$hired}" : '')
            .($stillEmployed ? ' up to present.' : ($employee->date_separated
                ? ' until '.CarbonImmutable::parse($employee->date_separated)->format('F j, Y').'.'
                : '.'));

        $doc->paragraph($body);

        if ($request->include_salary && $employee->salary > 0) {
            $doc->paragraph(
                'The employee receives a monthly salary of ₱ '.number_format((float) $employee->salary, 2).'.'
            );
        }

        $doc->paragraph(
            'This certification is issued upon the employee\'s request'
                .($request->purpose ? " for {$request->purpose}" : '')
                .' this '.CarbonImmutable::now()->format('jS \d\a\y \o\f F, Y').' at '
                .($company['address'] ?? 'the company premises').'.'
        );

        $doc->spacer(240)
            ->paragraph('Very truly yours,', ['after' => 40])
            ->spacer(360)
            ->paragraph($company['signatory_name'] ?? '', ['bold' => true, 'after' => 0])
            ->paragraph($company['signatory_title'] ?? 'Human Resources', ['after' => 0]);

        return [
            'filename' => 'Certificate of Employment - '.$this->slug((string) $employee->full_name).'.docx',
            'bytes' => $doc->render(),
        ];
    }

    private function noDerogatoryRecord(CoeRequest $request): array
    {
        $request->loadMissing(['employee.hrDepartment', 'employee.position']);
        $employee = $request->employee;

        [$company, $legal] = $this->company();

        // The same guard `CoeRequests::decide()` already applies before a
        // request may be marked Issued — re-checked here as well, since
        // this method can be called any time later to re-download a
        // certificate already on record, and a case could have opened
        // since.
        $openCase = EmployeeCase::where('employee_id', $employee->id)
            ->whereNotIn('status', ['Resolved', 'Closed'])
            ->exists();

        if ($openCase) {
            throw new \RuntimeException(
                'This employee now has an open disciplinary case — this certificate can no longer honestly be reissued.'
            );
        }

        $doc = new DocxWriter;

        $doc->title('Certificate of No Derogatory Record')
            ->spacer(120)
            ->paragraph('TO WHOM IT MAY CONCERN:', ['bold' => true, 'after' => 240]);

        $position = $employee->position->title ?? 'N/A';
        $department = $employee->hrDepartment->name ?? null;

        $doc->paragraph(
            'This is to certify that '.mb_strtoupper((string) $employee->full_name)
                .' ('.$employee->employee_no.'), '.$this->statusAdjective($employee->employment_status).' '.$position
                .($department ? " under the {$department} department" : '')
                .' of '.$legal.', has, as of the date of this certification, no unresolved disciplinary case or '
                .'derogatory record on file with the Company.'
        );

        $doc->paragraph(
            'This certification speaks only to the Company\'s own personnel record and covers the period of the '
                .'employee\'s employment with the Company. It is not a clearance from the National Bureau of '
                .'Investigation, the Philippine National Police, or any other government agency.'
        );

        $doc->paragraph(
            'This certification is issued upon the employee\'s request'
                .($request->purpose ? " for {$request->purpose}" : '')
                .' this '.CarbonImmutable::now()->format('jS \d\a\y \o\f F, Y').' at '
                .($company['address'] ?? 'the company premises').'.'
        );

        $doc->spacer(240)
            ->paragraph('Very truly yours,', ['after' => 40])
            ->spacer(360)
            ->paragraph($company['signatory_name'] ?? '', ['bold' => true, 'after' => 0])
            ->paragraph($company['signatory_title'] ?? 'Human Resources', ['after' => 0]);

        return [
            'filename' => 'Certificate of No Derogatory Record - '.$this->slug((string) $employee->full_name).'.docx',
            'bytes' => $doc->render(),
        ];
    }

    /** @return array{0: array<string, mixed>, 1: string} */
    private function company(): array
    {
        $company = app(Settings::class)->group('company');

        return [$company, $company['legal_name'] ?? config('app.name')];
    }

    /** The real employment_status column values (REGULAR, PROBATION, ...) as the adjective a COE reads naturally with. */
    private function statusAdjective(?string $status): string
    {
        return match (mb_strtoupper((string) $status)) {
            'REGULAR' => 'regular',
            'PROBATION' => 'probationary',
            default => 'company',
        };
    }

    private function slug(string $name): string
    {
        return trim(preg_replace('/[^A-Za-z0-9 ]/', '', $name) ?? $name) ?: 'Employee';
    }
}
