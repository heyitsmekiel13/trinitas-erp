<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ArInvoice extends Model
{
    protected $guarded = [];

    /** Stages where the customer still owes something. */
    public const OPEN_STATUSES = ['Posted', 'Partially Paid', 'Overdue'];

    protected function casts(): array
    {
        return [
            'invoice_date' => 'date',
            'due_date' => 'date',
        ];
    }

    /**
     * What is owed, how late it is, and which ageing bucket it lands in are all
     * consequences of the invoice and the receipts against it.
     *
     * They were columns anyone could type, which meant an invoice could show a
     * zero balance while nothing had been collected, and the ageing report — the
     * report collections actually works from — could be quietly wrong.
     */
    protected static function booted(): void
    {
        static::saving(function (ArInvoice $invoice) {
            $invoice->paid = round($invoice->allocatedTotal(), 2);
            $invoice->balance = round(max(0, (float) $invoice->amount - (float) $invoice->paid), 2);

            $today = CarbonImmutable::now()->startOfDay();
            $due = $invoice->due_date ? CarbonImmutable::parse($invoice->due_date)->startOfDay() : null;

            // Only an unpaid invoice can be overdue. A settled one that was paid
            // late is history, not a collection problem.
            $daysOverdue = $due && $invoice->balance > 0 ? (int) $due->diffInDays($today, false) : 0;
            $invoice->days_overdue = max(0, $daysOverdue);

            $invoice->ageing_bucket = match (true) {
                $invoice->days_overdue <= 0 => 'Current',
                $invoice->days_overdue <= 30 => '1-30',
                $invoice->days_overdue <= 60 => '31-60',
                $invoice->days_overdue <= 90 => '61-90',
                default => '90+',
            };

            // Draft and Cancelled are decisions somebody made; the rest follow
            // from the money.
            if (! in_array($invoice->status, ['Draft', 'Cancelled'], true)) {
                $invoice->status = match (true) {
                    $invoice->balance <= 0.005 => 'Paid',
                    $invoice->days_overdue > 0 => 'Overdue',
                    (float) $invoice->paid > 0 => 'Partially Paid',
                    default => 'Posted',
                };
            }
        });
    }

    /** What receipts have applied to this invoice. */
    public function allocatedTotal(): float
    {
        if (! $this->exists) {
            return 0.0;
        }

        return (float) ArReceiptAllocation::query()
            ->where('ar_invoice_id', $this->id)
            ->whereHas('receipt', fn ($q) => $q->where('status', 'Posted'))
            ->sum('amount');
    }

    /** Net of VAT — what actually lands in the revenue account. */
    public function getNetAmountAttribute(): float
    {
        return round((float) $this->amount - (float) $this->vat_amount, 2);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function salesOrder(): BelongsTo
    {
        return $this->belongsTo(SalesOrder::class);
    }

    public function collector(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'collector_id');
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(ArReceiptAllocation::class);
    }
}
