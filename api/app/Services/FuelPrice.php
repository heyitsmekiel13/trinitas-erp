<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * What a litre of diesel costs today.
 *
 * Worth being straight about what is and is not available, because the honest
 * answer shapes the design:
 *
 *   - Petron publishes no price API. Their site carries no machine-readable
 *     pump price, per-station or otherwise.
 *   - The Department of Energy's oil monitor is the authoritative Philippine
 *     source and it blocks non-browser clients.
 *   - No free feed exists for a *specific station's* pump price anywhere in
 *     the country. Station prices differ street to street and nobody
 *     publishes them.
 *
 * So this tracks the national diesel benchmark, which is real, current and
 * fetchable, and applies a local differential the business sets once from an
 * actual Petron Davao receipt. That combination moves with the market on its
 * own and stays anchored to the pump the fleet actually uses — which is the
 * outcome that was wanted, reached the only way that is actually available.
 *
 * The chain, in order:
 *
 *   custom      a URL and pattern set in Admin → Settings, for when the
 *               business gets a proper feed. Tried first so it always wins.
 *   benchmark   the national diesel average, scraped from a public page.
 *   remembered  the last figure that worked, persisted so an outage at the
 *               source does not leave the form with nothing.
 *   manual      a price typed into settings.
 *
 * Every result says where it came from and when. A price presented as live
 * when it is four weeks stale is worse than no price at all — somebody budgets
 * against it.
 */
class FuelPrice
{
    private const TIMEOUT_SECONDS = 12;

    /** Pump prices move weekly, on a Tuesday. Twice a day is plenty. */
    private const CACHE_HOURS = 12;

    /** Beyond this, the figure is called stale on screen rather than quoted. */
    private const STALE_DAYS = 14;

    private const BENCHMARK_URL = 'https://www.globalpetrolprices.com/Philippines/diesel_prices/';

    public function __construct(private readonly Settings $settings) {}

    /**
     * @return array{price: float, source: string, label: string, fetchedAt: ?string, stale: bool, note: string}
     */
    public function current(bool $fresh = false): array
    {
        if ($fresh) {
            Cache::forget('fuel-price');
        }

        return Cache::remember('fuel-price', now()->addHours(self::CACHE_HOURS), function () {
            $differential = (float) ($this->settings->get('fuel', 'davao_differential') ?? 0);

            if ($found = $this->viaCustom()) {
                return $this->finish($found, $differential);
            }

            if ($found = $this->viaBenchmark()) {
                $this->remember($found);

                return $this->finish($found, $differential);
            }

            if ($found = $this->remembered()) {
                return $this->finish($found, $differential);
            }

            return $this->finish([
                'price' => (float) ($this->settings->get('fuel', 'manual_price') ?? 65),
                'source' => 'manual',
                'label' => 'Set by hand in Settings',
                'fetchedAt' => $this->settings->get('fuel', 'manual_price_at'),
            ], $differential);
        });
    }

    /* ---------------------------------------------------------------------- */

    private function finish(array $found, float $differential): array
    {
        $fetchedAt = $found['fetchedAt'] ?? null;
        $age = $fetchedAt ? now()->diffInDays(Carbon::parse($fetchedAt)) : null;

        $price = round(((float) $found['price']) + $differential, 2);

        return [
            'price' => $price,
            'source' => $found['source'],
            'label' => $found['label'],
            'fetchedAt' => $fetchedAt,
            'stale' => $age !== null && abs($age) > self::STALE_DAYS,
            'note' => $differential != 0.0
                ? sprintf(
                    '%s, %s ₱%s Davao adjustment.',
                    $found['label'],
                    $differential > 0 ? 'plus' : 'less',
                    number_format(abs($differential), 2),
                )
                : $found['label'].'.',
        ];
    }

    /** A feed the business points us at. Tried first so it always wins. */
    private function viaCustom(): ?array
    {
        $url = $this->settings->get('fuel', 'price_url');

        if (! $url) {
            return null;
        }

        try {
            $body = Http::timeout(self::TIMEOUT_SECONDS)->get($url)->body();

            // A JSON feed with a `price` key, or a page matched by a pattern.
            $decoded = json_decode($body, true);
            if (is_array($decoded) && isset($decoded['price'])) {
                return [
                    'price' => (float) $decoded['price'],
                    'source' => 'custom',
                    'label' => 'From the configured price feed',
                    'fetchedAt' => now()->toIso8601String(),
                ];
            }

            $pattern = $this->settings->get('fuel', 'price_pattern');
            if ($pattern && preg_match($pattern, $body, $m) && isset($m[1])) {
                return [
                    'price' => (float) str_replace(',', '', $m[1]),
                    'source' => 'custom',
                    'label' => 'From the configured price page',
                    'fetchedAt' => now()->toIso8601String(),
                ];
            }
        } catch (\Throwable $e) {
            Log::warning('Custom fuel price source failed', ['error' => $e->getMessage()]);
        }

        return null;
    }

    /**
     * The national diesel average.
     *
     * Scraped, because the page is the only free public form this number takes.
     * Scraping is brittle by nature, so the failure path matters more than the
     * happy one: a changed layout returns null and the caller falls through to
     * the last remembered figure rather than to zero.
     */
    private function viaBenchmark(): ?array
    {
        try {
            $body = Http::timeout(self::TIMEOUT_SECONDS)
                ->withHeaders(['User-Agent' => 'TrinitasERP/1.0 (fleet fuel budgeting)'])
                ->get(self::BENCHMARK_URL)
                ->body();

            /*
             * Anchored on the sentence that carries today's price.
             *
             * A bare "PHP n per liter" match is wrong here, and quietly so:
             * the page's meta description opens with the *ten-year average*
             * in exactly that shape, so the loose pattern returned PHP 50.32
             * — a 2016-2026 mean — while the live figure further down the page
             * was PHP 85.50. The number looked entirely reasonable, which is
             * what made it dangerous.
             */
            if (! preg_match(
                '/current price of diesel fuel[^.]{0,120}?PHP\s*([0-9,]+(?:\.[0-9]+)?)\s*per\s*liter/i',
                $body,
                $m,
            )) {
                return null;
            }

            $price = (float) str_replace(',', '', $m[1]);

            /*
             * When the price was surveyed, not when we fetched it.
             *
             * Staleness is a property of the figure. Re-scraping an unchanged
             * page every twelve hours would otherwise keep resetting the clock
             * on a price that has not moved for a month.
             */
            $surveyed = preg_match('/latest update from\s*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})/i', $body, $d)
                ? Carbon::createFromFormat('j-M-Y', $d[1])->startOfDay()->toIso8601String()
                : now()->toIso8601String();

            // A plausibility gate. A layout change that leaves the regex
            // matching some unrelated number must not quietly set the fleet's
            // fuel price to 3 pesos or 900.
            if ($price < 20 || $price > 200) {
                Log::warning('Fuel benchmark out of plausible range', ['price' => $price]);

                return null;
            }

            return [
                'price' => $price,
                'source' => 'benchmark',
                'label' => 'National diesel benchmark',
                'fetchedAt' => $surveyed,
            ];
        } catch (\Throwable $e) {
            Log::warning('Fuel benchmark fetch failed', ['error' => $e->getMessage()]);

            return null;
        }
    }

    private function remember(array $found): void
    {
        $this->settings->set('fuel', 'last_price', (string) $found['price']);
        $this->settings->set('fuel', 'last_price_at', now()->toIso8601String());
    }

    private function remembered(): ?array
    {
        $price = $this->settings->get('fuel', 'last_price');

        return $price
            ? [
                'price' => (float) $price,
                'source' => 'remembered',
                'label' => 'Last price we could reach',
                'fetchedAt' => $this->settings->get('fuel', 'last_price_at'),
            ]
            : null;
    }
}
