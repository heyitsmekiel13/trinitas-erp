<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Support tickets — a person raises a concern, an administrator resolves it.
 *
 * Two audiences on one table, which is the whole point. The person who raised
 * it sees their own thread and nothing else; the administrator sees every
 * ticket in the company. Both are reading the same row, so there is no way for
 * "what the user was told" and "what the admin recorded" to drift apart — a
 * failure mode that a separate internal-notes system invites, and the reason
 * `internal` on a message is a flag rather than a second table.
 *
 * Deliberately not modelled on the disciplinary case tables next door. A case
 * is something done *to* an employee and carries due process; a ticket is
 * something an employee asks *for*, and treating the two the same would put a
 * support request in the same shape as a written warning.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('support_tickets', function (Blueprint $table) {
            $table->id();
            $table->string('reference', 24)->unique();      // TKT-2026-0001

            $table->string('subject', 200);
            $table->text('body');

            $table->enum('category', [
                'Access', 'Payroll', 'Attendance', 'System fault',
                'Data correction', 'Equipment', 'Request', 'Other',
            ])->default('Other');

            $table->enum('priority', ['Low', 'Normal', 'High', 'Urgent'])->default('Normal');

            /*
             * `Waiting on you` is the status that stops a ticket dying quietly.
             *
             * Without it, an administrator who asks a clarifying question has
             * no way to say so, the ticket sits in the same bucket as the ones
             * nobody has touched, and the queue stops telling anyone who is
             * actually blocked.
             */
            $table->enum('status', ['Open', 'In progress', 'Waiting on you', 'Resolved', 'Closed'])->default('Open');

            // Who asked. Never null — a ticket with no author cannot be
            // answered, and the request was explicitly that people raise these
            // from their own account.
            $table->foreignId('raised_by')->constrained('users')->cascadeOnDelete();
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();

            $table->text('resolution')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('closed_at')->nullable();

            // Set when the raiser rates the outcome, so "resolved" can be
            // distinguished from "resolved to their satisfaction".
            $table->unsignedTinyInteger('satisfaction')->nullable();

            // Touched on every message, so a queue can be ordered by which
            // conversation has gone quiet longest rather than by created date.
            $table->timestamp('last_activity_at')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'priority', 'last_activity_at']);
            $table->index(['raised_by', 'status']);
        });

        Schema::create('support_ticket_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('body');

            /*
             * An administrator's working note.
             *
             * Filtered out of every response the raiser can reach — see
             * SupportController. Kept on the same thread rather than in a
             * separate table so the order of events survives: a note written
             * between two replies belongs between them, and reconstructing
             * that from two tables by timestamp is how the sequence gets lost.
             */
            $table->boolean('internal')->default(false);

            $table->timestamps();
            $table->index(['ticket_id', 'created_at']);
        });

        Schema::create('support_ticket_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('message_id')->nullable()->constrained('support_ticket_messages')->cascadeOnDelete();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('disk', 32)->default('public');
            $table->string('path', 500);
            $table->string('original_name', 250);
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->unsignedSmallInteger('width')->nullable();
            $table->unsignedSmallInteger('height')->nullable();

            $table->timestamps();
            $table->index('ticket_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_ticket_attachments');
        Schema::dropIfExists('support_ticket_messages');
        Schema::dropIfExists('support_tickets');
    }
};
