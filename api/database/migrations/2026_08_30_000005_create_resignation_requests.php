<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The one thing an employee could not start themselves before now.
 *
 * Resignation only ever happened from the HR side — a status flip on the 201
 * file, or HR clicking "Initiate offboarding" ahead of it. An employee who
 * wanted to resign had no way to say so in the system; it happened as a
 * conversation, then somebody in HR typed it in after the fact. This is that
 * conversation's first step, made a record: the employee states an intended
 * last day, HR decides, and an *approval* is what starts the real offboarding
 * case — not the submission itself, which is a request, not yet a fact.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('resignation_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->date('intended_last_day');
            $table->text('reason')->nullable();
            $table->enum('status', ['Pending', 'Approved', 'Declined'])->default('Pending');
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 500)->nullable();
            // Set only once approval actually opens a case, so the request
            // and the case it produced stay traceable to each other.
            $table->foreignId('offboarding_case_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();

            $table->index(['employee_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('resignation_requests');
    }
};
