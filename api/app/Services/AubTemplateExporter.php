<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\PayrollRun;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Support\Collection;
use ZipArchive;

/**
 * The company's own AUB HRIS workbook, filled from real payroll — not a
 * lookalike built from scratch. `INPUT DATA HERE`'s own instruction is "fill
 * in the data under the green column only," and that is exactly the
 * boundary this service respects: it writes only the cells that were
 * actually marked fillable (RGB `00FF00`, verified against the uploaded
 * template), and only where this ERP has a real, computed answer. Every
 * downstream sheet — `AUB PAYROLL`, the deduction totals, the statutory
 * tables — is the template's own formula work, untouched, because that is
 * what "use the template as is" means: the numbers change, not the sheet
 * that turns them into a payroll.
 *
 * Edits the workbook's XML directly rather than through a full
 * spreadsheet-object library. The uploaded template is real, WPS-authored,
 * 28-sheet, multi-megabyte file with thousands of formula cells — loading
 * the whole thing into an in-memory object model (every cell, every sheet,
 * every formula parsed into an AST) to change three sheets took several
 * minutes and, on the largest run tried, never finished. This instead opens
 * the file as the zip of XML parts it actually is, rewrites only the three
 * worksheet parts that carry real data (`ALPHALIST`, `INPUT DATA HERE`,
 * `AUB PAYROLL`) plus a one-line change to force Excel to recalculate
 * everything on open, and leaves the other 25 sheets' bytes untouched. The
 * formulas are never evaluated here — Excel does that, the same as it
 * always has, the moment the file is opened.
 *
 * What is deliberately still left blank, and why: the `Y`–`AN` retro
 * *breakdown* (eight paired current-period-style metrics for a past period)
 * — only the single lump `AO` figure is filled, because no retro workflow
 * exists to derive the eight sub-figures from. The outstanding-balance
 * columns (`BQ`–`BZ`) stay untouched — no ERP concept of a running
 * "before this cut-off" balance snapshot distinct from
 * `EmployeeDeduction::outstanding()`, which already exists but answers a
 * different question. Everything else the template asks for — Regular/
 * Special Holiday days and hours, S.I.L. availment, Ownership/Distri/Commi/
 * Holdings/Rent charges, Hold Payroll, Retro adjustment, bank code and
 * allowance rate — is filled from real records: computed fresh from
 * attendance/holidays/leave for the day-and-hour columns, or read straight
 * through from a named deduction arrangement or an employee/payslip field
 * for everything else.
 */
class AubTemplateExporter
{
    private const TEMPLATE_PATH = 'templates/aub_payroll_template.xlsx';

    /** This template's own internal part names — fixed for this one uploaded file, not a general xlsx assumption. */
    private const SHEET_PARTS = [
        'ALPHALIST' => 'xl/worksheets/sheet14.xml',
        'INPUT DATA HERE' => 'xl/worksheets/sheet13.xml',
        'AUB PAYROLL' => 'xl/worksheets/sheet24.xml',
    ];

    private const ALPHALIST_FIRST_ROW = 2;

    private const INPUT_FIRST_ROW = 7;

    private const SSS_LOAN_CODES = ['SSS-LOAN', 'SSS-CALAM'];

    private const PAGIBIG_LOAN_CODES = ['HDMF-MPL', 'HDMF-CALAM'];

    private const CA_CODES = ['CASH-ADVANCE'];

    private const UNIFORM_CODES = ['UNIFORM'];

    private const SHORTAGE_CODES = ['SHORTAGE'];

    private const OWNERSHIP_LOAN_CODES = ['OWNERSHIP-LOAN'];

    private const DISTRI_CODES = ['DISTRI-CHARGE'];

    private const COMMI_CODES = ['COMMI-CHARGE'];

    private const HOLDINGS_CODES = ['HOLDINGS-CHARGE'];

    private const RENT_CODES = ['RENT'];

    private const SS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

    /** @return string absolute path to the generated .xlsx (caller's responsibility to delete) */
    public function export(PayrollRun $run): string
    {
        // Measured at ~105MB against a real run — ALPHALIST alone is a
        // ~68,000-cell sheet, and both the DOM tree and the ref-to-element
        // index built over it cost real memory on top of it. That is well
        // inside a typical VPS's default, but tight enough to fail outright
        // against a conservative shared-hosting `memory_limit` (128M or
        // lower) that was never sized with this one feature in mind.
        // `ini_set` only raises this process's own ceiling for the rest of
        // this request — never a host-wide change — and a host that hard-caps
        // memory below 384M simply keeps its own lower ceiling; this never
        // makes anything worse, only removes a needless failure where there
        // was headroom to give.
        $currentLimit = $this->bytesFromIni(ini_get('memory_limit'));
        if ($currentLimit !== -1 && $currentLimit < 384 * 1024 * 1024) {
            @ini_set('memory_limit', '384M');
        }

        $run->loadMissing('payrollPeriod');

        $payslips = $run->payslips()
            ->with(['employee.position', 'employee.branchUnit', 'lines'])
            ->get()
            ->filter(fn ($p) => $p->employee !== null)
            ->sortBy(fn ($p) => $p->employee->last_name)
            ->values();

        $outputPath = tempnam(sys_get_temp_dir(), 'aub_').'.xlsx';
        copy(storage_path('app/'.self::TEMPLATE_PATH), $outputPath);

        $zip = new ZipArchive();
        $zip->open($outputPath);

        $sharedStrings = $this->loadSharedStrings($zip->getFromName('xl/sharedStrings.xml') ?: '');

        $zip->addFromString(
            self::SHEET_PARTS['ALPHALIST'],
            $this->editAlphalist($zip->getFromName(self::SHEET_PARTS['ALPHALIST']), $payslips->pluck('employee'), $sharedStrings),
        );

        $zip->addFromString(
            self::SHEET_PARTS['INPUT DATA HERE'],
            $this->editInputData($zip->getFromName(self::SHEET_PARTS['INPUT DATA HERE']), $run, $payslips),
        );

        $zip->addFromString(
            self::SHEET_PARTS['AUB PAYROLL'],
            $this->editAubPayroll($zip->getFromName(self::SHEET_PARTS['AUB PAYROLL']), $payslips),
        );

        $zip->addFromString('xl/workbook.xml', $this->forceRecalcOnLoad($zip->getFromName('xl/workbook.xml')));

        $zip->close();

        return $outputPath;
    }

    /**
     * What's worth knowing before this run's workbook is generated.
     *
     * Read-only, no side effects — everything here is a warning, not a
     * refusal. A name collision is the one that actually matters: the
     * template's own architecture joins `ALPHALIST` and `AUB PAYROLL` on the
     * employee's name string alone, so two people sharing one would have
     * one of them silently attributed the other's account and pay.
     *
     * @return string[]
     */
    public function validate(PayrollRun $run): array
    {
        $payslips = $run->payslips()
            ->with(['employee.position', 'employee.branchUnit'])
            ->get()
            ->filter(fn ($p) => $p->employee !== null);

        $warnings = [];

        $byName = [];
        foreach ($payslips as $payslip) {
            $byName[$this->nameFor($payslip->employee)][] = $payslip->employee->full_name;
        }
        foreach ($byName as $name => $employees) {
            if (count($employees) > 1) {
                $warnings[] = "\"{$name}\" matches more than one employee on this run (".implode(', ', $employees).
                    ') — the workbook can only tell them apart by name, so one may be attributed the other\'s row.';
            }
        }

        foreach ($payslips as $payslip) {
            $employee = $payslip->employee;
            $name = $employee->full_name;

            if ($employee->payment_mode === 'ATM' && ! $employee->atm_account) {
                $warnings[] = "{$name} is paid by ATM but has no AUB account number on file.";
            }
            if (! $employee->position) {
                $warnings[] = "{$name} has no designation on file.";
            }
            if (! $employee->branchUnit) {
                $warnings[] = "{$name} has no branch/unit on file.";
            }
        }

        return $warnings;
    }

    /** PHP's own `memory_limit` ini format ("384M", "1G", "-1" for unlimited) as a byte count. */
    private function bytesFromIni(string|false $value): int
    {
        if ($value === false || $value === '') {
            return -1;
        }
        if (trim($value) === '-1') {
            return -1;
        }

        $value = trim($value);
        $unit = strtolower(substr($value, -1));
        $number = (int) $value;

        return match ($unit) {
            'g' => $number * 1024 * 1024 * 1024,
            'm' => $number * 1024 * 1024,
            'k' => $number * 1024,
            default => $number,
        };
    }

    /* ====================================================================== */
    /* XML helpers                                                             */
    /* ====================================================================== */

    private function loadXml(string $xml): DOMDocument
    {
        $doc = new DOMDocument('1.0', 'UTF-8');
        $doc->preserveWhiteSpace = true;
        $doc->formatOutput = false;
        $doc->loadXML($xml, LIBXML_COMPACT);

        return $doc;
    }

    private function xpath(DOMDocument $doc): DOMXPath
    {
        $xpath = new DOMXPath($doc);
        $xpath->registerNamespace('x', self::SS_MAIN);

        return $xpath;
    }

    /**
     * A cell-reference → element map, built by walking the DOM once.
     *
     * The obvious alternative — an XPath `//x:c[@r='...']` lookup per cell —
     * re-scans the entire sheet from the top for every single cell touched.
     * Against ALPHALIST's ~68,000 cells that turned a few hundred writes
     * into tens of millions of comparisons; this indexes the document once
     * (a single pass) and every subsequent lookup is O(1).
     *
     * @return array<string, DOMElement>
     */
    private function indexCells(DOMDocument $doc): array
    {
        $index = [];
        foreach ($doc->getElementsByTagNameNS(self::SS_MAIN, 'c') as $cell) {
            /** @var DOMElement $cell */
            $ref = $cell->getAttribute('r');
            if ($ref !== '') {
                $index[$ref] = $cell;
            }
        }

        return $index;
    }

    /**
     * `xl/sharedStrings.xml` as a flat, index-ordered array of resolved text.
     *
     * Most existing text cells in this workbook (an employee's name among
     * them) don't carry their string inline — they hold `t="s"` plus a `<v>`
     * that is an *index* into this shared table, not the text itself. A
     * `<si>` entry is either a plain `<t>` or a run of `<r><t>...</t></r>`
     * pieces (rich text); either way every `<t>` under it concatenates into
     * that entry's string.
     *
     * @return list<string>
     */
    private function loadSharedStrings(string $xml): array
    {
        if ($xml === '') {
            return [];
        }

        $doc = $this->loadXml($xml);
        $strings = [];
        foreach ($doc->getElementsByTagNameNS(self::SS_MAIN, 'si') as $si) {
            /** @var DOMElement $si */
            $text = '';
            foreach ($si->getElementsByTagNameNS(self::SS_MAIN, 't') as $t) {
                $text .= $t->textContent;
            }
            $strings[] = $text;
        }

        return $strings;
    }

    /** A cell's actual text, resolving the shared-string indirection (`t="s"`) and inline strings (`t="inlineStr"`) alike — `$cell->textContent` alone only works for the latter. */
    private function cellText(DOMElement $cell, array $sharedStrings): string
    {
        if ($cell->getAttribute('t') === 's') {
            $index = (int) trim($cell->textContent);

            return $sharedStrings[$index] ?? '';
        }

        return trim($cell->textContent);
    }

    /** Empties a cell down to `<c r=".." s=".."/>` — keeps its style, drops any formula/value/type it had (used only on non-formula green cells). */
    private function clearCell(DOMElement $cell): void
    {
        while ($cell->firstChild) {
            $cell->removeChild($cell->firstChild);
        }
        $cell->removeAttribute('t');
    }

    private function setNumber(DOMDocument $doc, DOMElement $cell, float|int $value): void
    {
        $this->clearCell($cell);
        $v = $doc->createElement('v', (string) $value);
        $cell->appendChild($v);
    }

    /** Inline string — avoids ever touching the shared-strings table. */
    private function setText(DOMDocument $doc, DOMElement $cell, string $value): void
    {
        $this->clearCell($cell);
        $cell->setAttribute('t', 'inlineStr');
        $is = $doc->createElement('is');
        $t = $doc->createElement('t');
        $t->appendChild($doc->createTextNode($value));
        $is->appendChild($t);
        $cell->appendChild($is);
    }

    /** Excel's own epoch (1899-12-30, with the historical 1900-leap-year quirk baked in — the same one every spreadsheet tool honours). */
    private function excelSerial(mixed $date): ?float
    {
        if (! $date) {
            return null;
        }

        $carbon = $date instanceof \Carbon\CarbonInterface ? $date : \Carbon\CarbonImmutable::parse($date);
        $epoch = \Carbon\CarbonImmutable::create(1899, 12, 30);

        return (float) $epoch->diffInDays($carbon, false);
    }

    private function nameFor(Employee $employee): string
    {
        $middle = $employee->middle_name ? " {$employee->middle_name}" : '';

        return mb_strtoupper(trim("{$employee->last_name}, {$employee->first_name}{$middle}"));
    }

    /* ====================================================================== */
    /* ALPHALIST                                                                */
    /* ====================================================================== */

    /**
     * Updates or appends one row per employee, by exact name match — this is
     * the company's full-history employee list (thousands of rows, active
     * and separated), not a per-cutoff working sheet, so it is never wiped.
     * An employee already listed gets their row refreshed with current
     * master data; one not yet listed is appended after the last used row.
     */
    private function editAlphalist(string $xml, Collection $employees, array $sharedStrings): string
    {
        $doc = $this->loadXml($xml);
        $index = $this->indexCells($doc);

        $rowByName = [];
        $maxRow = self::ALPHALIST_FIRST_ROW - 1;
        foreach ($doc->getElementsByTagNameNS(self::SS_MAIN, 'row') as $row) {
            /** @var DOMElement $row */
            $rowNum = (int) $row->getAttribute('r');
            $maxRow = max($maxRow, $rowNum);
            if ($rowNum < self::ALPHALIST_FIRST_ROW) {
                continue;
            }
            $nameCell = $index["B{$rowNum}"] ?? null;
            $name = $nameCell ? trim($this->cellText($nameCell, $sharedStrings)) : '';
            if ($name !== '') {
                $rowByName[mb_strtoupper($name)] = $rowNum;
            }
        }

        $nextRow = $maxRow + 1;
        $sheetData = $doc->getElementsByTagNameNS(self::SS_MAIN, 'sheetData')->item(0);
        $rows = $doc->getElementsByTagNameNS(self::SS_MAIN, 'row');
        $lastRowEl = $rows->length > 0 ? $rows->item($rows->length - 1) : null;

        foreach ($employees as $employee) {
            $name = $this->nameFor($employee);
            $row = $rowByName[$name] ?? null;

            if ($row === null) {
                $row = $nextRow++;
                $lastRowEl = $this->appendAlphalistRow($doc, $sheetData, $lastRowEl, $row, $index);
            }

            $this->setText($doc, $index["B{$row}"], $name);
            $this->setText($doc, $index["C{$row}"], $employee->position->title ?? '');
            $this->setNumber($doc, $index["D{$row}"], $employee->per_hour ? $employee->daily_rate : (float) $employee->salary);
            if ($employee->allowance_rate !== null) {
                $this->setNumber($doc, $index["E{$row}"], (float) $employee->allowance_rate);
            } else {
                $this->clearCell($index["E{$row}"]);
            }
            $this->setText($doc, $index["F{$row}"], $employee->branchUnit->name ?? '');
            $this->setText($doc, $index["G{$row}"], (string) $employee->employment_status);
            $this->setText($doc, $index["H{$row}"], (string) ($employee->sss_no ?? ''));
            $this->setText($doc, $index["I{$row}"], (string) ($employee->philhealth_no ?? ''));
            $this->setText($doc, $index["J{$row}"], (string) ($employee->pagibig_no ?? ''));
            $this->setText($doc, $index["K{$row}"], (string) ($employee->atm_account ?? ''));

            $hired = $this->excelSerial($employee->date_hired);
            if ($hired !== null) {
                $this->setNumber($doc, $index["L{$row}"], $hired);
            }
            $separated = $this->excelSerial($employee->date_separated);
            if ($separated !== null) {
                $this->setNumber($doc, $index["M{$row}"], $separated);
            }
        }

        return $doc->saveXML();
    }

    /** A brand-new employee, never on the list before — cloned from the last row's own cell styles so it looks like it belongs. Returns the new row element and adds its cells to `$index`. */
    private function appendAlphalistRow(DOMDocument $doc, DOMElement $sheetData, ?DOMElement $templateRow, int $rowNum, array &$index): DOMElement
    {
        $row = $doc->createElement('row');
        $row->setAttribute('r', (string) $rowNum);

        $columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
        $styles = [];
        if ($templateRow) {
            foreach ($templateRow->getElementsByTagNameNS(self::SS_MAIN, 'c') as $c) {
                /** @var DOMElement $c */
                $col = preg_replace('/\d+/', '', $c->getAttribute('r'));
                $styles[$col] = $c->getAttribute('s');
            }
        }

        foreach ($columns as $col) {
            $cell = $doc->createElement('c');
            $ref = "{$col}{$rowNum}";
            $cell->setAttribute('r', $ref);
            if (isset($styles[$col])) {
                $cell->setAttribute('s', $styles[$col]);
            }
            $row->appendChild($cell);
            $index[$ref] = $cell;
        }

        $sheetData->appendChild($row);

        return $row;
    }

    /* ====================================================================== */
    /* INPUT DATA HERE                                                          */
    /* ====================================================================== */

    private function editInputData(string $xml, PayrollRun $run, Collection $payslips): string
    {
        $doc = $this->loadXml($xml);
        $index = $this->indexCells($doc);

        $period = $run->payrollPeriod;
        $writeColumns = ['C', 'F', 'H', 'J', 'L', 'N', 'P', 'R', 'T', 'AO', 'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD', 'BE', 'BH'];

        // Clear every row this sheet's own extent covers for the green
        // columns, so a smaller run does not leave a longer one's rows
        // behind it. Bounded to the template's own existing data band —
        // this file's own INPUT DATA HERE already has real rows well past
        // any run this ERP can produce (total headcount is under 200).
        $maxExistingRow = self::INPUT_FIRST_ROW - 1;
        foreach ($doc->getElementsByTagNameNS(self::SS_MAIN, 'row') as $row) {
            $maxExistingRow = max($maxExistingRow, (int) $row->getAttribute('r'));
        }

        for ($r = self::INPUT_FIRST_ROW; $r <= $maxExistingRow; $r++) {
            foreach ($writeColumns as $col) {
                if (isset($index["{$col}{$r}"])) {
                    $this->clearCell($index["{$col}{$r}"]);
                }
            }
        }

        if ($period && isset($index['C1'])) {
            $this->setText($doc, $index['C1'], $period->label);
        }

        $employeeIds = $payslips->pluck('employee_id')->all();

        $attendanceByEmployee = $this->attendanceTotals($employeeIds, $period?->period_start, $period?->period_end);
        $holidayByEmployee = $this->holidayTotals($employeeIds, $period?->period_start, $period?->period_end);
        $silByEmployee = $this->silAvailmentTotals($employeeIds, $period?->period_start, $period?->period_end);

        $row = self::INPUT_FIRST_ROW;
        foreach ($payslips as $payslip) {
            $employee = $payslip->employee;
            $attendance = $attendanceByEmployee[$employee->id] ?? ['days' => 0, 'overtimeHours' => 0.0, 'nightDiffHours' => 0.0, 'tardinessMinutes' => 0, 'undertimeMinutes' => 0];
            $holiday = $holidayByEmployee[$employee->id] ?? ['regularDays' => 0, 'specialHours' => 0.0];
            $sil = $silByEmployee[$employee->id] ?? 0.0;
            $deductions = $this->deductionTotals($payslip->lines);

            $this->writeCell($doc, $index, "C{$row}", fn ($doc, $c) => $this->setText($doc, $c, $this->nameFor($employee)));
            $this->writeCell($doc, $index, "F{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $attendance['days']));
            $this->writeCell($doc, $index, "H{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $attendance['overtimeHours']));
            $this->writeCell($doc, $index, "J{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $attendance['nightDiffHours']));
            $this->writeCell($doc, $index, "L{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $holiday['regularDays']));
            $this->writeCell($doc, $index, "N{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $holiday['specialHours']));
            $this->writeCell($doc, $index, "P{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $sil));
            $this->writeCell($doc, $index, "R{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $attendance['tardinessMinutes']));
            $this->writeCell($doc, $index, "T{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $attendance['undertimeMinutes']));

            if ((float) $payslip->retro_adjustment !== 0.0) {
                $this->writeCell($doc, $index, "AO{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, (float) $payslip->retro_adjustment));
            }

            $this->writeCell($doc, $index, "AR{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, (float) $payslip->sss_employee));
            $this->writeCell($doc, $index, "AS{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, (float) $payslip->philhealth_employee));
            $this->writeCell($doc, $index, "AT{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, (float) $payslip->pagibig_employee));
            $this->writeCell($doc, $index, "AU{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['sssLoan']));
            $this->writeCell($doc, $index, "AV{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['pagibigLoan']));
            $this->writeCell($doc, $index, "AW{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['ca']));
            $this->writeCell($doc, $index, "AX{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['ownershipLoan']));
            $this->writeCell($doc, $index, "AY{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['distri']));
            $this->writeCell($doc, $index, "AZ{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['commi']));
            $this->writeCell($doc, $index, "BA{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['holdings']));
            $this->writeCell($doc, $index, "BB{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['rent']));
            $this->writeCell($doc, $index, "BC{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['uniform']));
            $this->writeCell($doc, $index, "BD{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['shortage']));
            $this->writeCell($doc, $index, "BE{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, $deductions['others']));

            if ((float) $payslip->hold_amount !== 0.0) {
                $this->writeCell($doc, $index, "BH{$row}", fn ($doc, $c) => $this->setNumber($doc, $c, (float) $payslip->hold_amount));
            }

            $row++;
        }

        return $doc->saveXML();
    }

    /** @param array<string, DOMElement> $index */
    private function writeCell(DOMDocument $doc, array $index, string $ref, callable $apply): void
    {
        if (isset($index[$ref])) {
            $apply($doc, $index[$ref]);
        }
    }

    /** @return array<int, array{days:int, overtimeHours:float, nightDiffHours:float, tardinessMinutes:int, undertimeMinutes:int}> */
    private function attendanceTotals(array $employeeIds, mixed $from, mixed $to): array
    {
        if (! $from || ! $to || $employeeIds === []) {
            return [];
        }

        $records = AttendanceRecord::query()
            ->whereIn('employee_id', $employeeIds)
            ->whereBetween('work_date', [$from, $to])
            ->get();

        $out = [];
        foreach ($records->groupBy('employee_id') as $employeeId => $rows) {
            $out[$employeeId] = [
                'days' => $rows->where('hours_worked', '>', 0)->count(),
                'overtimeHours' => (float) $rows->sum('overtime_hours'),
                'nightDiffHours' => (float) $rows->sum('night_diff_hours'),
                'tardinessMinutes' => (int) $rows->sum('late_minutes'),
                'undertimeMinutes' => (int) $rows->sum('undertime_minutes'),
            ];
        }

        return $out;
    }

    /**
     * Days/hours actually worked on a holiday — computed fresh from the
     * `holidays` table crossed against real attendance, the same way the
     * current-period columns are, not stored anywhere. Regular-type
     * holidays feed `L` (days, matching that column's own unit); Special
     * Non-Working/Local holidays feed `N` (hours, matching that column's).
     *
     * @return array<int, array{regularDays:int, specialHours:float}>
     */
    private function holidayTotals(array $employeeIds, mixed $from, mixed $to): array
    {
        if (! $from || ! $to || $employeeIds === []) {
            return [];
        }

        $holidays = Holiday::query()->whereBetween('holiday_date', [$from, $to])->get();
        if ($holidays->isEmpty()) {
            return [];
        }

        $holidayDates = $holidays->keyBy(fn ($h) => $h->holiday_date->toDateString());
        $records = AttendanceRecord::query()
            ->whereIn('employee_id', $employeeIds)
            ->whereIn('work_date', $holidayDates->keys())
            ->where('hours_worked', '>', 0)
            ->get();

        $out = [];
        foreach ($records->groupBy('employee_id') as $employeeId => $rows) {
            $regularDays = 0;
            $specialHours = 0.0;
            foreach ($rows as $row) {
                $holiday = $holidayDates->get($row->work_date->toDateString());
                if (! $holiday) {
                    continue;
                }
                if ($holiday->type === 'Regular') {
                    $regularDays++;
                } else {
                    $specialHours += (float) $row->hours_worked;
                }
            }
            $out[$employeeId] = ['regularDays' => $regularDays, 'specialHours' => $specialHours];
        }

        return $out;
    }

    /**
     * Approved Service Incentive Leave days within the period — the seeded
     * `SIL` leave type, summed from the same `leave_requests` table the
     * Leave module's own approval flow already writes to.
     *
     * @return array<int, float>
     */
    private function silAvailmentTotals(array $employeeIds, mixed $from, mixed $to): array
    {
        if (! $from || ! $to || $employeeIds === []) {
            return [];
        }

        return LeaveRequest::query()
            ->whereIn('employee_id', $employeeIds)
            ->whereHas('leaveType', fn ($q) => $q->where('code', 'SIL'))
            ->where('status', 'Approved')
            ->whereBetween('start_date', [$from, $to])
            ->get()
            ->groupBy('employee_id')
            ->map(fn ($rows) => (float) $rows->sum('days'))
            ->all();
    }

    /**
     * A deduction not on the named list still happened — it goes to
     * "Others" rather than nowhere, so this sheet's own total never
     * understates what the payslip actually withheld.
     */
    private function deductionTotals(Collection $lines): array
    {
        $sums = [
            'sssLoan' => 0.0, 'pagibigLoan' => 0.0, 'ca' => 0.0,
            'ownershipLoan' => 0.0, 'distri' => 0.0, 'commi' => 0.0, 'holdings' => 0.0, 'rent' => 0.0,
            'uniform' => 0.0, 'shortage' => 0.0, 'others' => 0.0,
        ];

        foreach ($lines->where('kind', 'deduction') as $line) {
            $amount = (float) $line->amount;

            match (true) {
                in_array($line->code, self::SSS_LOAN_CODES, true) => $sums['sssLoan'] += $amount,
                in_array($line->code, self::PAGIBIG_LOAN_CODES, true) => $sums['pagibigLoan'] += $amount,
                in_array($line->code, self::CA_CODES, true) => $sums['ca'] += $amount,
                in_array($line->code, self::OWNERSHIP_LOAN_CODES, true) => $sums['ownershipLoan'] += $amount,
                in_array($line->code, self::DISTRI_CODES, true) => $sums['distri'] += $amount,
                in_array($line->code, self::COMMI_CODES, true) => $sums['commi'] += $amount,
                in_array($line->code, self::HOLDINGS_CODES, true) => $sums['holdings'] += $amount,
                in_array($line->code, self::RENT_CODES, true) => $sums['rent'] += $amount,
                in_array($line->code, self::UNIFORM_CODES, true) => $sums['uniform'] += $amount,
                in_array($line->code, self::SHORTAGE_CODES, true) => $sums['shortage'] += $amount,
                default => $sums['others'] += $amount,
            };
        }

        return $sums;
    }

    /* ====================================================================== */
    /* AUB PAYROLL                                                              */
    /* ====================================================================== */

    /**
     * `AUB PAYROLL`'s own A3 is a legacy array formula
     * `UNIQUE('INPUT DATA HERE'!C7:C30)` with `ref="A3:A26"` in the uploaded
     * template — sized for whatever cutoff it was last edited for, not for
     * this run's actual headcount. Left alone, a run with more employees
     * silently drops the extra ones from the bank list; a run with fewer
     * leaves stale names and `#N/A` behind (rows up to 707 exist in this
     * file from a much larger previous list). Both get fixed here: the
     * formula's source range and its own array `ref` are corrected to the
     * real row count, and every row beyond the new list's length is cleared.
     */
    private function editAubPayroll(string $xml, Collection $payslips): string
    {
        $doc = $this->loadXml($xml);
        $index = $this->indexCells($doc);

        $headcount = $payslips->count();
        $lastInputRow = self::INPUT_FIRST_ROW + max($headcount, 1) - 1;
        $lastNeededRow = 3 + $headcount;
        $lastSpillRow = $lastNeededRow - 1;

        $a3 = $index['A3'] ?? null;
        if ($a3) {
            $formula = $a3->getElementsByTagNameNS(self::SS_MAIN, 'f')->item(0);
            if ($formula) {
                $formula->setAttribute('ref', "A3:A{$lastSpillRow}");
                $formula->nodeValue = '';
                $formula->appendChild($doc->createTextNode("_xlfn.UNIQUE('INPUT DATA HERE'!C7:C{$lastInputRow})"));
            }
        }

        // `UNIQUE()` preserves first-occurrence order, and its source is
        // exactly the C7:C{N} block written in this same payslip order —
        // row 3+i here is the same employee as row 7+i on INPUT DATA HERE,
        // which is the only way to reach `D`, since it carries no formula
        // of its own to pull the bank code through.
        $row = 3;
        foreach ($payslips as $payslip) {
            $bankCode = $payslip->employee->bank_code ?? null;
            if ($bankCode && isset($index["D{$row}"])) {
                $this->setText($doc, $index["D{$row}"], $bankCode);
            }
            $row++;
        }

        $maxExistingRow = 0;
        foreach ($doc->getElementsByTagNameNS(self::SS_MAIN, 'row') as $rowEl) {
            $maxExistingRow = max($maxExistingRow, (int) $rowEl->getAttribute('r'));
        }

        for ($r = $lastNeededRow; $r <= $maxExistingRow; $r++) {
            foreach (['A', 'B', 'C', 'D', 'E'] as $col) {
                if (isset($index["{$col}{$r}"])) {
                    $this->clearCell($index["{$col}{$r}"]);
                }
            }
        }

        return $doc->saveXML();
    }

    /* ====================================================================== */

    /** Belt-and-braces: every cached formula result in the workbook is now stale, so force Excel to recompute the lot the moment it opens. */
    private function forceRecalcOnLoad(string $xml): string
    {
        $doc = $this->loadXml($xml);
        $xpath = $this->xpath($doc);

        $calcPr = $xpath->query('//x:calcPr')->item(0);
        if ($calcPr instanceof DOMElement) {
            $calcPr->setAttribute('fullCalcOnLoad', '1');
        }

        return $doc->saveXML();
    }
}
