<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Setting;
use App\Models\User;
use App\Services\GeoGuard;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * System status and the first-run checklist.
 *
 * Answers the questions an administrator actually asks: is the database
 * reachable, is it the right one, what still needs configuring before this can
 * be used for real work.
 */
class SystemController extends Controller
{
    public function __construct(
        private readonly Settings $settings,
        private readonly GeoGuard $geoGuard,
    ) {}

    /**
     * Public branding, for the sign-in screen and the booking portal.
     *
     * Deliberately a narrow projection of the company settings — name, address,
     * TIN, currency and logo. Anything an unauthenticated caller has no
     * business seeing (contact email, fiscal configuration) stays out.
     */
    public function branding(): JsonResponse
    {
        $company = $this->settings->group('company');

        return response()->json(['data' => [
            'legal_name' => $company['legal_name'] ?? null,
            'trade_name' => $company['trade_name'] ?? null,
            'address' => $company['address'] ?? null,
            'tin' => $company['tin'] ?? null,
            'currency' => $company['currency'] ?? 'PHP',
            'fiscal_year_start' => $company['fiscal_year_start'] ?? 1,
            'logo_path' => $company['logo_path'] ?? null,
            // Every password screen — reset, forced first change, self-service
            // change — reads this instead of each hardcoding its own number,
            // so raising it in Settings takes effect everywhere at once.
            'min_password_length' => $this->settings->get('security', 'min_password_length', 4),
        ]]);
    }

    /** Public: safe to call before sign-in so the setup screen can orient. */
    public function status(Request $request): JsonResponse
    {
        $database = $this->databaseStatus();

        return response()->json(['data' => [
            'application' => [
                'name' => config('app.name'),
                'environment' => app()->environment(),
                'debug' => (bool) config('app.debug'),
                'version' => '0.1.0',
                'laravel' => app()->version(),
                'php' => PHP_VERSION,
            ],
            'database' => $database,
            'connection' => $this->geoGuard->describe($request->ip()),
            'checklist' => $database['connected'] ? $this->checklist() : [],
        ]]);
    }

    private function databaseStatus(): array
    {
        $connection = config('database.default');
        $config = config("database.connections.{$connection}");

        try {
            DB::connection()->getPdo();

            $version = match ($connection) {
                'mysql', 'mariadb' => DB::selectOne('SELECT VERSION() AS v')->v,
                'sqlite' => 'SQLite '.DB::selectOne('SELECT sqlite_version() AS v')->v,
                default => 'unknown',
            };

            return [
                'connected' => true,
                'driver' => $connection,
                'name' => $config['database'] ?? null,
                'host' => $config['host'] ?? null,
                'port' => $config['port'] ?? null,
                'version' => $version,
                'migrated' => Schema::hasTable('employees'),
                'tables' => $this->tableCount($connection),
            ];
        } catch (\Throwable $e) {
            return [
                'connected' => false,
                'driver' => $connection,
                'name' => $config['database'] ?? null,
                'host' => $config['host'] ?? null,
                'port' => $config['port'] ?? null,
                // The raw PDO message names the host and user, which is exactly
                // what makes a connection problem fixable.
                'error' => $e->getMessage(),
            ];
        }
    }

    private function tableCount(string $connection): int
    {
        return match ($connection) {
            'mysql', 'mariadb' => (int) DB::selectOne(
                'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE()'
            )->c,
            'sqlite' => (int) DB::selectOne(
                "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )->c,
            default => 0,
        };
    }

    /**
     * What still needs doing before the system is production-ready. Each item
     * is deliberately checkable from data, never from a "setup complete" flag
     * that can drift from reality.
     */
    private function checklist(): array
    {
        $company = $this->settings->group('company');
        $smtp = $this->settings->group('smtp');

        $bootstrapUntouched = User::where('username', 'superadmin')
            ->whereNotNull('id')
            ->exists() && User::count() === 1;

        return [
            [
                'key' => 'database',
                'label' => 'Database connected and tables created',
                'done' => Schema::hasTable('employees'),
                'hint' => 'Run SETUP DATABASE.bat in the project folder.',
            ],
            [
                'key' => 'company',
                'label' => 'Company details and logo',
                'done' => filled($company['legal_name'] ?? null) && filled($company['address'] ?? null),
                'hint' => 'Appears on every printed report and exported document.',
            ],
            [
                'key' => 'smtp',
                'label' => 'Email sending configured',
                'done' => (bool) ($smtp['enabled'] ?? false) && filled($smtp['host'] ?? null),
                'hint' => 'Needed for sign-in codes and approval notifications.',
            ],
            [
                'key' => 'admin',
                'label' => 'Bootstrap password changed',
                'done' => ! $bootstrapUntouched,
                'hint' => 'The superadmin account still uses its install password.',
            ],
            [
                'key' => 'employees',
                'label' => 'Employees imported',
                'done' => Employee::exists(),
                'hint' => 'Import your AUB masterfile under HR → Employees.',
            ],
            [
                'key' => 'settings',
                'label' => 'Security policy reviewed',
                'done' => Setting::where('group', 'security')->where('updated_at', '>', now()->subYears(10))
                    ->whereColumn('updated_at', '>', 'created_at')->exists(),
                'hint' => 'Session timeout, auth codes and lockout thresholds.',
            ],
        ];
    }
}
