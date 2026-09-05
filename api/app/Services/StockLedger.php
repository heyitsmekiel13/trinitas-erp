<?php

namespace App\Services;

use App\Models\Item;
use App\Models\StockBalance;
use App\Models\StockMovement;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The only way stock quantities change.
 *
 * `stock_movements` was described in its own migration as "the immutable log of
 * every quantity change — the audit trail for stock", and nothing in the system
 * had ever written a row to it. Balances were whatever was seeded. That makes
 * every stock figure on every screen a decoration: you cannot ask why on-hand
 * is 240, because nothing recorded it becoming 240.
 *
 * Every method here does two things in one transaction — append a movement and
 * move the balance — so the log and the balance can never disagree. Nothing
 * else in the codebase should touch `stock_balances`.
 */
class StockLedger
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Stock arriving: a purchase receipt, a customer return, a transfer in.
     *
     * @param  Model|null  $reference  The document that caused the movement.
     */
    public function receive(
        int $itemId,
        int $warehouseId,
        float $quantity,
        string $reason = 'Receipt',
        ?Model $reference = null,
        ?string $batch = null,
        ?string $expiryDate = null,
        ?float $unitCost = null,
    ): StockBalance {
        $this->guardQuantity($quantity);

        return DB::transaction(function () use (
            $itemId, $warehouseId, $quantity, $reason, $reference, $batch, $expiryDate, $unitCost
        ) {
            $balance = $this->lockBalance($itemId, $warehouseId, $batch);

            // Cost follows the goods in. A weighted average keeps the value of
            // what is on the shelf honest when the same item arrives at
            // different prices, which is the normal case.
            $cost = $unitCost ?? (float) (Item::whereKey($itemId)->value('unit_cost') ?? 0);
            $existingValue = (float) $balance->on_hand * (float) $balance->unit_cost;
            $incomingValue = $quantity * $cost;
            $newOnHand = (float) $balance->on_hand + $quantity;

            $balance->fill([
                'on_hand' => $newOnHand,
                'unit_cost' => $newOnHand > 0 ? round(($existingValue + $incomingValue) / $newOnHand, 2) : $cost,
                'expiry_date' => $expiryDate ?? $balance->expiry_date,
            ]);
            $this->recalcAvailable($balance);
            $balance->save();

            $this->log($itemId, $warehouseId, 'in', $reason, $quantity, $cost, $reference);

            return $balance;
        });
    }

    /**
     * Stock leaving: a dispatch, a write-off, a transfer out.
     *
     * Refuses to take out more than is on hand. A negative balance is not a
     * data state anyone can act on — it means the count was wrong, and finding
     * that out at the point of issue is the whole purpose of a stock system.
     *
     * @throws ValidationException
     */
    public function issue(
        int $itemId,
        int $warehouseId,
        float $quantity,
        string $reason = 'Issue',
        ?Model $reference = null,
        ?string $batch = null,
    ): StockBalance {
        $this->guardQuantity($quantity);

        return DB::transaction(function () use ($itemId, $warehouseId, $quantity, $reason, $reference, $batch) {
            $balance = $this->lockBalance($itemId, $warehouseId, $batch);

            if ((float) $balance->on_hand < $quantity) {
                $item = Item::find($itemId);
                throw ValidationException::withMessages([
                    'quantity' => sprintf(
                        'Only %s of %s on hand — cannot issue %s.',
                        rtrim(rtrim(number_format((float) $balance->on_hand, 2), '0'), '.'),
                        $item?->sku ?? "item {$itemId}",
                        rtrim(rtrim(number_format($quantity, 2), '0'), '.'),
                    ),
                ]);
            }

            $balance->on_hand = (float) $balance->on_hand - $quantity;
            $this->recalcAvailable($balance);
            $balance->save();

            $this->log($itemId, $warehouseId, 'out', $reason, $quantity, (float) $balance->unit_cost, $reference);

            return $balance;
        });
    }

    /**
     * Corrects a balance to a counted figure.
     *
     * Takes the target quantity rather than a delta, because that is what a
     * counter actually knows: they counted 238, not "minus two". The difference
     * is worked out here and logged as an adjustment in whichever direction it
     * falls.
     *
     * @return array{before: float, after: float, delta: float}
     */
    public function adjustTo(
        int $itemId,
        int $warehouseId,
        float $countedQuantity,
        ?Model $reference = null,
        ?string $batch = null,
        string $reason = 'Adjustment',
    ): array {
        if ($countedQuantity < 0) {
            throw ValidationException::withMessages(['quantity' => 'A counted quantity cannot be negative.']);
        }

        return DB::transaction(function () use ($itemId, $warehouseId, $countedQuantity, $reference, $batch, $reason) {
            $balance = $this->lockBalance($itemId, $warehouseId, $batch);

            $before = (float) $balance->on_hand;
            $delta = round($countedQuantity - $before, 2);

            if ($delta === 0.0) {
                return ['before' => $before, 'after' => $before, 'delta' => 0.0];
            }

            $balance->on_hand = $countedQuantity;
            $this->recalcAvailable($balance);
            $balance->save();

            $this->log(
                $itemId,
                $warehouseId,
                $delta > 0 ? 'in' : 'out',
                $reason,
                abs($delta),
                (float) $balance->unit_cost,
                $reference,
            );

            return ['before' => $before, 'after' => $countedQuantity, 'delta' => $delta];
        });
    }

    /**
     * Moves stock between warehouses as two halves of one transaction.
     *
     * Either both legs happen or neither does — stock in transit that left the
     * source but never reached the destination is how inventory goes missing on
     * paper.
     *
     * @throws ValidationException
     */
    public function transfer(
        int $itemId,
        int $fromWarehouseId,
        int $toWarehouseId,
        float $quantity,
        ?Model $reference = null,
    ): void {
        if ($fromWarehouseId === $toWarehouseId) {
            throw ValidationException::withMessages([
                'toWarehouseId' => 'A transfer needs two different warehouses.',
            ]);
        }

        DB::transaction(function () use ($itemId, $fromWarehouseId, $toWarehouseId, $quantity, $reference) {
            $source = $this->issue($itemId, $fromWarehouseId, $quantity, 'Transfer Out', $reference);
            $this->receive(
                $itemId,
                $toWarehouseId,
                $quantity,
                'Transfer In',
                $reference,
                // Cost travels with the goods rather than being re-read from
                // the item master, so a transfer does not silently revalue.
                unitCost: (float) $source->unit_cost,
            );
        });
    }

    /**
     * Reserves stock against a document without moving it.
     *
     * Available is what can still be promised; on-hand is what is physically
     * there. Allocating for a released pick list stops the same cases being
     * sold twice while they wait on the floor.
     */
    public function allocate(int $itemId, int $warehouseId, float $quantity, ?string $batch = null): StockBalance
    {
        return DB::transaction(function () use ($itemId, $warehouseId, $quantity, $batch) {
            $balance = $this->lockBalance($itemId, $warehouseId, $batch);

            // Allocation is clamped at what exists — over-allocating would make
            // `available` negative, which no screen can render usefully.
            $balance->allocated = max(0, min((float) $balance->on_hand, (float) $balance->allocated + $quantity));
            $this->recalcAvailable($balance);
            $balance->save();

            return $balance;
        });
    }

    /* ---------------------------------------------------------------------- */

    /**
     * The balance row for this item, warehouse and batch, locked for update.
     *
     * Created on first movement rather than pre-seeded: a warehouse should not
     * carry a row for every item in the catalogue it has never held.
     */
    private function lockBalance(int $itemId, int $warehouseId, ?string $batch): StockBalance
    {
        $existing = StockBalance::query()
            ->where('item_id', $itemId)
            ->where('warehouse_id', $warehouseId)
            ->where(fn ($q) => $batch === null ? $q->whereNull('batch') : $q->where('batch', $batch))
            ->lockForUpdate()
            ->first();

        if ($existing) {
            return $existing;
        }

        return StockBalance::create([
            'item_id' => $itemId,
            'warehouse_id' => $warehouseId,
            'batch' => $batch,
            'on_hand' => 0,
            'allocated' => 0,
            'available' => 0,
            'unit_cost' => (float) (Item::whereKey($itemId)->value('unit_cost') ?? 0),
        ]);
    }

    /** `available` is stored so reorder scans can index it, so keep it true. */
    private function recalcAvailable(StockBalance $balance): void
    {
        $balance->available = max(0, (float) $balance->on_hand - (float) $balance->allocated);
    }

    private function log(
        int $itemId,
        int $warehouseId,
        string $direction,
        string $reason,
        float $quantity,
        float $unitCost,
        ?Model $reference,
    ): void {
        StockMovement::create([
            'item_id' => $itemId,
            'warehouse_id' => $warehouseId,
            'direction' => $direction,
            'reason' => $reason,
            'quantity' => round($quantity, 2),
            'unit_cost' => round($unitCost, 2),
            'reference_type' => $reference ? class_basename($reference) : null,
            'reference_id' => $reference?->getKey(),
            'performed_by' => auth()->id(),
            'moved_at' => now(),
        ]);
    }

    /** @throws ValidationException */
    private function guardQuantity(float $quantity): void
    {
        if ($quantity <= 0) {
            throw ValidationException::withMessages([
                'quantity' => 'A stock movement needs a quantity greater than zero.',
            ]);
        }
    }

    /**
     * Brings a document's stock effect in line with what it now says.
     *
     * This is the only safe way to handle a document that can be posted,
     * corrected and un-posted. Asking "has this ever moved stock?" is not good
     * enough — after an un-post the log still has rows, so a naive check
     * concludes the work is done and a re-post silently moves nothing.
     *
     * Instead the net position is derived from the log and compared with what
     * the document should have moved, then only the difference is posted. First
     * post, re-save, quantity correction, un-post and re-post all fall out of
     * the same arithmetic.
     *
     * @param  array<int, float>  $desired  itemId => quantity this document should have moved.
     */
    public function reconcile(
        Model $reference,
        int $warehouseId,
        array $desired,
        string $inReason = 'Receipt',
        string $outReason = 'Issue',
    ): void {
        // Scoped to one warehouse, because a document can move stock in two
        // places at once — a transfer takes goods out of the source and puts
        // them into the destination under the same reference, and each leg has
        // to reconcile against its own movements rather than the other's.
        $posted = StockMovement::query()
            ->where('reference_type', class_basename($reference))
            ->where('reference_id', $reference->getKey())
            ->where('warehouse_id', $warehouseId)
            ->get(['item_id', 'direction', 'quantity'])
            ->groupBy('item_id')
            ->map(fn ($rows) => round($rows->sum(
                fn ($m) => $m->direction === 'in' ? (float) $m->quantity : -(float) $m->quantity,
            ), 2));

        // Items that were on the document and no longer are must go back too.
        foreach ($posted->keys() as $itemId) {
            $desired[(int) $itemId] ??= 0.0;
        }

        foreach ($desired as $itemId => $quantity) {
            $delta = round($quantity - (float) ($posted[$itemId] ?? 0), 2);

            if ($delta > 0) {
                $this->receive((int) $itemId, $warehouseId, $delta, $inReason, $reference);
            } elseif ($delta < 0) {
                $this->issue((int) $itemId, $warehouseId, abs($delta), $outReason, $reference);
            }
        }
    }

    /**
     * Reverses every movement a document made, for when it is un-posted.
     *
     * Deliberately posts opposite movements rather than deleting the originals:
     * the log is meant to be immutable, and "we received it then sent it back"
     * is a different fact from "it never arrived".
     */
    public function reverse(Model $reference): int
    {
        $movements = StockMovement::query()
            ->where('reference_type', class_basename($reference))
            ->where('reference_id', $reference->getKey())
            ->get();

        foreach ($movements as $movement) {
            $method = $movement->direction === 'in' ? 'issue' : 'receive';
            $this->{$method}(
                $movement->item_id,
                $movement->warehouse_id,
                (float) $movement->quantity,
                'Adjustment',
                $reference,
            );
        }

        if ($movements->isNotEmpty()) {
            $this->audit->log(
                'reversed stock movements',
                class_basename($reference),
                $reference->getKey(),
                $movements->count().' movement(s)',
                'warehouse',
            );
        }

        return $movements->count();
    }
}
