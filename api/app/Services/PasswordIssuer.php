<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\User;

/**
 * Decides what password a person is given.
 *
 * One place, because there are two ways an account gets a password — HR
 * resetting a sign-in, and Admin emailing credentials — and when they each
 * decided for themselves, a person could be told two different things about
 * what to type.
 *
 * The rule is the last four digits of the mobile number on the 201 file. That
 * is a deliberate trade the business has made: nothing to read out, nothing to
 * transcribe, and a warehouse crew can be onboarded without a support call.
 * It is worth being plain about what it costs, because the code should not
 * pretend otherwise:
 *
 *   - Four digits is ten thousand possibilities, and a colleague's mobile
 *     number is not usually a secret inside the same company. This is a
 *     convenience credential, not a strong one.
 *   - Sign-in is throttled to ten attempts a minute and the account locks for
 *     fifteen minutes after five failures, so guessing is slow rather than
 *     free. Those two controls are what make the trade survivable.
 *   - Because nobody is forced to change it, an account can sit on it
 *     indefinitely. The self-service change-password screen is the answer to
 *     that, and it is worth pushing people towards.
 *
 * Where there is no usable number the account gets a random temporary password
 * instead, and the caller is told why. Falling back to a fixed default — which
 * is what the reset path used to do — would give every undocumented employee
 * in the company the same password, which is the one outcome worse than a
 * short one.
 */
class PasswordIssuer
{
    /** How many digits off the end of the number are used. */
    public const DIGITS = 4;

    /**
     * The password for an account, and where it came from.
     *
     * @return array{password: string, source: 'phone'|'random', reason: ?string}
     */
    public function issue(?Employee $employee): array
    {
        $digits = $this->digitsOf($employee?->mobile);

        if (strlen($digits) >= self::DIGITS) {
            return [
                'password' => substr($digits, -self::DIGITS),
                'source' => 'phone',
                'reason' => null,
            ];
        }

        return [
            'password' => $this->randomPassword(),
            'source' => 'random',
            'reason' => $employee === null
                ? 'The account is not linked to an employee record, so there is no number to take.'
                : (blank($employee->mobile)
                    ? 'No mobile number on the 201 file. Add one and reset again to use the last four digits.'
                    : 'The mobile number on file has fewer than four digits.'),
        ];
    }

    /** Convenience for the callers that hold a user rather than an employee. */
    public function issueFor(User $user): array
    {
        return $this->issue($user->employee);
    }

    /**
     * Digits only.
     *
     * Numbers arrive as `0917 123 4567`, `+63 917-123-4567` and every spacing
     * in between, so the separators are stripped before the last four are
     * taken. Otherwise the same person would get a different password
     * depending on how somebody typed their number into HR.
     */
    private function digitsOf(?string $mobile): string
    {
        return preg_replace('/\D+/', '', (string) $mobile) ?? '';
    }

    /**
     * The fallback, when there is no number to derive from.
     *
     * No O/0 or I/l/1 — the characters that generate "it says my password is
     * wrong" calls. Long enough to be worth having, since unlike the phone
     * digits this one has to carry its own weight.
     */
    public function randomPassword(): string
    {
        $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        $groups = [];

        for ($g = 0; $g < 3; $g++) {
            $chunk = '';
            for ($i = 0; $i < 4; $i++) {
                $chunk .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            $groups[] = $chunk;
        }

        return implode('-', $groups);
    }

    /**
     * Everyone whose account cannot use the phone rule yet.
     *
     * Surfaced so the gap is visible before somebody discovers it one person
     * at a time: at the moment this was written, not one of the forty
     * employees on file had a mobile number recorded.
     */
    public function missingNumbers()
    {
        return Employee::query()
            ->whereNotIn('employment_status', ['RESIGNED', 'TERMINATED'])
            ->where(function ($q) {
                $q->whereNull('mobile')->orWhere('mobile', '')->orWhereRaw('CHAR_LENGTH(REGEXP_REPLACE(mobile, "[^0-9]", "")) < ?', [self::DIGITS]);
            })
            ->orderBy('employee_no')
            ->get(['id', 'employee_no', 'first_name', 'last_name', 'mobile']);
    }
}
