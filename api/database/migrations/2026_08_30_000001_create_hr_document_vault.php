<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The 201 file as actual paper, not just fields.
 *
 * `employees` already tracks whether the *data* on a 201 file is complete
 * (see EmployeeProfile) — salary, TIN, SSS number and the like. Nothing
 * tracked whether the *documents* a 201 file is supposed to contain were ever
 * collected: the NBI clearance, the PSA birth certificate, the signed
 * contract. Those lived in a physical folder, if anywhere, and nobody could
 * answer "is this employee's file complete" without walking to the cabinet.
 *
 * `document_types` is the checklist every 201 file is measured against —
 * seeded once with the standard Philippine pre-employment/201 set, not
 * created per employee. `employee_documents` is one slot per employee per
 * type: at most one current file, because a re-upload after a rejection
 * replaces the slot rather than piling up versions nobody will ever open
 * again.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_types', function (Blueprint $table) {
            $table->id();
            $table->string('key', 64)->unique();
            $table->string('name', 150);
            $table->enum('category', [
                'Pre-Employment', 'Government-Mandated', 'Contract', 'Performance', 'Separation',
            ])->default('Pre-Employment');
            // Drives the completion percentage. An optional type never blocks it.
            $table->boolean('required')->default(true);
            // Some documents lapse (NBI clearance, medical certificate) and need
            // an expiry date on upload; most (diploma, contract) do not.
            $table->boolean('expires')->default(false);
            $table->unsignedSmallInteger('validity_months')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('employee_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('document_type_id')->constrained()->cascadeOnDelete();
            $table->string('disk_path', 255);
            $table->string('original_name', 255);
            $table->string('mime', 120)->nullable();
            $table->unsignedBigInteger('bytes')->default(0);
            $table->enum('status', ['Pending', 'Verified', 'Rejected', 'Expired'])->default('Pending');
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->date('expiry_date')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            // One current slot per employee per document type — a re-upload
            // replaces it rather than sitting alongside it as a second row.
            $table->unique(['employee_id', 'document_type_id']);
            $table->index(['status', 'expiry_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_documents');
        Schema::dropIfExists('document_types');
    }
};
