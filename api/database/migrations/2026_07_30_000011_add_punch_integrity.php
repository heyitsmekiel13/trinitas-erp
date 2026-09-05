<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Making a punch personal.
 *
 * Every employee signs in with the same default password, which means the
 * account proves nothing about who pressed the button. Three things change
 * that, in decreasing order of how much they actually prevent:
 *
 *  1. A PIN only the employee knows, asked for at the moment of punching
 *     rather than at sign-in. Sharing it becomes a deliberate act rather than
 *     something that happens because everyone already knows the password.
 *  2. Every press recorded as its own event with the device it came from, so
 *     one phone clocking in six people is visible instead of invisible.
 *  3. The punch can be fenced to the sites the company operates from.
 *
 * None of it stops a determined pair who agree to share a PIN. It stops the
 * casual case, and it leaves evidence for the rest.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            // Hashed, never stored or displayed in the clear.
            $table->string('punch_pin')->nullable()->after('shift_id');
            $table->timestamp('punch_pin_set_at')->nullable()->after('punch_pin');
        });

        /**
         * One row per press.
         *
         * `attendance_records` holds the day; this holds how the day was built,
         * which is what a buddy-punching investigation actually needs.
         */
        Schema::create('punch_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('attendance_record_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('action', ['in', 'break-out', 'break-in', 'out']);
            $table->dateTime('punched_at');

            // A per-browser identifier the client keeps. Not a security
            // control on its own — it is trivially cleared — but a shared
            // terminal keeps one, and that is what makes the pattern visible.
            $table->string('device_id', 64)->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();

            $table->boolean('is_flagged')->default(false);
            $table->string('flag_reason', 190)->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['device_id', 'punched_at']);
            $table->index(['employee_id', 'punched_at']);
            $table->index('is_flagged');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('punch_events');

        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn(['punch_pin', 'punch_pin_set_at']);
        });
    }
};
