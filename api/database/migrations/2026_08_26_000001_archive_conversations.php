<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Getting a conversation out of the way without taking it from anybody else.
 *
 * The list only grew. Every direct message ever started and every department
 * room somebody was added to stayed at the top of it forever, and there was no
 * way to put one down — so the thread you actually need is four scrolls below
 * a conversation that ended in March.
 *
 * Archiving is on the participant row rather than the conversation, because it
 * is a statement about one person's list and not about the room. Archiving a
 * thread you share with somebody must not remove it from theirs; that would be
 * one person deleting another person's mail.
 *
 * `conversations` already had `softDeletes()` from the original chat migration
 * and nothing ever used it. That is the other half of this: deleting a room
 * for everybody, which stays deliberately rare and restricted to a group's own
 * admin — a direct thread and a department room are not one person's to
 * destroy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable()->after('muted');

            // The list reads "mine, not archived" on every poll.
            $table->index(['user_id', 'archived_at']);
        });
    }

    public function down(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'archived_at']);
            $table->dropColumn('archived_at');
        });
    }
};
