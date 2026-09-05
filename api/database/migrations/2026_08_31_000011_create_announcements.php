<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Company-wide (or one-department) notices — the thing a bulletin board did
 * before this existed. `published_at` lets one be written today and held
 * for tomorrow; `expires_at` is what keeps a notice from outliving its
 * relevance (a "office closed Monday" notice nobody wants to still see in
 * March). `hr_department_id` null means everyone; set, it means only that
 * department sees it in Self-Service — HR itself still sees every
 * announcement regardless, the same way department-scoping elsewhere in
 * this app never restricts HR's own screens.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->string('title', 190);
            $table->text('body');
            $table->foreignId('hr_department_id')->nullable()->constrained()->cascadeOnDelete();
            $table->boolean('pinned')->default(false);
            $table->dateTime('published_at');
            $table->dateTime('expires_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['published_at', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
