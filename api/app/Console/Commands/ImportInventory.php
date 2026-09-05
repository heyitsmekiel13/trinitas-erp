<?php

namespace App\Console\Commands;

use App\Models\Item;
use App\Models\StockBalance;
use App\Models\Warehouse;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Imports the QuickBooks inventory count into the two real locations.
 *
 * The business runs one showroom and one warehouse, and the QuickBooks export
 * is a per-location count of both. This command makes the ERP agree with that
 * count: it settles the two locations, creates any item it has not seen before,
 * and sets each location's balance to the counted figure.
 *
 * Rerunnable on purpose. A fresh export every month should be importable
 * without hand-unpicking the last one, so items are matched on their SKU and
 * balances are *set* rather than added to. The alternative — adding — silently
 * doubles the shelf the second time somebody runs it.
 *
 *   php artisan inventory:import --dry-run     # report only, touches nothing
 *   php artisan inventory:import
 */
class ImportInventory extends Command
{
    protected $signature = 'inventory:import
        {--file= : CSV produced by database/data/extract_qb_inventory.py}
        {--dry-run : Show what would change without writing}
        {--prune : Zero the balances of items absent from this export}';

    protected $description = 'Import the QuickBooks inventory count into the showroom and the warehouse';

    /**
     * The two locations, as they physically exist.
     *
     * Coordinates are the ones off the map pins, not the city centre — the
     * delivery distance between them is 8 km of Davao traffic, and a city-level
     * guess would put both at the same point and report zero.
     */
    private const LOCATIONS = [
        'showroom' => [
            'code' => 'PKE-SHOWROOM',
            'name' => 'PKE Showroom',
            'type' => 'Branch Warehouse',
            'city' => 'Davao City',
            'latitude' => 7.1063172,
            'longitude' => 125.6326981,
            // Pallet capacity is not recorded for either site. Zero reads as
            // "not measured" throughout the app; a guessed figure would drive a
            // utilisation bar that means nothing.
            'capacity_pallets' => 0,
            'used_pallets' => 0,
            'is_default_origin' => false,
        ],
        'warehouse' => [
            'code' => 'PKE-WAREHOUSE',
            'name' => 'PKE Main Warehouse',
            'type' => 'Distribution Center',
            'city' => 'Davao City',
            'latitude' => 7.1588019,
            'longitude' => 125.6543379,
            'capacity_pallets' => 0,
            'used_pallets' => 0,
            // Deliveries load here, so this is where a run is costed from.
            'is_default_origin' => true,
        ],
    ];

    /** Category -> the middle block of the SKU. */
    private const CATEGORY_CODES = [
        'Small Items' => 'SML',
        'Spare Parts' => 'SPR',
        'Equipment' => 'EQP',
        'Electrical Supplies' => 'ELC',
        'Local Fabrication' => 'FAB',
        'Construction Materials' => 'CON',
        'Defective Units' => 'DEF',
        'Service Unit' => 'SVC',
        'Convan' => 'CVN',
        'Uncategorised' => 'GEN',
    ];

    public function handle(): int
    {
        $file = $this->option('file') ?: database_path('data/qb_inventory.csv');

        if (! is_readable($file)) {
            $this->error("Cannot read {$file}.");
            $this->line('Run: python database/data/extract_qb_inventory.py "QB Inventory.xlsx"');

            return self::FAILURE;
        }

        $rows = $this->read($file);
        if (! $rows) {
            $this->error('The export produced no item rows.');

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        $this->line(sprintf(
            '%d item%s in the export · showroom %s · warehouse %s',
            count($rows),
            count($rows) === 1 ? '' : 's',
            number_format(array_sum(array_column($rows, 'showroom')), 2),
            number_format(array_sum(array_column($rows, 'warehouse')), 2),
        ));

        if ($dryRun) {
            $this->warn('Dry run — nothing will be written.');
        }

        $stats = ['locations' => 0, 'created' => 0, 'matched' => 0, 'balances' => 0, 'pruned' => 0];

        $run = function () use ($rows, &$stats) {
            [$showroom, $warehouse] = $this->settleLocations($stats);
            $this->importItems($rows, $showroom, $warehouse, $stats);

            if ($this->option('prune')) {
                $this->prune($rows, $stats);
            }
        };

        if ($dryRun) {
            // Everything runs, nothing survives — the counts reported are real.
            DB::beginTransaction();
            $run();
            DB::rollBack();
        } else {
            DB::transaction($run);
        }

        $this->newLine();
        $this->info(sprintf(
            '%s %d location%s · %d new item%s · %d matched · %d balance%s set%s',
            $dryRun ? 'Would touch' : 'Imported:',
            $stats['locations'],
            $stats['locations'] === 1 ? '' : 's',
            $stats['created'],
            $stats['created'] === 1 ? '' : 's',
            $stats['matched'],
            $stats['balances'],
            $stats['balances'] === 1 ? '' : 's',
            $stats['pruned'] ? sprintf(' · %d pruned', $stats['pruned']) : '',
        ));

        return self::SUCCESS;
    }

    /**
     * Reads the CSV, merging rows that name the same item in the same category.
     *
     * QuickBooks permits the same name twice under one parent; two lines for one
     * physical item means one item holding the sum, not two items each holding
     * half.
     */
    private function read(string $file): array
    {
        $handle = fopen($file, 'r');
        $header = fgetcsv($handle);
        if (! $header) {
            return [];
        }

        $merged = [];
        $duplicates = 0;

        while (($line = fgetcsv($handle)) !== false) {
            $row = array_combine($header, $line);
            $name = trim((string) $row['name']);
            if ($name === '') {
                continue;
            }

            $category = trim((string) $row['category']) ?: 'Uncategorised';
            $key = mb_strtolower($category.'|'.$name);

            if (isset($merged[$key])) {
                $merged[$key]['showroom'] += (float) $row['showroom'];
                $merged[$key]['warehouse'] += (float) $row['warehouse'];
                $duplicates++;

                continue;
            }

            $merged[$key] = [
                'category' => $category,
                'name' => $name,
                'description' => trim((string) ($row['description'] ?? '')),
                'showroom' => (float) $row['showroom'],
                'warehouse' => (float) $row['warehouse'],
            ];
        }
        fclose($handle);

        if ($duplicates) {
            $this->warn("{$duplicates} duplicate line(s) merged into the item they repeat.");
        }

        return array_values($merged);
    }

    /**
     * Brings the warehouse list down to the two that exist.
     *
     * Existing rows are renamed in place rather than replaced, because stock
     * movements, pick lists and receipts already point at their ids — deleting
     * and recreating would either break those references or orphan them.
     */
    private function settleLocations(array &$stats): array
    {
        $existing = Warehouse::orderBy('id')->get();
        $out = [];

        foreach (self::LOCATIONS as $index => $spec) {
            // Reuse a row already carrying this code, else the next spare one.
            $warehouse = $existing->firstWhere('code', $spec['code'])
                ?? $existing->reject(fn ($w) => in_array($w->id, array_map(fn ($x) => $x->id, $out), true))->first();

            if ($warehouse) {
                $warehouse->fill($spec)->save();
            } else {
                $warehouse = Warehouse::create($spec + ['is_active' => true]);
            }

            $stats['locations']++;
            $out[$index] = $warehouse;
        }

        // Anything left over is a demo site with no place in a two-site business.
        $keep = array_map(fn ($w) => $w->id, $out);
        $surplus = $existing->reject(fn ($w) => in_array($w->id, $keep, true));

        foreach ($surplus as $warehouse) {
            $held = StockBalance::where('warehouse_id', $warehouse->id)->sum('on_hand');
            if ($held > 0) {
                $this->warn("{$warehouse->name} still holds {$held} units — deactivated rather than removed.");
            }
            $warehouse->update(['is_active' => false]);
        }

        return [$out['showroom'], $out['warehouse']];
    }

    private function importItems(array $rows, Warehouse $showroom, Warehouse $warehouse, array &$stats): void
    {
        // One query rather than 2,000: match on name within category, which is
        // all the export gives us to match on.
        $existing = Item::withTrashed()->get()->keyBy(fn ($item) => mb_strtolower($item->category.'|'.$item->name));
        $bySku = Item::withTrashed()->get()->keyBy(fn ($item) => mb_strtoupper($item->sku));

        // Sequences continue from whatever is already in the catalogue, so a
        // second import does not reissue codes the first one handed out.
        $sequences = [];
        foreach ($bySku as $sku => $_) {
            if (preg_match('/^PKE-([A-Z]{3})-(\d+)$/', (string) $sku, $m)) {
                $sequences[$m[1]] = max($sequences[$m[1]] ?? 0, (int) $m[2]);
            }
        }

        $bar = $this->output->createProgressBar(count($rows));
        $bar->start();

        foreach ($rows as $row) {
            $key = mb_strtolower($row['category'].'|'.$row['name']);
            $item = $existing->get($key);

            if ($item) {
                $stats['matched']++;
            } else {
                $code = self::CATEGORY_CODES[$row['category']] ?? $this->codeFor($row['category']);
                $sequences[$code] = ($sequences[$code] ?? 0) + 1;

                $item = Item::create([
                    'sku' => sprintf('PKE-%s-%04d', $code, $sequences[$code]),
                    'name' => Str::limit($row['name'], 185, ''),
                    'category' => $row['category'],
                    'brand' => null,
                    // The export counts pieces; it carries no pack size.
                    'uom' => 'PCS',
                    'pack_size' => $row['description'] !== '' ? Str::limit($row['description'], 30, '') : null,
                    // QuickBooks exported quantities only. Costing stays at zero
                    // until a real cost arrives, rather than inventing one that
                    // would flow straight into stock valuation.
                    'unit_cost' => 0,
                    'sell_price' => 0,
                    'abc_class' => 'C',
                    'is_active' => $row['category'] !== 'Defective Units',
                    'is_spare_part' => $row['category'] === 'Spare Parts',
                ]);

                $existing->put($key, $item);
                $stats['created']++;
            }

            $this->setBalance($item, $showroom, (float) $row['showroom'], $stats);
            $this->setBalance($item, $warehouse, (float) $row['warehouse'], $stats);

            $bar->advance();
        }

        $bar->finish();
        $this->newLine();
    }

    /**
     * Sets one location's balance to the counted figure.
     *
     * Allocation is preserved: stock already promised to an order is still
     * promised after a count. Available is stored rather than derived so the
     * reorder scan can index it, so it is recomputed here too.
     */
    private function setBalance(Item $item, Warehouse $warehouse, float $counted, array &$stats): void
    {
        $balance = StockBalance::firstOrNew([
            'item_id' => $item->id,
            'warehouse_id' => $warehouse->id,
            'batch' => null,
        ]);

        $allocated = (float) ($balance->allocated ?? 0);

        $balance->fill([
            'on_hand' => $counted,
            'allocated' => min($allocated, $counted),
            'available' => max(0, $counted - min($allocated, $counted)),
            'unit_cost' => $balance->unit_cost ?: $item->unit_cost,
        ])->save();

        $stats['balances']++;
    }

    /** Zeroes anything the export no longer lists, so the count is complete. */
    private function prune(array $rows, array &$stats): void
    {
        $present = collect($rows)
            ->map(fn ($row) => mb_strtolower($row['category'].'|'.$row['name']))
            ->flip();

        foreach (Item::all() as $item) {
            if ($present->has(mb_strtolower($item->category.'|'.$item->name))) {
                continue;
            }

            $zeroed = StockBalance::where('item_id', $item->id)
                ->where('on_hand', '>', 0)
                ->update(['on_hand' => 0, 'allocated' => 0, 'available' => 0]);

            $stats['pruned'] += $zeroed;
        }
    }

    /** A three-letter code for a category the map does not name. */
    private function codeFor(string $category): string
    {
        $letters = mb_strtoupper(preg_replace('/[^A-Za-z]/', '', $category));

        return $letters === '' ? 'GEN' : str_pad(mb_substr($letters, 0, 3), 3, 'X');
    }
}
