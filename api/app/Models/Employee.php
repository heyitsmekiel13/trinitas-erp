<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Employee extends Model
{
    use SoftDeletes;

    protected $guarded = [];

    /**
     * Free-text 201-file fields kept in caps — the convention this masterfile
     * already followed before any of it went through this app (see the AUB
     * import, where names and addresses arrive pre-uppercased). Applied here
     * rather than left to each caller, so it holds whether the value came
     * from the import, an HR edit, or an employee editing their own record.
     *
     * Deliberately excludes `email` (case is part of some addresses' identity,
     * even if rare) and anything that isn't free text — foreign keys, system-
     * generated columns like `public_id_token`, dates, booleans.
     */
    private const UPPERCASE_FIELDS = [
        'employee_no', 'first_name', 'middle_name', 'last_name', 'suffix',
        'address', 'cost_center', 'tin', 'sss_no', 'philhealth_no', 'pagibig_no', 'atm_account',
    ];

    protected static function booted(): void
    {
        static::saving(function (self $employee) {
            foreach (self::UPPERCASE_FIELDS as $field) {
                if (is_string($employee->{$field})) {
                    $employee->{$field} = mb_strtoupper($employee->{$field});
                }
            }
        });
    }

    protected function casts(): array
    {
        return [
            'birth_date' => 'date',
            'date_hired' => 'date',
            'date_separated' => 'date',
            'salary' => 'decimal:4',
            'per_hour' => 'boolean',
            'minimum_wage_earner' => 'boolean',
            'confidential' => 'boolean',
            'tax_exempted' => 'boolean',
            'sss_exempted' => 'boolean',
            'philhealth_exempted' => 'boolean',
            'pagibig_exempted' => 'boolean',
            'onboarding_completed_at' => 'datetime',
        ];
    }

    public function businessGroup(): BelongsTo
    {
        return $this->belongsTo(BusinessGroup::class);
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }

    /** The registered employer their statutory contributions are actually filed under — see LegalEntity. */
    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntity::class);
    }

    public function branchUnit(): BelongsTo
    {
        return $this->belongsTo(BranchUnit::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    public function payrollGroup(): BelongsTo
    {
        return $this->belongsTo(PayrollGroup::class);
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(static::class, 'reports_to_id');
    }

    public function payslips(): HasMany
    {
        return $this->hasMany(Payslip::class);
    }

    public function attendance(): HasMany
    {
        return $this->hasMany(AttendanceRecord::class);
    }

    public function leaveRequests(): HasMany
    {
        return $this->hasMany(LeaveRequest::class);
    }

    public function leaveBalances(): HasMany
    {
        return $this->hasMany(LeaveBalance::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(EmployeeDocument::class);
    }

    public function onboardingTasks(): HasMany
    {
        return $this->hasMany(OnboardingTask::class);
    }

    public function offboardingCases(): HasMany
    {
        return $this->hasMany(OffboardingCase::class);
    }

    public function resignationRequests(): HasMany
    {
        return $this->hasMany(ResignationRequest::class);
    }

    public function cases(): HasMany
    {
        return $this->hasMany(EmployeeCase::class);
    }

    /** The roster this employee is measured against for lateness. */
    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    /** The sign-in account, where one has been created. */
    public function user(): HasOne
    {
        return $this->hasOne(User::class);
    }

    /** Full name in the order the bank file expects. */
    public function getFullNameAttribute(): string
    {
        return trim("{$this->first_name} {$this->last_name}".($this->suffix && $this->suffix !== 'N/A' ? " {$this->suffix}" : ''));
    }

    /**
     * "Active" or "Inactive" — the one-word verdict a scanned ID badge shows.
     *
     * `employment_status` and `date_separated` are two independent columns
     * that are not database-enforced to agree (see the 201-file import), so
     * this reads both rather than trusting either alone: separated-but-not-
     * yet-updated and updated-but-undated should both read as gone.
     */
    public function getPublicStatusAttribute(): string
    {
        $separated = in_array($this->employment_status, ['RESIGNED', 'TERMINATED'], true)
            || $this->date_separated !== null
            || $this->trashed();

        return $separated ? 'Inactive' : 'Active';
    }

    /**
     * The permanent, unguessable key a printed badge's QR code points at.
     *
     * Generated once and kept — reissuing it (see EmployeeIdCardController)
     * is the deliberate act that invalidates every badge printed before it,
     * for a lost or compromised card.
     */
    public function ensurePublicToken(): string
    {
        if (! $this->public_id_token) {
            $this->public_id_token = Str::random(40);
            $this->save();
        }

        return $this->public_id_token;
    }

    /** Daily rate, derived from whichever rate the employee is paid on. */
    public function getDailyRateAttribute(): float
    {
        return $this->per_hour
            ? round((float) $this->salary * 8, 2)
            : round(((float) $this->salary * 12) / 313, 2);
    }

    /** Monthly figure the statutory contribution tables are read against. */
    public function getMonthlyEquivalentAttribute(): float
    {
        return $this->per_hour ? round($this->daily_rate * (313 / 12), 2) : round((float) $this->salary, 2);
    }

    /**
     * The application this 201 file was created from, when it was.
     *
     * Null for anybody imported or keyed directly. When it is set it is the
     * route back to the CV, the assessment and everything the candidate
     * actually said — which is otherwise lost the moment they become an
     * employee.
     */
    public function hiredFromApplicant(): BelongsTo
    {
        return $this->belongsTo(Applicant::class, 'hired_from_applicant_id');
    }
}
