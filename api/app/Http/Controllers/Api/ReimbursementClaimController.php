<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FuelRequest;
use App\Models\ReimbursementClaim;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Deciding a reimbursement claim, and the one cross-link a plain CRUD screen
 * cannot express: raising a claim straight from the trip that earned it.
 *
 * Everything else — list, create, edit, delete a Draft claim — goes through
 * the generic registry at `finance/reimbursements` in `config/erp.php`. This
 * controller only holds what needs an authorization check or a computation
 * the generic writer has no way to run.
 */
class ReimbursementClaimController extends Controller
{
    /**
     * A claim pre-filled from a personally-owned vehicle's already-decided
     * trip — the distance, the rate and the amount are the trip's own
     * figures, not retyped. The claim itself is still a Draft: the vehicle
     * owner reviews it before submitting, the same as any other claim.
     */
    public function createFromFuelRequest(FuelRequest $fuelRequest): JsonResponse
    {
        $fuelRequest->loadMissing('vehicle.ownerEmployee', 'driver', 'requestedBy.employee');

        if ($fuelRequest->vehicle_ownership !== 'PO') {
            return response()->json([
                'message' => "{$fuelRequest->reference} was not made in a personally-owned vehicle, so there is no mileage to reimburse.",
            ], 422);
        }

        if (! in_array($fuelRequest->status, ['Approved', 'Issued'], true)) {
            return response()->json([
                'message' => "{$fuelRequest->reference} has not been approved yet — reimbursement follows the trip's own approval.",
            ], 422);
        }

        if (ReimbursementClaim::where('fuel_request_id', $fuelRequest->id)->exists()) {
            return response()->json([
                'message' => "{$fuelRequest->reference} already has a reimbursement claim.",
            ], 422);
        }

        // Whoever owns the vehicle is who gets paid back. Falls back to the
        // driver, then the requester, for a personal vehicle whose owner was
        // never recorded on the fleet list — the claim can still be raised,
        // just naming the most likely person rather than refusing outright.
        $employeeId = $fuelRequest->vehicle?->owner_employee_id
            ?? $fuelRequest->driver_id
            ?? $fuelRequest->requestedBy?->employee?->id;

        if (! $employeeId) {
            return response()->json([
                'message' => 'Could not tell who to reimburse — set an owner on the vehicle in Fleet & Vehicles first.',
            ], 422);
        }

        $claim = ReimbursementClaim::create([
            'claim_no' => $this->nextClaimNo(),
            'employee_id' => $employeeId,
            'category' => 'Mileage',
            'claim_date' => now()->toDateString(),
            'amount' => (float) $fuelRequest->mileage_amount,
            'description' => "Mileage — {$fuelRequest->reference} ({$fuelRequest->origin_label} → {$fuelRequest->destination_label})",
            'distance_km' => (float) $fuelRequest->distance_km,
            'rate_per_km' => (float) $fuelRequest->mileage_rate,
            'fuel_request_id' => $fuelRequest->id,
            'status' => 'Draft',
        ]);

        return response()->json(['data' => $this->present($claim)], 201);
    }

    public function approve(Request $request, ReimbursementClaim $claim): JsonResponse
    {
        if ($claim->status !== 'Submitted') {
            return response()->json(['message' => "{$claim->claim_no} is {$claim->status} and cannot be approved from there."], 422);
        }

        $data = $request->validate(['note' => 'nullable|string|max:500']);

        $claim->update([
            'status' => 'Approved',
            'approved_by_id' => $request->user()?->id,
            'decided_at' => now(),
            'decision_note' => $data['note'] ?? null,
        ]);

        return response()->json(['data' => $this->present($claim->fresh())]);
    }

    public function reject(Request $request, ReimbursementClaim $claim): JsonResponse
    {
        if (! in_array($claim->status, ['Submitted', 'Approved'], true)) {
            return response()->json(['message' => "{$claim->claim_no} is {$claim->status} and cannot be rejected from there."], 422);
        }

        $data = $request->validate(['note' => 'required|string|max:500']);

        $claim->update([
            'status' => 'Rejected',
            'approved_by_id' => $request->user()?->id,
            'decided_at' => now(),
            'decision_note' => $data['note'],
        ]);

        return response()->json(['data' => $this->present($claim->fresh())]);
    }

    public function markPaid(Request $request, ReimbursementClaim $claim): JsonResponse
    {
        if ($claim->status !== 'Approved') {
            return response()->json(['message' => "{$claim->claim_no} must be approved before it can be marked paid."], 422);
        }

        $data = $request->validate(['paymentReference' => 'nullable|string|max:120']);

        $claim->update([
            'status' => 'Paid',
            'paid_at' => now(),
            'payment_reference' => $data['paymentReference'] ?? null,
        ]);

        return response()->json(['data' => $this->present($claim->fresh())]);
    }

    private function nextClaimNo(): string
    {
        $year = now()->year;
        $last = ReimbursementClaim::where('claim_no', 'like', "RC-{$year}-%")
            ->orderByDesc('id')
            ->value('claim_no');

        $sequence = $last ? ((int) substr($last, -4)) + 1 : 1;

        return sprintf('RC-%d-%04d', $year, $sequence);
    }

    private function present(ReimbursementClaim $c): array
    {
        $c->loadMissing(['employee', 'approvedBy', 'fuelRequest']);

        return [
            'id' => $c->id,
            'claimNo' => $c->claim_no,
            'employeeId' => $c->employee_id,
            'employee' => $c->employee?->full_name,
            'category' => $c->category,
            'claimDate' => $c->claim_date?->toDateString(),
            'amount' => (float) $c->amount,
            'description' => $c->description,
            'receiptPath' => $c->receipt_path,
            'fuelRequestId' => $c->fuel_request_id,
            'fuelRequestReference' => $c->fuelRequest?->reference,
            'distanceKm' => $c->distance_km === null ? null : (float) $c->distance_km,
            'ratePerKm' => $c->rate_per_km === null ? null : (float) $c->rate_per_km,
            'status' => $c->status,
            'approvedBy' => $c->approvedBy?->name,
            'decidedAt' => $c->decided_at?->toIso8601String(),
            'decisionNote' => $c->decision_note,
            'paidAt' => $c->paid_at?->toIso8601String(),
            'paymentReference' => $c->payment_reference,
        ];
    }
}
