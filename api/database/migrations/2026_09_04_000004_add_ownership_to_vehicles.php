<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Not every vehicle on a trip ticket belongs to the company. An employee
 * driving their own car on official business is common enough that the trip
 * ticket already asks the question per-trip (`fuel_requests.vehicle_ownership`)
 * — this puts the same classification on the vehicle record itself, so the
 * fleet list can show it at a glance and a trip ticket can default from it
 * instead of asking every time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            $table->enum('ownership', ['CO', 'PO', 'R&C'])->default('CO')->after('status');
            $table->foreignId('owner_employee_id')->nullable()->after('ownership')
                ->constrained('employees')->nullOnDelete();
            $table->enum('vehicle_type', ['Sedan', 'Pickup', 'Van', 'Truck', 'Motorcycle'])
                ->nullable()->after('owner_employee_id');
        });
    }

    public function down(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropConstrainedForeignId('owner_employee_id');
            $table->dropColumn(['ownership', 'vehicle_type']);
        });
    }
};
