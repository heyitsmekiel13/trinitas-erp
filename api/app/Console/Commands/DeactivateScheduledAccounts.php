<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Console\Command;

/**
 * Closes accounts on the date an administrator already chose for them.
 *
 * `deactivate_at` is set ahead of time — a contract end date, a leave of
 * absence, a seasonal role's last day — precisely so nobody has to remember
 * to come back and flip the switch by hand. This is that memory. It only
 * ever moves an account from `Active` to `Inactive`; an account already
 * `Suspended` for cause, `Locked`, or one an administrator reactivated (which
 * should have cleared `deactivate_at` — see the write config) is left alone.
 *
 *   php artisan accounts:deactivate-scheduled
 */
class DeactivateScheduledAccounts extends Command
{
    protected $signature = 'accounts:deactivate-scheduled';

    protected $description = 'Deactivates accounts whose scheduled deactivation date has arrived';

    public function handle(AuditLogger $audit): int
    {
        $due = User::query()
            ->where('status', 'Active')
            ->whereNotNull('deactivate_at')
            ->where('deactivate_at', '<=', now())
            ->get();

        if ($due->isEmpty()) {
            $this->info('Nothing due.');

            return self::SUCCESS;
        }

        foreach ($due as $user) {
            $user->update(['status' => 'Inactive']);

            $audit->log(
                'account reached its scheduled deactivation date',
                'User',
                $user->id,
                $user->name,
                'admin',
            );
        }

        $this->info($due->count().' account(s) deactivated.');

        return self::SUCCESS;
    }
}
