<?php

namespace App\Console\Commands;

use App\Models\Employee;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Brings existing sign-in accounts back in step with their employee records.
 *
 * The observer keeps them together from now on; this repairs whatever drifted
 * apart before it existed. Safe to rerun — it only writes rows that actually
 * disagree, and reports the ones it will not touch.
 *
 *   php artisan hr:sync-accounts --dry-run
 *   php artisan hr:sync-accounts
 */
class SyncEmployeeAccounts extends Command
{
    protected $signature = 'hr:sync-accounts
        {--dry-run : List what disagrees without writing}
        {--deactivate-resigned : Also close accounts whose employee has left}';

    protected $description = 'Re-sync user accounts with the employee records behind them';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $users = User::query()
            ->whereNotNull('employee_id')
            ->with('employee')
            ->orderBy('name')
            ->get();

        $rows = [];
        $collisions = [];
        $stats = ['name' => 0, 'email' => 0, 'status' => 0];

        foreach ($users as $user) {
            $employee = $user->employee;
            if (! $employee) {
                continue;
            }

            $changes = [];

            $name = trim($employee->full_name);
            if ($name !== '' && $name !== trim((string) $user->name)) {
                $changes['name'] = $name;
                $stats['name']++;
            }

            $email = trim((string) $employee->email);
            if ($email !== '' && strcasecmp($email, (string) $user->email) !== 0) {
                $taken = User::where('email', $email)->whereKeyNot($user->getKey())->first();

                if ($taken) {
                    // Reported rather than resolved: two people cannot share a
                    // login address, and guessing which one should keep it is
                    // not a decision a batch job gets to make.
                    $collisions[] = [
                        $employee->employee_no,
                        $employee->full_name,
                        $email,
                        "already used by {$taken->name}",
                    ];
                } else {
                    $changes['email'] = $email;
                    $stats['email']++;
                }
            }

            if ($this->option('deactivate-resigned')
                && in_array($employee->employment_status, ['RESIGNED', 'TERMINATED'], true)
                && $user->status === 'Active') {
                $changes['status'] = 'Suspended';
                $stats['status']++;
            }

            if ($changes) {
                $rows[] = [
                    $employee->employee_no,
                    $employee->full_name,
                    implode(', ', array_map(
                        fn ($k, $v) => "{$k} → {$v}",
                        array_keys($changes),
                        $changes,
                    )),
                ];

                if (! $dryRun) {
                    DB::transaction(fn () => $user->forceFill($changes)->saveQuietly());
                }
            }
        }

        if ($rows) {
            $this->table(['Employee no.', 'Name', 'Change'], $rows);
        }

        if ($collisions) {
            $this->newLine();
            $this->warn('Not applied — the address is already on another account:');
            $this->table(['Employee no.', 'Name', 'Email', 'Reason'], $collisions);
        }

        $this->newLine();
        $this->info(sprintf(
            '%s %d account%s · %d name%s · %d email%s · %d deactivated%s',
            $dryRun ? 'Would update' : 'Updated',
            count($rows),
            count($rows) === 1 ? '' : 's',
            $stats['name'],
            $stats['name'] === 1 ? '' : 's',
            $stats['email'],
            $stats['email'] === 1 ? '' : 's',
            $stats['status'],
            $collisions ? sprintf(' · %d skipped', count($collisions)) : '',
        ));

        if (! $this->option('deactivate-resigned')) {
            $stranded = User::whereNotNull('employee_id')
                ->where('status', 'Active')
                ->whereHas('employee', fn ($q) => $q->whereIn('employment_status', ['RESIGNED', 'TERMINATED']))
                ->count();

            if ($stranded) {
                $this->warn("{$stranded} active account(s) belong to someone who has left. Rerun with --deactivate-resigned to close them.");
            }
        }

        return self::SUCCESS;
    }
}
