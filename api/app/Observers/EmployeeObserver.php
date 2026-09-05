<?php

namespace App\Observers;

use App\Models\Employee;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\OffboardingOperations;
use Illuminate\Support\Facades\Log;

/**
 * Keeps a sign-in account in step with the person it belongs to.
 *
 * The employee record and the user account hold the same three facts — the
 * person's name, their email, and whether they still work here — in two
 * different tables. Nothing was carrying a change from one to the other, so
 * editing an email in HR updated the 201 file and left the account they
 * actually sign in with pointing at the old address.
 *
 * This lives in an observer rather than in the controller that happened to
 * make the edit, because there are four write paths into `employees`: the
 * generic resource endpoint, the masterfile importer, the seeders, and tinker.
 * A fix in one of them is a fix in one of them.
 *
 * The employee record is the source of truth in one direction only. Changing a
 * user's email in Admin does not rewrite the 201 file — that is a deliberate
 * asymmetry, because HR owns who somebody is and IT only owns how they sign in.
 */
class EmployeeObserver
{
    /** Name parts that together make the display name. */
    private const NAME_FIELDS = ['first_name', 'middle_name', 'last_name', 'suffix'];

    private const RESIGNED = ['RESIGNED', 'TERMINATED'];

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly OffboardingOperations $offboarding,
    ) {}

    public function updated(Employee $employee): void
    {
        // Starts the clearance checklist the moment a separation is recorded
        // directly on the 201 file — the safety net for whoever changes this
        // status without having gone through Offboarding's own "Initiate"
        // action first. `initiate()` is idempotent, so a case already open
        // from that action is not duplicated here.
        if ($employee->wasChanged('employment_status')
            && in_array($employee->employment_status, self::RESIGNED, true)) {
            $this->offboarding->initiate(
                $employee,
                $employee->employment_status === 'TERMINATED' ? 'Termination' : 'Resignation',
            );
        }

        $user = $employee->user()->first();

        if (! $user) {
            return;
        }

        $changes = [];
        $notes = [];
        $blocked = [];

        /* ------------------------------- Name ------------------------------ */

        if ($employee->wasChanged(self::NAME_FIELDS)) {
            $name = trim($employee->full_name);
            if ($name !== '' && $name !== $user->name) {
                $changes['name'] = $name;
                $notes[] = 'name';
            }
        }

        /* ------------------------------ Email ------------------------------ */

        if ($employee->wasChanged('email')) {
            $email = trim((string) $employee->email);

            if ($email === '') {
                // Clearing the 201 file's address must not delete the only way
                // the person can be reached for a password reset. HR removing
                // an address is a tidy-up; it is not "revoke their account".
                $blocked['email'] = 'Cleared in HR; the sign-in address was left alone.';
            } elseif (strcasecmp($email, (string) $user->email) === 0) {
                // Already agrees; nothing to do.
            } elseif (User::where('email', $email)->whereKeyNot($user->getKey())->exists()) {
                // `users.email` is unique. Two employees sharing an address is
                // a data problem for a human to resolve, not something to
                // resolve by silently overwriting somebody else's login.
                $blocked['email'] = "{$email} is already on another account.";
                Log::warning('Employee email not synced: already in use by another user.', [
                    'employee_id' => $employee->id,
                    'employee_no' => $employee->employee_no,
                    'email' => $email,
                ]);
            } else {
                $changes['email'] = $email;
                $notes[] = 'email';
            }
        }

        /* ------------------------------ Status ----------------------------- */

        if ($employee->wasChanged('employment_status')) {
            $resigned = in_array($employee->employment_status, self::RESIGNED, true);

            // Deactivates on the way out, and never on the way back in. A
            // returning employee needs somebody to decide they should have
            // access again — an account suspended for cause must not be
            // reopened by an unrelated status edit.
            if ($resigned && $user->status === 'Active') {
                // `users.status` is enum('Active','Suspended','Locked','Invited') —
                // Suspended is the one that blocks sign-in without pretending
                // the account was never issued.
                $changes['status'] = 'Suspended';
                $notes[] = 'status';
            }
        }

        // Nothing applied, but something was deliberately refused — that is
        // worth a line in the trail, or the address quietly never arrives and
        // nobody knows why.
        if (! $changes && $blocked) {
            $this->audit->log(
                'employee change not applied to sign-in',
                'User',
                $user->id,
                $user->name,
                'hr',
                ['employeeNo' => $employee->employee_no, 'blocked' => $blocked],
            );

            return;
        }

        if (! $changes) {
            return;
        }

        // Quietly: the user row has no observer of its own, and a normal save
        // would only add a second write for no benefit.
        $user->forceFill($changes)->saveQuietly();

        // The action column is varchar(64); the detail belongs in `changes`,
        // which is a json column built for exactly this.
        $this->audit->log(
            'synced sign-in from employee record ('.implode(', ', $notes).')',
            'User',
            $user->id,
            $user->name,
            'hr',
            ['employeeNo' => $employee->employee_no, 'applied' => $changes] + ($blocked ? ['blocked' => $blocked] : []),
        );
    }
}
