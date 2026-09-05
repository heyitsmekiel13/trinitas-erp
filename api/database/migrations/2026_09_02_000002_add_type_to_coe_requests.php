<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A second kind of request through the same channel: not "confirm I work
 * here" but "confirm I have no unresolved disciplinary case" — the same
 * self-service submit, the same HR review queue, the same issued-document
 * download, just a different letter and a different thing HR is actually
 * attesting to.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('coe_requests', function (Blueprint $table) {
            $table->enum('type', ['Employment', 'No Derogatory Record'])->default('Employment')->after('employee_id');
        });
    }

    public function down(): void
    {
        Schema::table('coe_requests', function (Blueprint $table) {
            $table->dropColumn('type');
        });
    }
};
