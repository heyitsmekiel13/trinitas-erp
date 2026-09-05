<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Services\EmployeeImporter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Bringing the AUB masterfile in, and sending it back out.
 *
 * Import runs in two passes: a preview that only validates, and a commit. HR
 * gets to see what will happen before anything is written.
 */
class EmployeeImportController extends Controller
{
    /** Column order of the AUB template — the bank rejects any deviation. */
    private const HEADERS = [
        'EMPLOYEE NO.', 'FIRST NAME', 'MIDDLE NAME', 'LAST NAME', 'SUFFIX',
        'BIRTH DATE (MM/DD/YYY)', 'CIVIL STATUS(S/M/D/W)', 'GROUP', 'DEPARTMENT', 'BRANCH/UNIT',
        'POSITION TITLE', 'LEVEL', 'COSTCENTER', 'EMPLOYMENT STATUS',
        'TIN NO.', 'TAX EXEMPTED(YES/NO)', 'SSS NO.', 'SSS EXEMPTED(YES/NO)',
        'PHIC NO.', 'PHIC EXEMPTED(YES/NO)', 'PAGIBIG NO.', 'PAG-IBIG EXEMPTED(YES/NO)',
        'ATM ACCT. NO.', 'PAYROLL FREQUENCY (M/S/W/MM)', 'SALARY(MUST NOT BE ZERO)', 'PER HOUR(YES/NO)',
        'DATE HIRED (MM/DD/YYYY)', 'PAYROLL GROUP', 'PAYMENT MODE(CASH/CHEQUE/ATM)', 'EMAILADDRESS',
        'CONFIDENTIAL(YES/NO)', 'MINIMUMWAGEEARNER(YES/NO)',
    ];

    public function __construct(private readonly EmployeeImporter $importer) {}

    public function import(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:20480', 'mimes:xlsx,xls,csv,txt'],
            'dry_run' => ['sometimes', 'boolean'],
            'create_users' => ['sometimes', 'boolean'],
        ]);

        $path = $request->file('file')->getRealPath();

        try {
            $report = $request->boolean('dry_run')
                ? $this->importer->preview($path)
                : $this->importer->import($path, $request->boolean('create_users', true));
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Could not read that file: '.$e->getMessage()], 422);
        }

        return response()->json(['data' => $report], $report['errors'] > 0 ? 422 : 200);
    }

    /**
     * Streams the masterfile back in AUB's exact layout.
     *
     * Every field is quoted so Excel cannot reinterpret a statutory number as
     * a float and drop its leading zeros — the single most common way a
     * payroll upload gets rejected.
     */
    public function export(): StreamedResponse
    {
        $filename = 'AUB_Payroll_Masterfile_'.now()->format('Y-m-d').'.csv';

        return response()->streamDownload(function () {
            $out = fopen('php://output', 'w');

            // BOM so Excel opens it as UTF-8 and renders ñ correctly.
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, self::HEADERS);

            Employee::with(['businessGroup', 'hrDepartment', 'branchUnit', 'position', 'payrollGroup'])
                ->orderBy('employee_no')
                ->chunk(200, function ($employees) use ($out) {
                    foreach ($employees as $e) {
                        fputcsv($out, $this->rowFor($e));
                    }
                });

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store',
        ]);
    }

    /** @return array<int, string> */
    private function rowFor(Employee $e): array
    {
        $na = fn (?string $value) => filled($value) ? $value : 'N/A';
        $yn = fn (?bool $value) => $value ? 'YES' : 'NO';
        $date = fn ($value) => $value ? $value->format('n/j/Y') : 'N/A';

        return [
            $e->employee_no,
            $e->first_name,
            $na($e->middle_name),
            $e->last_name,
            $na($e->suffix),
            $date($e->birth_date),
            $e->civil_status,
            $e->businessGroup?->code ?? 'N/A',
            $e->hrDepartment?->code ?? 'N/A',
            $e->branchUnit?->code ?? 'N/A',
            $e->position?->title ?? 'N/A',
            (string) $e->level,
            $na($e->cost_center),
            $e->employment_status,
            $na($e->tin),
            $yn($e->tax_exempted),
            $na($e->sss_no),
            $yn($e->sss_exempted),
            $na($e->philhealth_no),
            $yn($e->philhealth_exempted),
            $na($e->pagibig_no),
            $yn($e->pagibig_exempted),
            $na($e->atm_account),
            $e->payrollGroup?->frequency ?? 'S',
            // Hourly rates carry three decimals; monthly rates are whole pesos.
            $e->per_hour ? rtrim(rtrim(number_format((float) $e->salary, 3, '.', ''), '0'), '.') : number_format((float) $e->salary, 2, '.', ''),
            $yn($e->per_hour),
            $date($e->date_hired),
            $e->payrollGroup?->code ?? 'N/A',
            $e->payment_mode,
            $na($e->email),
            $yn($e->confidential),
            $yn($e->minimum_wage_earner),
        ];
    }
}
