<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Forced password rotation.
 *
 * Accounts created by the employee import all share one default password, so
 * every one of them must be changed before the account can be used for
 * anything. The flag is on the user rather than inferred from a null
 * `password_changed_at`, because an administrator may also want to force a
 * rotation on an existing account.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('must_change_password')->default(false)->after('requires_auth_code');
            $table->timestamp('password_changed_at')->nullable()->after('must_change_password');

            // Most branch staff have no company mailbox — they sign in with an
            // employee number, not an address. MySQL allows repeated NULLs in a
            // unique index, so the constraint still holds for real addresses.
            $table->string('email')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['must_change_password', 'password_changed_at']);
            $table->string('email')->nullable(false)->change();
        });
    }
};
