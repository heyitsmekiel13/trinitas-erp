<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
|--------------------------------------------------------------------------
| Scheduled work
|--------------------------------------------------------------------------
|
| Both run daily and both are idempotent, so a missed run catches up on the
| next one and a double run changes nothing. Times are deliberately early —
| a deadline notice that lands at 07:00 can still be acted on that day.
|
| Needs one cron entry on the server:
|   * * * * * cd /path/to/api && php artisan schedule:run >> /dev/null 2>&1
*/

Schedule::command('compliance:scan')->dailyAt('06:30')->withoutOverlapping();
Schedule::command('tasks:remind')->dailyAt('07:00')->withoutOverlapping();

/*
 * Email that failed for a transient reason.
 *
 * Every ten minutes rather than daily: a person waiting on their sign-in
 * details should not wait until tomorrow morning because DNS hiccuped. The
 * sweep only touches rows the Mailer marked retryable, and gives up after four
 * attempts, so a genuinely bad address is not tried forever.
 */
Schedule::command('mail:retry')->everyTenMinutes()->withoutOverlapping();

/*
 * Recurring work.
 *
 * Before the reminder run, so anything raised this morning is chased in the
 * same pass rather than waiting a day for its first notice.
 */
Schedule::command('tasks:recur')->dailyAt('06:45')->withoutOverlapping();

/*
 * 201 documents lapsing within 30 days — chased while there is still time to
 * renew them, not the morning they expire.
 */
Schedule::command('hr:document-expiry-check')->dailyAt('06:15')->withoutOverlapping();

/*
 * Onboarding checklist items past their due date — a new hire's first month
 * chased daily rather than discovered at their first review.
 */
Schedule::command('hr:onboarding-overdue-check')->dailyAt('06:20')->withoutOverlapping();

/*
 * Accounts an administrator scheduled a deactivation date for — the date
 * arriving is the trigger, not a person remembering to act on it.
 */
Schedule::command('accounts:deactivate-scheduled')->dailyAt('00:05')->withoutOverlapping();

/*
 * Six months on probation resolves itself under the law — this is what keeps
 * the system's record of that in step with it automatically, or flags the
 * one case (a recent poor review) that genuinely needs a human decision.
 */
Schedule::command('hr:regularization-check')->dailyAt('06:25')->withoutOverlapping();

/*
 * Trims the audit trail to the retention window set in Settings → Security
 * (`audit_retention_days`). Last in the day's schedule, deliberately — every
 * other job above may itself write audit entries, and none of them should
 * be at risk of landing right on the edge of a retention cutoff computed
 * before they ran.
 */
Schedule::command('audit:purge')->dailyAt('23:50')->withoutOverlapping();
Schedule::command('hr:accrue-leave')->dailyAt('01:00')->withoutOverlapping();
