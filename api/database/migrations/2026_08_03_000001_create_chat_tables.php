<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Workspace messaging.
 *
 * Four tables rather than one, because "delete" means two different things and
 * conflating them loses data somebody else still needs:
 *
 *   messages            what was said
 *   message_deletions   who has hidden it from their own view
 *   message_reactions   the little thumbs-up
 *   conversation_participants  who is in the room, and how far they have read
 *
 * Deleting for everyone blanks the body and stamps `deleted_at` on the message
 * itself — the row stays so replies to it still resolve and the audit trail
 * keeps a tombstone. Deleting for yourself writes a row in `message_deletions`
 * and touches nothing anybody else can see.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table) {
            $table->id();
            // `direct` is a two-person thread; `department` is created and kept
            // in step with the org chart; `group` is whatever somebody made.
            $table->enum('kind', ['direct', 'group', 'department'])->default('group');
            $table->string('name', 150)->nullable();
            $table->string('topic', 255)->nullable();
            // Emoji shown as the room's avatar, Messenger-style.
            $table->string('icon', 16)->nullable();
            $table->foreignId('hr_department_id')->nullable()->constrained('hr_departments')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            // Denormalised so the conversation list can sort without touching
            // the message table — that list is read on every poll.
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['kind', 'last_message_at']);
        });

        Schema::create('conversation_participants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->enum('role', ['member', 'admin'])->default('member');
            // How far this person has read. Drives the unread count and the
            // "Seen" markers without a row per message per reader.
            $table->foreignId('last_read_message_id')->nullable();
            $table->boolean('muted')->default(false);
            $table->timestamp('joined_at')->nullable();
            $table->timestamps();

            $table->unique(['conversation_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body')->nullable();
            // Threaded replies. Nullable on delete so a reply outlives its parent.
            $table->foreignId('reply_to_id')->nullable()->references('id')->on('messages')->nullOnDelete();
            // System lines — "Maria added Jose", "Group renamed".
            $table->boolean('is_system')->default(false);
            $table->timestamp('edited_at')->nullable();
            // Set when withdrawn for everyone; the row survives as a tombstone.
            $table->timestamp('deleted_at')->nullable();
            $table->foreignId('deleted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['conversation_id', 'id']);
        });

        /** One row per person who has hidden a message from their own view. */
        Schema::create('message_deletions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['message_id', 'user_id']);
        });

        Schema::create('message_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('emoji', 16);
            $table->timestamps();

            // One reaction per person per message — picking a second replaces
            // the first, which is how Messenger behaves.
            $table->unique(['message_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_reactions');
        Schema::dropIfExists('message_deletions');
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
    }
};
