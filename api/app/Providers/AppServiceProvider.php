<?php

namespace App\Providers;

use App\Models\Employee;
use App\Models\Item;
use App\Observers\EmployeeObserver;
use App\Observers\ItemObserver;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // One instance per request. It caches the holiday table and each
        // person's leave; a compliance scan asks about the same dates
        // thousands of times, and a fresh instance per call would turn a two
        // second job into a two minute one.
        $this->app->singleton(\App\Services\WorkingCalendar::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Keeps a sign-in account in step with the employee record behind it.
        // Registered here rather than in a controller because `employees` is
        // written from the resource endpoint, the masterfile importer, the
        // seeders and tinker — an observer catches all four.
        Employee::observe(EmployeeObserver::class);

        // The barcode mirrors the SKU whenever it's left blank — see
        // ItemObserver for why this lives here rather than in the resource
        // endpoint alone.
        Item::observe(ItemObserver::class);
    }
}
