<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A project's own extra fields, not the fixed set (assignee, due date,
 * priority...) every task already carries.
 *
 * JSON on both sides, matching the precedent already in this schema
 * (`task_comments.mentions`, `automation_rules.conditions`) rather than a
 * new EAV table: `custom_field_defs` on the project is the ordered list of
 * {key, label, type, options?} a field-definition editor writes to, and
 * `custom_fields` on the task is just {key: value} against whatever the
 * project currently defines. Nothing enforces the two stay in lockstep at
 * the database level — a field removed from the project leaves its old
 * values sitting harmlessly in whichever tasks had them, the same way a
 * deleted column leaves a spreadsheet's old rows alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->json('custom_field_defs')->nullable()->after('icon');
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->json('custom_fields')->nullable()->after('progress');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('custom_field_defs');
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->dropColumn('custom_fields');
        });
    }
};
