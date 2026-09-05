<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('photo_path')->nullable()->after('address');
            // The QR code on a printed badge has to keep working for the
            // employee's whole tenure, unlike a temporary signed URL (see
            // ChatAttachmentController) which is built to expire — so this is
            // a permanent, unguessable lookup key rather than a signature.
            $table->string('public_id_token', 40)->nullable()->unique()->after('photo_path');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn(['photo_path', 'public_id_token']);
        });
    }
};
