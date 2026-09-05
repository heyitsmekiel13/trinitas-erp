<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where a person's card sits on the interactive org chart canvas.
 *
 * Deliberately separate from `reports_to_id`: that column is who actually
 * reports to whom, and drives the connecting line the chart draws. This is
 * only where the box happens to be dragged to — moving a card must never
 * silently reassign someone's manager, and reassigning a manager (from the
 * 201 file) must never silently move a card somebody already arranged.
 *
 * Null until the first drag: a chart nobody has ever arranged auto-lays out
 * from the hierarchy instead, so this only turns into a permanent record
 * once someone has actually customised it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->float('org_chart_x')->nullable()->after('reports_to_id');
            $table->float('org_chart_y')->nullable()->after('org_chart_x');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn(['org_chart_x', 'org_chart_y']);
        });
    }
};
