<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The real grouping `pick_lists.wave` was always standing in for.
 *
 * A free-text field lets two people type "AM-1" and "am1" for what was
 * meant to be the same batch. A `pick_waves` row is one real batch, built
 * and released together — the string column stays for now so anything that
 * already reads it keeps working, but building a wave from here on assigns
 * `wave_id`, not a name somebody typed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pick_waves', function (Blueprint $table) {
            $table->id();
            $table->string('wave_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('zone', 32)->nullable();
            $table->dateTime('cutoff_at')->nullable();
            $table->enum('status', ['Building', 'Released', 'Completed'])->default('Building');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::table('pick_lists', function (Blueprint $table) {
            $table->foreignId('wave_id')->nullable()->after('wave')->constrained('pick_waves')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('pick_lists', function (Blueprint $table) {
            $table->dropConstrainedForeignId('wave_id');
        });

        Schema::dropIfExists('pick_waves');
    }
};
