<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two genuinely missing pieces of the 201 file.
 *
 * `sex` is asked for on the SSS E-1, the PhilHealth PMRF, and the BIR forms
 * this system already exports schedules for — there was nowhere on the
 * employee record to hold the answer. An emergency contact is close to the
 * most standard field a 201 file has, and the form had every other contact
 * detail except this one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->enum('sex', ['Male', 'Female'])->nullable()->after('civil_status');
            $table->string('emergency_contact_name', 150)->nullable()->after('address');
            $table->string('emergency_contact_relationship', 60)->nullable()->after('emergency_contact_name');
            $table->string('emergency_contact_phone', 40)->nullable()->after('emergency_contact_relationship');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn(['sex', 'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone']);
        });
    }
};
