<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Polls inside a conversation.
 *
 * A poll hangs off a message rather than replacing it, so it appears in the
 * thread in the order it was asked, quoting and replies keep working, and
 * withdrawing the message takes the poll with it.
 *
 *   polls          the question, and how it may be answered
 *   poll_options   the choices, in the order they were typed
 *   poll_votes     one row per person per option
 *
 * Votes are rows rather than a tally column because "who voted for what" is
 * the question people actually ask of a workplace poll — a counter can tell
 * you six chose Friday but not which six, and it cannot be corrected when
 * somebody changes their mind.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('polls', function (Blueprint $table) {
            $table->id();
            // The line in the thread this poll is attached to.
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('question', 255);
            // Whether one person may back more than one option.
            $table->boolean('allow_multiple')->default(false);
            // An anonymous poll still stores who voted — it has to, to stop
            // double voting — but never discloses it. See PollService.
            $table->boolean('is_anonymous')->default(false);
            // Null means open until somebody closes it by hand.
            $table->timestamp('closes_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();

            $table->index('conversation_id');
        });

        Schema::create('poll_options', function (Blueprint $table) {
            $table->id();
            $table->foreignId('poll_id')->constrained()->cascadeOnDelete();
            $table->string('label', 150);
            // Presentation order, so the choices read as they were written.
            $table->unsignedSmallInteger('position')->default(0);
            $table->timestamps();

            $table->index(['poll_id', 'position']);
        });

        Schema::create('poll_votes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('poll_id')->constrained()->cascadeOnDelete();
            $table->foreignId('poll_option_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            // One vote per person per option. A single-choice poll is enforced
            // in the service by clearing the previous vote first; this index
            // stops the same option being backed twice either way.
            $table->unique(['poll_option_id', 'user_id']);
            $table->index(['poll_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('poll_votes');
        Schema::dropIfExists('poll_options');
        Schema::dropIfExists('polls');
    }
};
