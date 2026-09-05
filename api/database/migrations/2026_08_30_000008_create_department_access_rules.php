<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which parts of the ERP an org-chart department is allowed to see.
 *
 * The nav's eight business departments (`web/src/app/registry.ts`) and the
 * real `hr_departments` table have never been linked — an employee's
 * `HrDepartment` says who they report to, and said nothing about what they
 * may open. This is that link, kept as data an administrator edits rather
 * than a mapping guessed once in code: the correspondence is not always
 * obvious (which nav department does "JBYL" belong to?), and the business's
 * idea of who should see what changes independently of the org chart.
 *
 * No row for a department is the safe reading, not an oversight — see
 * `DepartmentAccessGuard`. A department is restricted to nothing beyond the
 * universal tools until somebody deliberately grants it something.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('department_access_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('hr_department_id')->unique()->constrained()->cascadeOnDelete();
            $table->json('allowed_departments')->nullable();
            // Overrides `allowed_departments` — Process & Performance's own
            // row is expected to carry this, but any department can.
            $table->boolean('sees_all')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('department_access_rules');
    }
};
