<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * Clears the forced-password-change flag from existing accounts.
 *
 * The business decided that people are issued the last four digits of their
 * mobile number and are not made to change it at the door. That decision only
 * governs credentials issued from now on — the forty accounts already on file
 * were flagged under the old rule and would each still hit the change-password
 * wall on their next sign-in, which is exactly the thing that was asked to go
 * away.
 *
 * The column stays. It is still the right mechanism for an account that has
 * been compromised, or for an administrator who wants to force one person to
 * pick a new password; nothing sets it by default any more.
 *
 * The bootstrap super-admin is deliberately left alone. It is the account that
 * can reach every setting in the system, it is not a person, and its password
 * is published in the seeder — that one should still be changed on first use.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'must_change_password')) {
            return;
        }

        User::query()
            ->where('must_change_password', true)
            ->where('is_super_admin', false)
            ->update(['must_change_password' => false]);
    }

    public function down(): void
    {
        // Not reversed. Re-flagging every account would force a password
        // change on people who have since chosen their own, which is worse
        // than leaving the flag clear.
    }
};
