<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who may approve a fuel request, by the superadmin's own hand.
 *
 * Replaces the old rule in `FuelRequest::canApprove()` — "anybody whose role
 * code contains 'manager' or 'supervisor'" — which nobody ever chose and
 * nobody could see. A row here is either a specific person or a whole role,
 * never both; `is_super_admin` stays a permanent bypass regardless of what's
 * in this table, so an administrator locked out of their own settings can
 * always still approve.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_approvers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('role_id')->nullable()->constrained()->cascadeOnDelete();
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_approvers');
    }
};
