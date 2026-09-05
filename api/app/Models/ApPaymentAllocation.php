<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One slice of a payment applied to one bill. */
class ApPaymentAllocation extends Model
{
    protected $guarded = [];

    public function payment(): BelongsTo
    {
        return $this->belongsTo(ApPayment::class, 'ap_payment_id');
    }

    public function bill(): BelongsTo
    {
        return $this->belongsTo(ApBill::class, 'ap_bill_id');
    }
}
