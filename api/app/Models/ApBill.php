<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ApBill extends Model
{
    protected $guarded = [];

    /** Stages where the company still owes something. */
    public const OPEN_STATUSES = ['Approved', 'Scheduled', 'Partially Paid', 'Overdue'];

    protected function casts(): array
    {
        return [
            'bill_date' => 'date',
            'due_date' => 'date',
        ];
    }

    /**
     * Outstanding balance and days-to-due follow from the bill and the payments
     * against it, never from typing.
     *
     * `days_to_due` is signed on purpose: negative means the supplier has been
     * waiting, and that is the number that decides who gets paid this Friday.
     */
    protected static function booted(): void
    {
        static::saving(function (ApBill $bill) {
            $bill->paid = round($bill->allocatedTotal(), 2);
            $bill->balance = round(max(0, (float) $bill->amount - (float) $bill->paid), 2);

            $today = CarbonImmutable::now()->startOfDay();
            $due = $bill->due_date ? CarbonImmutable::parse($bill->due_date)->startOfDay() : null;

            $bill->days_to_due = $due ? (int) $today->diffInDays($due, false) : 0;

            $overdueBy = $bill->balance > 0 ? max(0, -$bill->days_to_due) : 0;

            $bill->ageing_bucket = match (true) {
                $overdueBy <= 0 => 'Current',
                $overdueBy <= 30 => '1-30',
                $overdueBy <= 60 => '31-60',
                $overdueBy <= 90 => '61-90',
                default => '90+',
            };

            // Draft is a decision; Scheduled means somebody has put it in a
            // payment run. Everything else follows from the money.
            if (! in_array($bill->status, ['Draft', 'Scheduled'], true)) {
                $bill->status = match (true) {
                    $bill->balance <= 0.005 => 'Paid',
                    $overdueBy > 0 => 'Overdue',
                    (float) $bill->paid > 0 => 'Partially Paid',
                    default => 'Approved',
                };
            }
        });
    }

    /** What payments have applied to this bill. */
    public function allocatedTotal(): float
    {
        if (! $this->exists) {
            return 0.0;
        }

        return (float) ApPaymentAllocation::query()
            ->where('ap_bill_id', $this->id)
            ->whereHas('payment', fn ($q) => $q->where('status', 'Posted'))
            ->sum('amount');
    }

    public function getNetAmountAttribute(): float
    {
        return round((float) $this->amount - (float) $this->vat_amount, 2);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function supplierInvoice(): BelongsTo
    {
        return $this->belongsTo(SupplierInvoice::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(ApPaymentAllocation::class);
    }
}
