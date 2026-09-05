<?php

namespace App\Services;

use App\Models\BranchUnit;
use App\Models\BusinessGroup;
use App\Models\Employee;
use App\Models\HrDepartment;
use App\Models\PayrollGroup;
use App\Models\Position;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;

/**
 * Imports the AUB payroll masterfile into the HR tables.
 *
 * Reads the .xlsx directly — the file HR already maintains, with no
 * "save as CSV" step to get wrong. Every row is validated before anything is
 * written, and the whole import runs in one transaction so a bad file leaves
 * no half-populated database behind.
 *
 * Reference data (groups, departments, branches, positions) is created on
 * demand, because a masterfile is the authoritative source for the company's
 * own structure. Known misspellings are corrected and reported rather than
 * silently creating a duplicate business unit.
 */
class EmployeeImporter
{
    /** Column order of the AUB template. Index is 0-based. */
    private const COLUMNS = [
        'employee_no' => 0, 'first_name' => 1, 'middle_name' => 2, 'last_name' => 3, 'suffix' => 4,
        'birth_date' => 5, 'civil_status' => 6, 'group' => 7, 'department' => 8, 'branch_unit' => 9,
        'position' => 10, 'level' => 11, 'cost_center' => 12, 'employment_status' => 13,
        'tin' => 14, 'tax_exempted' => 15, 'sss' => 16, 'sss_exempted' => 17,
        'phic' => 18, 'phic_exempted' => 19, 'pagibig' => 20, 'pagibig_exempted' => 21,
        'atm' => 22, 'frequency' => 23, 'salary' => 24, 'per_hour' => 25, 'date_hired' => 26,
        'payroll_group' => 27, 'payment_mode' => 28, 'email' => 29,
        'confidential' => 30, 'minimum_wage_earner' => 31,
    ];

    /**
     * Misspellings observed in the live masterfile. Correcting these keeps the
     * reference tables clean; every correction is reported so HR can fix the
     * source file too.
     */
    private const CORRECTIONS = [
        'group' => [
            'PANDERO' => 'PANADERO',
            // JBYL is a department and a branch prefix, never a business group.
            'JBYL' => 'PANADERO',
        ],
        'position' => [
            'ACOUNTING MANAGER' => 'ACCOUNTING MANAGER',
            'AREA ASUPERVISOR' => 'AREA SUPERVISOR',
            'TRAINEE TL' => 'TRAINEE TEAM LEADER',
        ],
        // Departments were not run through this at all, so a single misspelt
        // cell created a whole second department and quietly filed somebody
        // under it — "REAPAIR & MAINTENANCE" sitting beside the real one.
        'department' => [
            'REAPAIR & MAINTENANCE' => 'REPAIR & MAINTENANCE',
            'REPAIR AND MAINTENANCE' => 'REPAIR & MAINTENANCE',
            'PROCESS AND PERFORMANCE DEPARTMENT' => 'PERFORMANCE AND PROCESS',
        ],
    ];

    /** @var array<int, array{row:int, employee_no:string, severity:string, column:string, message:string}> */
    private array $issues = [];

    /** @var array<string, int> */
    private array $created = [];

    public function __construct(private readonly AuditLogger $audit) {}

    /* ---------------------------------------------------------------------- */

    /** Parses and validates without writing anything. */
    public function preview(string $path): array
    {
        $rows = $this->read($path);

        return $this->report($rows, applied: false);
    }

    /**
     * Parses, validates and writes. Reference data is created as needed and
     * a user account is provisioned for every employee.
     */
    public function import(string $path, bool $createUsers = true, ?string $password = null): array
    {
        // A config-read default can't sit in the parameter list itself —
        // PHP only allows compile-time constants there.
        $password ??= config('app.default_employee_password');
        $rows = $this->read($path);

        if ($this->errorCount() > 0) {
            return $this->report($rows, applied: false);
        }

        DB::transaction(function () use ($rows, $createUsers, $password) {
            foreach ($rows as $row) {
                $employee = $this->upsertEmployee($row);

                if ($createUsers) {
                    $this->upsertUser($employee, $row, $password);
                }
            }
        });

        $this->audit->log(
            'imported the employee masterfile',
            'Employee',
            null,
            count($rows).' rows',
            'hr',
        );

        return $this->report($rows, applied: true);
    }

    /* ---------------------------------------------------------------------- */
    /* Reading */
    /* ---------------------------------------------------------------------- */

    /** @return array<int, array<string, mixed>> */
    private function read(string $path): array
    {
        $this->issues = [];

        $reader = IOFactory::createReaderForFile($path);
        $reader->setReadDataOnly(true);

        // Only the first sheet is ever imported, so only the first sheet is
        // read. The real masterfile workbook carries five further tabs of
        // working copies, and loading all of them took long enough to look
        // like the import had hung.
        $names = $reader->listWorksheetNames($path);
        if ($names !== []) {
            $reader->setLoadSheetsOnly($names[0]);
        }

        $sheet = $reader->load($path)->getSheet(0);

        $rows = [];
        $seen = [];

        foreach ($sheet->toArray(null, true, false, false) as $index => $cells) {
            if ($index === 0) {
                continue;   // header
            }

            $employeeNo = $this->str($cells[self::COLUMNS['employee_no']] ?? null);
            $lastName = $this->str($cells[self::COLUMNS['last_name']] ?? null);

            // The template carries hundreds of empty formatting rows; a row is
            // only real when it has both an employee number and a surname.
            if ($employeeNo === null || $lastName === null) {
                continue;
            }

            $rowNo = $index + 1;
            $row = $this->parseRow($cells, $rowNo, $employeeNo);

            if (isset($seen[$employeeNo])) {
                $this->issue($rowNo, $employeeNo, 'error', 'EMPLOYEE NO.', "Duplicate of row {$seen[$employeeNo]}.");

                continue;
            }
            $seen[$employeeNo] = $rowNo;

            $rows[] = $row;
        }

        return $rows;
    }

    /** @param array<int, mixed> $cells */
    private function parseRow(array $cells, int $rowNo, string $employeeNo): array
    {
        $get = fn (string $key) => $this->str($cells[self::COLUMNS[$key]] ?? null);

        $group = $this->correct('group', $get('group'), $rowNo, $employeeNo, 'GROUP');
        $position = $this->correct('position', $get('position'), $rowNo, $employeeNo, 'POSITION TITLE');
        $department = $this->correct('department', $get('department'), $rowNo, $employeeNo, 'DEPARTMENT');

        $salary = $cells[self::COLUMNS['salary']] ?? null;
        $salary = is_numeric($salary) ? (float) $salary : null;
        if ($salary === null || $salary <= 0) {
            $this->issue($rowNo, $employeeNo, 'error', 'SALARY', 'Salary is missing or not greater than zero.');
        }

        $perHour = $this->yesNo($get('per_hour'));
        if ($perHour === null) {
            $this->issue($rowNo, $employeeNo, 'error', 'PER HOUR', 'Expected YES or NO.');
        }

        // A rate on the wrong basis produces a payslip that is out by a factor
        // of a thousand, so it is worth flagging even though it still imports.
        if ($perHour === true && $salary !== null && $salary > 500) {
            $this->issue($rowNo, $employeeNo, 'warning', 'SALARY', 'Marked per-hour but the rate looks monthly.');
        }
        if ($perHour === false && $salary !== null && $salary < 5000) {
            $this->issue($rowNo, $employeeNo, 'warning', 'SALARY', 'Marked monthly but the amount looks hourly.');
        }

        foreach (['tin' => 'TIN NO.', 'sss' => 'SSS NO.'] as $key => $label) {
            if ($get($key) === null) {
                $this->issue($rowNo, $employeeNo, 'warning', $label, 'Not on file — needed before the first remittance.');
            }
        }

        if (! $group) {
            $this->issue($rowNo, $employeeNo, 'error', 'GROUP', 'Business group is required.');
        }
        if (! $position) {
            $this->issue($rowNo, $employeeNo, 'error', 'POSITION TITLE', 'Position is required.');
        }
        if (! $get('payroll_group')) {
            $this->issue($rowNo, $employeeNo, 'error', 'PAYROLL GROUP', 'Payroll group is required.');
        }

        return [
            'row' => $rowNo,
            'employee_no' => $employeeNo,
            'first_name' => $get('first_name') ?? '',
            'middle_name' => $get('middle_name'),
            'last_name' => $get('last_name') ?? '',
            'suffix' => $get('suffix'),
            'birth_date' => $this->date($cells[self::COLUMNS['birth_date']] ?? null),
            'civil_status' => $this->civilStatus($get('civil_status')),
            'group' => $group,
            'department' => $department ?? 'UNASSIGNED',
            'branch_unit' => $get('branch_unit') ?? 'UNASSIGNED',
            'position' => $position,
            'level' => (int) round((float) ($cells[self::COLUMNS['level']] ?? 1)) ?: 1,
            'cost_center' => $get('cost_center'),
            'employment_status' => $this->employmentStatus($get('employment_status')),
            'tin' => $get('tin'),
            'tax_exempted' => $this->yesNo($get('tax_exempted')) ?? false,
            'sss' => $get('sss'),
            'sss_exempted' => $this->yesNo($get('sss_exempted')) ?? false,
            'phic' => $get('phic'),
            'phic_exempted' => $this->yesNo($get('phic_exempted')) ?? false,
            'pagibig' => $get('pagibig'),
            'pagibig_exempted' => $this->yesNo($get('pagibig_exempted')) ?? false,
            'atm' => $get('atm'),
            'frequency' => $get('frequency') ?? 'S',
            'salary' => $salary ?? 0,
            'per_hour' => $perHour ?? false,
            'date_hired' => $this->date($cells[self::COLUMNS['date_hired']] ?? null) ?? now()->toDateString(),
            'payroll_group' => $get('payroll_group'),
            'payment_mode' => in_array($get('payment_mode'), ['ATM', 'CASH', 'CHEQUE'], true) ? $get('payment_mode') : 'ATM',
            'email' => filter_var((string) $get('email'), FILTER_VALIDATE_EMAIL) ? strtolower((string) $get('email')) : null,
            'confidential' => $this->yesNo($get('confidential')) ?? false,
            'minimum_wage_earner' => $this->yesNo($get('minimum_wage_earner')) ?? false,
        ];
    }

    /* ---------------------------------------------------------------------- */
    /* Writing */
    /* ---------------------------------------------------------------------- */

    private function upsertEmployee(array $row): Employee
    {
        $group = $this->findOrCreate(BusinessGroup::class, $row['group'], 'business_groups');
        $department = $this->findOrCreate(HrDepartment::class, $row['department'], 'hr_departments');
        $payrollGroup = $this->findOrCreate(PayrollGroup::class, $row['payroll_group'], 'payroll_groups', [
            'frequency' => $row['frequency'] === 'M' ? 'M' : 'S',
            'statutory_schedule' => 'second',
            'is_confidential' => $row['confidential'],
        ]);

        $branch = BranchUnit::firstOrCreate(
            ['code' => $row['branch_unit']],
            ['name' => Str::title(str_replace('-', ' ', $row['branch_unit'])), 'business_group_id' => $group->id, 'is_active' => true],
        );
        if ($branch->wasRecentlyCreated) {
            $this->created['branch_units'] = ($this->created['branch_units'] ?? 0) + 1;
        }

        $position = Position::firstOrCreate(
            ['title' => $row['position']],
            [
                'level' => $row['level'],
                'is_managerial' => (bool) preg_match('/MANAGER|SUPERVISOR|HEAD|CHIEF|DIRECTOR/i', $row['position']),
                'is_active' => true,
            ],
        );
        if ($position->wasRecentlyCreated) {
            $this->created['positions'] = ($this->created['positions'] ?? 0) + 1;
        }

        $employee = Employee::updateOrCreate(
            ['employee_no' => $row['employee_no']],
            [
                'first_name' => $row['first_name'],
                'middle_name' => $row['middle_name'],
                'last_name' => $row['last_name'],
                'suffix' => $row['suffix'],
                'birth_date' => $row['birth_date'],
                'civil_status' => $row['civil_status'],
                'business_group_id' => $group->id,
                'hr_department_id' => $department->id,
                'branch_unit_id' => $branch->id,
                'position_id' => $position->id,
                'payroll_group_id' => $payrollGroup->id,
                'level' => $row['level'],
                'cost_center' => $row['cost_center'],
                'employment_status' => $row['employment_status'],
                'date_hired' => $row['date_hired'],
                'tin' => $row['tin'],
                'tax_exempted' => $row['tax_exempted'],
                'sss_no' => $row['sss'],
                'sss_exempted' => $row['sss_exempted'],
                'philhealth_no' => $row['phic'],
                'philhealth_exempted' => $row['phic_exempted'],
                'pagibig_no' => $row['pagibig'],
                'pagibig_exempted' => $row['pagibig_exempted'],
                'salary' => $row['salary'],
                'per_hour' => $row['per_hour'],
                'minimum_wage_earner' => $row['minimum_wage_earner'],
                'confidential' => $row['confidential'],
                'payment_mode' => $row['payment_mode'],
                'atm_account' => $row['atm'],
                'email' => $row['email'],
            ],
        );

        $this->created[$employee->wasRecentlyCreated ? 'employees_created' : 'employees_updated'] =
            ($this->created[$employee->wasRecentlyCreated ? 'employees_created' : 'employees_updated'] ?? 0) + 1;

        return $employee;
    }

    /**
     * Provisions the sign-in account.
     *
     * The username is the employee number without its UNI prefix, which is what
     * staff already know and quote. The password is shared and must be changed
     * at first sign-in.
     */
    private function upsertUser(Employee $employee, array $row, string $password): void
    {
        $username = $this->usernameFor($employee->employee_no);

        $existing = User::withTrashed()->where('username', $username)->first();

        if ($existing) {
            // Never reset a password somebody has already personalised.
            $existing->update([
                'name' => $employee->full_name,
                'employee_id' => $employee->id,
                'email' => $row['email'] ?: $existing->email,
                'deleted_at' => null,
            ]);
            $this->created['users_updated'] = ($this->created['users_updated'] ?? 0) + 1;

            return;
        }

        $user = User::create([
            'employee_id' => $employee->id,
            'username' => $username,
            'name' => $employee->full_name,
            'email' => $row['email'],
            'password' => Hash::make($password),
            'is_super_admin' => false,
            // Off until SMTP is configured, otherwise nobody could sign in.
            'requires_auth_code' => false,
            'must_change_password' => true,
            'status' => $employee->employment_status === 'RESIGNED' ? 'Suspended' : 'Active',
        ]);

        if ($role = $this->roleFor($row)) {
            $user->roles()->syncWithoutDetaching([$role->id]);
        }

        $this->created['users_created'] = ($this->created['users_created'] ?? 0) + 1;
    }

    /** UNI1438 becomes 1438 — the number staff already use. */
    public function usernameFor(string $employeeNo): string
    {
        $username = preg_replace('/^UNI[-\s]*/i', '', trim($employeeNo));

        return $username !== '' ? $username : strtolower(trim($employeeNo));
    }

    /** Best-guess starting role from department and payroll group. */
    private function roleFor(array $row): ?Role
    {
        $management = str_contains(strtoupper((string) $row['payroll_group']), 'TOP MANAGEMENT');
        $department = strtoupper((string) $row['department']);
        $position = strtoupper((string) $row['position']);

        $code = match (true) {
            str_contains($position, 'HR ') || $department === 'HR DEPARTMENT' => $management ? 'hr-manager' : 'hr-officer',
            $department === 'ACCOUNTING' => $management ? 'finance-manager' : 'accountant',
            $department === 'PROCUREMENT' => $management ? 'procurement-manager' : 'buyer',
            $department === 'WAREHOUSE' => $management ? 'warehouse-manager' : 'warehouse-staff',
            $department === 'MAINTENANCE' => $management ? 'maintenance-manager' : 'technician',
            $department === 'SALES' => $management ? 'sales-manager' : 'sales-rep',
            $management => 'executive',
            // Branch crew get no module access until a role is assigned.
            default => null,
        };

        return $code ? Role::where('code', $code)->first() : null;
    }

    /* ---------------------------------------------------------------------- */
    /* Helpers */
    /* ---------------------------------------------------------------------- */

    /** @param class-string $model */
    private function findOrCreate(string $model, string $code, string $bucket, array $extra = []): object
    {
        $record = $model::firstOrCreate(
            ['code' => $code],
            array_merge(['name' => Str::title($code), 'is_active' => true], $extra),
        );

        if ($record->wasRecentlyCreated) {
            $this->created[$bucket] = ($this->created[$bucket] ?? 0) + 1;
        }

        return $record;
    }

    private function correct(string $kind, ?string $value, int $rowNo, string $employeeNo, string $column): ?string
    {
        if ($value === null) {
            return null;
        }

        $upper = strtoupper($value);
        $fixed = self::CORRECTIONS[$kind][$upper] ?? null;

        if ($fixed) {
            $this->issue($rowNo, $employeeNo, 'warning', $column, "Corrected \"{$value}\" to \"{$fixed}\" — fix it in the source file too.");

            return $fixed;
        }

        return $upper;
    }

    private function str(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = trim((string) $value);

        // The template uses N/A as an explicit "nothing here" marker.
        return ($text === '' || strtoupper($text) === 'N/A') ? null : $text;
    }

    private function yesNo(?string $value): ?bool
    {
        return match (strtoupper((string) $value)) {
            'YES', 'Y', '1', 'TRUE' => true,
            'NO', 'N', '0', 'FALSE' => false,
            default => null,
        };
    }

    private function civilStatus(?string $value): string
    {
        $code = strtoupper(substr((string) $value, 0, 1));

        return in_array($code, ['S', 'M', 'D', 'W'], true) ? $code : 'S';
    }

    private function employmentStatus(?string $value): string
    {
        $status = strtoupper((string) $value);

        return in_array($status, ['PROBATION', 'REGULAR', 'RESIGNED', 'TERMINATED'], true) ? $status : 'PROBATION';
    }

    /** Accepts both Excel serial dates and MM/DD/YYYY text. */
    private function date(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_numeric($value)) {
            return ExcelDate::excelToDateTimeObject((float) $value)->format('Y-m-d');
        }

        foreach (['m/d/Y', 'n/j/Y', 'Y-m-d', 'd/m/Y'] as $format) {
            try {
                $parsed = Carbon::createFromFormat($format, trim((string) $value));
                if ($parsed && $parsed->year > 1900 && $parsed->year < 2100) {
                    return $parsed->toDateString();
                }
            } catch (\Throwable) {
                // Try the next format.
            }
        }

        return null;
    }

    private function issue(int $row, string $employeeNo, string $severity, string $column, string $message): void
    {
        $this->issues[] = compact('row', 'employeeNo', 'severity', 'column', 'message') + [
            'employee_no' => $employeeNo,
        ];
    }

    private function errorCount(): int
    {
        return count(array_filter($this->issues, fn ($i) => $i['severity'] === 'error'));
    }

    private function report(array $rows, bool $applied): array
    {
        return [
            'applied' => $applied,
            'rows' => count($rows),
            'errors' => $this->errorCount(),
            'warnings' => count($this->issues) - $this->errorCount(),
            'issues' => array_slice($this->issues, 0, 300),
            'created' => $this->created,
            'default_password' => $applied ? null : config('app.default_employee_password'),
        ];
    }
}
