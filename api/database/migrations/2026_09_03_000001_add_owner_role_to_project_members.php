<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE project_members MODIFY role ENUM('Owner', 'Lead', 'Member', 'Viewer') NOT NULL DEFAULT 'Member'");

        // Every project already has an owner via `projects.owner_id`, but
        // their membership row was stamped 'Lead' — bring it in line so the
        // people list reads the same role it always meant.
        DB::statement("
            UPDATE project_members pm
            INNER JOIN projects p ON p.owner_id = pm.user_id AND p.id = pm.project_id
            SET pm.role = 'Owner'
        ");
    }

    public function down(): void
    {
        DB::statement("UPDATE project_members SET role = 'Lead' WHERE role = 'Owner'");
        DB::statement("ALTER TABLE project_members MODIFY role ENUM('Lead', 'Member', 'Viewer') NOT NULL DEFAULT 'Member'");
    }
};
