<?php

namespace App\Services;

use App\Models\NotificationRule;
use App\Models\Role;

/**
 * The one place an automated email is sent from.
 *
 * `notification_rules` existed but nothing read it — every automated message
 * in the system was a direct `Mailer::send()` call with the recipient decided
 * in the controller that happened to trigger it, which is how an
 * administrator turning "payroll released" emails off in Admin had no effect
 * on anything. This makes the rule real: given an event key, it looks up who
 * is supposed to hear about it and whether email is even switched on for it,
 * and only then calls the Mailer.
 *
 * A missing rule is a closed gate, not an open one — an event nobody has
 * configured sends nothing rather than guessing at a recipient.
 */
class NotificationDispatcher
{
    public function __construct(private readonly Mailer $mailer) {}

    /**
     * @param  array<string, mixed>  $data  Passed straight to the Blade view.
     * @param  list<string>  $extraRecipients  Addresses beyond the rule's roles — the
     *                                         applicant or employee the event is actually about, who is never a role.
     * @return int  How many messages were actually sent.
     */
    public function dispatch(
        string $event,
        string $subject,
        string $view,
        array $data = [],
        array $extraRecipients = [],
        ?string $referenceType = null,
        ?int $referenceId = null,
    ): int {
        $rule = NotificationRule::where('event', $event)->first();

        $recipients = collect($extraRecipients)
            ->merge($rule && $rule->email_enabled ? $this->roleRecipients($rule->recipient_roles ?? []) : [])
            ->merge($rule && $rule->email_enabled ? ($rule->recipient_emails ?? []) : [])
            ->filter()
            ->unique()
            ->values();

        if ($recipients->isEmpty()) {
            return 0;
        }

        $sent = 0;

        foreach ($recipients as $to) {
            if ($this->mailer->send($to, $subject, $view, $data, $event, $referenceType, $referenceId)) {
                $sent++;
            }
        }

        return $sent;
    }

    /**
     * Sends straight to one address — the applicant or employee an event is
     * actually about, who is never a role and so never goes through
     * `roleRecipients`.
     *
     * The default is inverted from `dispatch()`: a missing rule sends,
     * because these are one-to-one notices a person is owed (their
     * application was received, their application was declined) rather than
     * an internal broadcast somebody has to opt a role into. An
     * administrator can still switch one off entirely — a rule with
     * `email_enabled = false` is the only thing that stops it.
     */
    public function dispatchDirect(
        string $event,
        string $to,
        string $subject,
        string $view,
        array $data = [],
        ?string $referenceType = null,
        ?int $referenceId = null,
    ): bool {
        $rule = NotificationRule::where('event', $event)->first();

        if ($rule && ! $rule->email_enabled) {
            return false;
        }

        return $this->mailer->send($to, $subject, $view, $data, $event, $referenceType, $referenceId);
    }

    /** @param  list<string>  $roleCodes  @return list<string> */
    private function roleRecipients(array $roleCodes): array
    {
        if ($roleCodes === []) {
            return [];
        }

        $query = in_array('*', $roleCodes, true) ? Role::query() : Role::whereIn('code', $roleCodes);

        return $query->with('users')->get()
            ->flatMap(fn (Role $r) => $r->users->pluck('email'))
            ->all();
    }
}
