<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The four things that separate a message list from a messaging app.
 *
 * The chat already had the hard parts right — threaded replies, reactions,
 * edit, withdraw-for-everyone, a read pointer per participant. What it could
 * not do is everything people actually reach for when they are trying to sort
 * something out quickly:
 *
 *   attachments   You cannot send a photo. In a business where half the
 *                 conversations are about a broken machine, that is the
 *                 feature, not a nicety — a picture of the fault settles in
 *                 one message what six messages of description will not.
 *
 *   typing        Without it, a two-second pause is indistinguishable from
 *                 being ignored, so people re-send.
 *
 *   presence      "Is anyone actually there" decides whether you wait for an
 *                 answer or pick up the phone. Guessing wrong wastes both.
 *
 *   pinning       Every group thread eventually has one message that matters
 *                 more than the rest — an address, a cut-off time, a decision
 *                 — and it scrolls away within the hour.
 */
return new class extends Migration
{
    public function up(): void
    {
        /**
         * Files hanging off a message.
         *
         * A table rather than a column because one message routinely carries
         * several photos, and because the metadata is worth keeping: the
         * original filename is what somebody searches for a month later, and
         * the dimensions let the bubble reserve the right space before the
         * image loads instead of jumping when it does.
         */
        Schema::create('message_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();

            /* `image` renders inline; everything else is a chip with a
               download. Audio is split out because a voice note wants a player
               rather than a link. */
            $table->enum('kind', ['image', 'video', 'audio', 'file'])->default('file');
            $table->string('disk_path', 255);
            $table->string('original_name', 255);
            $table->string('mime', 120)->nullable();
            $table->unsignedBigInteger('bytes')->default(0);
            /* Null for a file. Set for an image so the bubble can hold its
               shape while the picture is still arriving. */
            $table->unsignedSmallInteger('width')->nullable();
            $table->unsignedSmallInteger('height')->nullable();
            $table->timestamps();

            $table->index(['conversation_id', 'kind']);
        });

        Schema::table('conversations', function (Blueprint $table) {
            /* One pinned message per room. Several would need an ordering and
               a UI to manage it; one covers the case that actually comes up. */
            $table->foreignId('pinned_message_id')->nullable()->after('last_message_at')
                ->references('id')->on('messages')->nullOnDelete();
            $table->foreignId('pinned_by')->nullable()->after('pinned_message_id')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('pinned_at')->nullable()->after('pinned_by');
        });

        Schema::table('conversation_participants', function (Blueprint $table) {
            /**
             * When this person last signalled they were typing.
             *
             * A timestamp rather than a boolean, because a flag needs somebody
             * to clear it and the one moment you cannot rely on is the browser
             * that closed mid-sentence. Anything older than a few seconds is
             * simply not typing any more — no cleanup job required.
             */
            $table->timestamp('last_typing_at')->nullable()->after('muted');
        });

        Schema::table('users', function (Blueprint $table) {
            /**
             * Last sign of life, for presence.
             *
             * On the users table rather than per conversation: being online is
             * a property of the person, and duplicating it per room is how the
             * green dot ends up disagreeing with itself across two threads.
             */
            $table->timestamp('last_seen_at')->nullable()->after('remember_token');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_attachments');

        Schema::table('conversations', function (Blueprint $table) {
            $table->dropConstrainedForeignKey('pinned_by');
            $table->dropForeign(['pinned_message_id']);
            $table->dropColumn(['pinned_message_id', 'pinned_by', 'pinned_at']);
        });

        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->dropColumn('last_typing_at');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('last_seen_at');
        });
    }
};
