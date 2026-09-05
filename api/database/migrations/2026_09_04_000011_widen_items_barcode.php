<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The barcode is about to start mirroring the SKU automatically, and `sku`
 * itself is allowed up to 48 characters while `barcode` was only ever
 * given 32 — real data never got close, but a rule that can silently
 * truncate a barcode on save is a bug waiting for a long SKU, not a
 * safeguard.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->string('barcode', 48)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->string('barcode', 32)->nullable()->change();
        });
    }
};
