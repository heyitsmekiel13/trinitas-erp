<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Platform: access control, approvals, audit, settings and security.
 *
 * These are the tables that make the ERP administrable without a developer —
 * roles and permissions, approval thresholds, the audit trail, SMTP and
 * branding settings, and the Geo-IP allow list.
 */
return new class extends Migration
{
    public function up(): void
    {
        /* ------------------------------ Access ------------------------------ */

        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('employee_id')->nullable()->after('id')->constrained()->nullOnDelete();
            $table->string('username', 64)->nullable()->unique()->after('employee_id');
            $table->string('avatar_path', 255)->nullable()->after('email');
            $table->boolean('is_super_admin')->default(false)->after('password');
            $table->boolean('requires_auth_code')->default(true)->after('is_super_admin');
            $table->enum('status', ['Active', 'Suspended', 'Locked', 'Invited'])->default('Active')->after('requires_auth_code');
            $table->unsignedTinyInteger('failed_attempts')->default(0)->after('status');
            $table->timestamp('locked_until')->nullable()->after('failed_attempts');
            $table->timestamp('last_login_at')->nullable()->after('locked_until');
            $table->string('last_login_ip', 45)->nullable()->after('last_login_at');
            $table->softDeletes();
        });

        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->string('code', 64)->unique();
            $table->string('name', 120);
            $table->string('description', 255)->nullable();
            // Locked roles cannot be deleted — they are wired into the workflow.
            $table->boolean('is_system')->default(false);
            $table->timestamps();
        });

        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->string('code', 96)->unique();      // e.g. sales.orders.approve
            $table->string('module', 64);              // e.g. sales
            $table->string('name', 150);
            $table->timestamps();

            $table->index('module');
        });

        Schema::create('permission_role', function (Blueprint $table) {
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('permission_id')->constrained()->cascadeOnDelete();
            $table->primary(['role_id', 'permission_id']);
        });

        Schema::create('role_user', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->primary(['user_id', 'role_id']);
        });

        /* ----------------------------- Approvals ---------------------------- */

        Schema::create('approval_rules', function (Blueprint $table) {
            $table->id();
            $table->string('document_type', 64);        // purchase_order, requisition…
            $table->string('name', 150);
            $table->decimal('min_amount', 14, 2)->default(0);
            $table->decimal('max_amount', 14, 2)->nullable();
            $table->unsignedTinyInteger('step')->default(1);
            $table->foreignId('approver_role_id')->nullable()->constrained('roles')->nullOnDelete();
            $table->foreignId('approver_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['document_type', 'step']);
        });

        Schema::create('approval_requests', function (Blueprint $table) {
            $table->id();
            $table->string('document_type', 64);
            $table->unsignedBigInteger('document_id');
            $table->string('document_no', 48)->nullable();
            $table->decimal('amount', 14, 2)->default(0);
            $table->unsignedTinyInteger('step')->default(1);
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->text('remarks')->nullable();
            $table->enum('status', ['Pending', 'Approved', 'Rejected', 'Cancelled'])->default('Pending');
            $table->timestamps();

            $table->index(['document_type', 'document_id']);
            $table->index(['assigned_to', 'status']);
        });

        /* ------------------------------- Audit ------------------------------ */

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('user_label', 120)->nullable();   // kept if the user is deleted
            $table->string('action', 64);                    // created, updated, approved…
            $table->string('entity_type', 96)->nullable();
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('entity_label', 190)->nullable();
            $table->string('module', 64)->nullable();
            $table->json('changes')->nullable();             // before/after diff
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->index(['entity_type', 'entity_id']);
            $table->index(['user_id', 'occurred_at']);
            $table->index('occurred_at');
        });

        /* ------------------------------ Security ---------------------------- */

        Schema::create('auth_codes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('challenge_id', 64)->unique();
            // Only the hash is stored, so a database leak cannot replay a code.
            $table->string('code_hash', 255);
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'expires_at']);
        });

        Schema::create('login_attempts', function (Blueprint $table) {
            $table->id();
            $table->string('username', 120);
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('ip_address', 45)->nullable();
            $table->string('country_code', 2)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->boolean('succeeded')->default(false);
            $table->string('failure_reason', 120)->nullable();
            $table->timestamp('attempted_at');
            $table->timestamps();

            $table->index(['username', 'attempted_at']);
            $table->index('ip_address');
        });

        Schema::create('geo_rules', function (Blueprint $table) {
            $table->id();
            $table->enum('kind', ['country', 'ip', 'cidr'])->default('country');
            $table->string('value', 64);                 // PH, 203.0.113.5, 203.0.113.0/24
            $table->string('label', 150)->nullable();
            $table->enum('effect', ['allow', 'block'])->default('allow');
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['kind', 'value']);
        });

        /* ------------------------------ Settings ---------------------------- */

        Schema::create('settings', function (Blueprint $table) {
            $table->id();
            $table->string('group', 48);                 // company, smtp, security, payroll
            $table->string('key', 96);
            $table->text('value')->nullable();
            $table->enum('type', ['string', 'integer', 'boolean', 'json', 'secret'])->default('string');
            $table->string('label', 190)->nullable();
            $table->string('description', 255)->nullable();
            $table->timestamps();

            $table->unique(['group', 'key']);
        });

        Schema::create('email_log', function (Blueprint $table) {
            $table->id();
            $table->string('to_address', 190);
            $table->string('subject', 255);
            $table->string('template', 96)->nullable();
            $table->string('event', 96)->nullable();       // po.approved, payroll.released…
            $table->string('reference_type', 64)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->enum('status', ['Queued', 'Sent', 'Failed'])->default('Queued');
            $table->text('error')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index('event');
        });

        Schema::create('notification_rules', function (Blueprint $table) {
            $table->id();
            $table->string('event', 96)->unique();
            $table->string('name', 150);
            $table->string('description', 255)->nullable();
            $table->boolean('email_enabled')->default(true);
            $table->boolean('in_app_enabled')->default(true);
            // Who gets it: role codes and/or literal addresses.
            $table->json('recipient_roles')->nullable();
            $table->json('recipient_emails')->nullable();
            $table->timestamps();
        });

        Schema::create('backups', function (Blueprint $table) {
            $table->id();
            $table->string('filename', 190);
            $table->string('path', 255);
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->enum('kind', ['manual', 'scheduled', 'pre-restore'])->default('manual');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('status', ['Running', 'Completed', 'Failed'])->default('Running');
            $table->text('error')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('backups');
        Schema::dropIfExists('notification_rules');
        Schema::dropIfExists('email_log');
        Schema::dropIfExists('settings');
        Schema::dropIfExists('geo_rules');
        Schema::dropIfExists('login_attempts');
        Schema::dropIfExists('auth_codes');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('approval_requests');
        Schema::dropIfExists('approval_rules');
        Schema::dropIfExists('role_user');
        Schema::dropIfExists('permission_role');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('roles');

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['employee_id']);
            $table->dropColumn([
                'employee_id', 'username', 'avatar_path', 'is_super_admin', 'requires_auth_code',
                'status', 'failed_attempts', 'locked_until', 'last_login_at', 'last_login_ip', 'deleted_at',
            ]);
        });
    }
};
