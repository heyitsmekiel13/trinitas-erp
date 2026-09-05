<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An unrated account is not a nought-star account.
 *
 * The column was NOT NULL with a default of zero, but the form offers the
 * rating as optional and sends null when it is left blank — so creating a
 * customer without picking a rating failed outright with a constraint
 * violation rather than a message anybody could act on.
 *
 * Making it nullable fixes the save and states the difference honestly: a
 * customer nobody has assessed yet reads as "—", not as the worst score
 * available.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->decimal('rating', 3, 1)->nullable()->default(null)->change();
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->decimal('rating', 3, 1)->default(0)->nullable(false)->change();
        });
    }
};
