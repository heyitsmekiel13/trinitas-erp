<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FuelRequest;
use App\Models\FuelRequestLeg;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\FuelPrice;
use App\Services\Mailer;
use App\Services\Router;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Fuel requests — the trip ticket, from asking to approving.
 *
 * The document exists to make one question answerable before the money is
 * spent: is this much fuel reasonable for this trip? So the route is not
 * decoration. The distance, the duration and the suggested litres are computed
 * on the server from the chosen pins and the vehicle's own economy, and they
 * are written onto the row at submission.
 *
 * That last part matters. The obvious implementation recalculates the route
 * when the approver opens the request, which means the approver can be shown a
 * different number from the one the requester saw — a routing service reroutes
 * around new roadworks and the litres move. An approval is a decision about
 * specific figures, so the figures are frozen when the decision is asked for.
 */
class FuelRequestController extends Controller
{
    /**
     * The station every order goes to.
     *
     * A field that is retyped identically on every form is a field that
     * eventually gets a typo, and a purchase order addressed to "Cherryfic Gas
     * Servce Station" is one the station can refuse. It stays editable — a
     * second supplier is a change of default, not a rewrite.
     */
    public const DEFAULT_SUPPLIER = 'Cherryfic Gas Service Station, Inc.';

    public function __construct(
        private readonly Router $router,
        private readonly Mailer $mailer,
        private readonly Settings $settings,
    ) {}

    /** The vehicle's own ownership, unless the trip says otherwise. */
    private function effectiveOwnership(?Vehicle $vehicle, ?string $requested): string
    {
        return $requested ?? $vehicle?->ownership ?? 'CO';
    }

    /**
     * Prices a route without saving anything.
     *
     * The form calls this as the pins move, so it is deliberately free of side
     * effects — no row, no reference number burned on a trip somebody is still
     * sketching out.
     */
    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'originLat' => 'required|numeric|between:-90,90',
            'originLng' => 'required|numeric|between:-180,180',
            'destinationLat' => 'required|numeric|between:-90,90',
            'destinationLng' => 'required|numeric|between:-180,180',
            'vehicleId' => 'nullable|integer|exists:vehicles,id',
            'roundTrip' => 'nullable|boolean',
            'reservePct' => 'nullable|integer|between:0,50',
            'fuelPrice' => 'nullable|numeric|min:0',
            'vehicleOwnership' => 'nullable|in:CO,PO,R&C',
        ]);

        $route = $this->router->route(
            (float) $data['originLat'],
            (float) $data['originLng'],
            (float) $data['destinationLat'],
            (float) $data['destinationLng'],
        );

        $roundTrip = (bool) ($data['roundTrip'] ?? true);
        $distance = round($route['distanceKm'] * ($roundTrip ? 2 : 1), 2);
        $minutes = (int) round($route['durationMinutes'] * ($roundTrip ? 2 : 1));

        $vehicle = isset($data['vehicleId']) ? Vehicle::find($data['vehicleId']) : null;
        $ownership = $this->effectiveOwnership($vehicle, $data['vehicleOwnership'] ?? null);
        $reserve = (int) ($data['reservePct'] ?? 10);

        if ($ownership === 'PO') {
            $rate = (float) $this->settings->get('logistics', 'ratePerKm', 12.0);

            return response()->json([
                'data' => [
                    'distanceKm' => $distance,
                    'durationMinutes' => $minutes,
                    'source' => $route['source'],
                    'note' => $route['note'],
                    'polyline' => $route['polyline'],
                    'roundTrip' => $roundTrip,
                    'vehicleOwnership' => $ownership,
                    'mileageRate' => $rate,
                    'mileageAmount' => round($distance * $rate, 2),
                ],
            ]);
        }

        $economy = $vehicle?->effectiveEconomy() ?? 6.0;
        $litres = $this->router->suggestLitres($distance, $economy, $reserve);
        $price = (float) ($data['fuelPrice'] ?? 0);

        return response()->json([
            'data' => [
                'distanceKm' => $distance,
                'durationMinutes' => $minutes,
                'source' => $route['source'],
                'note' => $route['note'],
                // One way only — drawing the return leg on top of the outbound
                // one just thickens the same line.
                'polyline' => $route['polyline'],
                'roundTrip' => $roundTrip,
                'vehicleOwnership' => $ownership,
                'kmPerLitre' => $economy,
                'reservePct' => $reserve,
                'suggestedLitres' => $litres,
                'estimatedCost' => round($litres * $price, 2),
            ],
        ]);
    }

    /**
     * The fields a request is made of.
     *
     * Shared by create and amend so the two can never drift — the classic way
     * an edit form ends up accepting something the create form rejects.
     */
    private function rules(): array
    {
        return [
            'vehicleId' => 'required|integer|exists:vehicles,id',
            'driverId' => 'nullable|integer|exists:employees,id',
            'purpose' => 'required|string|max:190',
            'departAt' => 'nullable|date',
            // One trip, one or more legs — a dispatch that runs several
            // destinations before coming home is still a single vehicle, a
            // single driver and a single approval, just several origin→
            // destination pairs priced and summed together.
            'legs' => 'required|array|min:1|max:8',
            'legs.*.originLabel' => 'required|string|max:255',
            'legs.*.originLat' => 'required|numeric|between:-90,90',
            'legs.*.originLng' => 'required|numeric|between:-180,180',
            'legs.*.destinationLabel' => 'required|string|max:255',
            'legs.*.destinationLat' => 'required|numeric|between:-90,90',
            'legs.*.destinationLng' => 'required|numeric|between:-180,180',
            'legs.*.roundTrip' => 'nullable|boolean',
            'reservePct' => 'nullable|integer|between:0,50',
            'fuelPrice' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string|max:2000',

            /* The purchase-order half of the form. */
            'businessUnit' => 'nullable|string|max:120',
            'supplier' => 'nullable|string|max:190',
            'vehicleOwnership' => 'nullable|in:CO,PO,R&C',
            'poCategory' => 'nullable|string|max:120',
            'products' => 'nullable|array',
            'products.*' => 'string|max:60',
            'productOther' => 'nullable|string|max:190',
            'unit' => 'nullable|string|max:24',
        ];
    }

    /**
     * Turns the submitted pins into the figures the form is decided on.
     *
     * Always recomputed from the coordinates rather than accepted from the
     * client: a distance the requester can type is a distance the requester
     * can choose, which defeats the point of measuring the trip at all.
     */
    /**
     * Routes and prices every leg, then sums them into the header figures.
     *
     * Each leg is measured exactly the way a single-leg trip always was —
     * same `Router::route()` call, same round-trip doubling — so a one-leg
     * trip prices identically to before. The `_legs` entry carries the
     * per-leg rows for `store()`/`update()` to write to `fuel_request_legs`;
     * it is not a database column and is stripped before the rest of this
     * array reaches `FuelRequest::create()`/`update()`.
     */
    private function priceFrom(array $data): array
    {
        $vehicle = Vehicle::findOrFail($data['vehicleId']);
        $ownership = $this->effectiveOwnership($vehicle, $data['vehicleOwnership'] ?? null);
        $reserve = (int) ($data['reservePct'] ?? 10);

        $rawLegs = array_values($data['legs']);
        $legs = [];
        $distance = 0.0;
        $minutes = 0;

        // Worst-case wins: one leg falling back to a straight-line estimate
        // makes the whole trip an estimate, whatever the others measured.
        $sourceRank = ['google' => 0, 'osrm' => 1, 'straight-line' => 2];
        $source = 'google';

        foreach ($rawLegs as $i => $leg) {
            $route = $this->router->route(
                (float) $leg['originLat'],
                (float) $leg['originLng'],
                (float) $leg['destinationLat'],
                (float) $leg['destinationLng'],
            );

            $legRoundTrip = (bool) ($leg['roundTrip'] ?? false);
            $legDistance = round($route['distanceKm'] * ($legRoundTrip ? 2 : 1), 2);
            $legMinutes = (int) round($route['durationMinutes'] * ($legRoundTrip ? 2 : 1));

            $distance += $legDistance;
            $minutes += $legMinutes;
            if ($sourceRank[$route['source']] > $sourceRank[$source]) {
                $source = $route['source'];
            }

            $legs[] = [
                'sequence' => $i,
                'origin_label' => $leg['originLabel'],
                'origin_lat' => $leg['originLat'],
                'origin_lng' => $leg['originLng'],
                'destination_label' => $leg['destinationLabel'],
                'destination_lat' => $leg['destinationLat'],
                'destination_lng' => $leg['destinationLng'],
                'round_trip' => $legRoundTrip,
                'distance_km' => $legDistance,
                'duration_minutes' => $legMinutes,
                'route_source' => $route['source'],
            ];
        }

        $distance = round($distance, 2);
        $first = $rawLegs[0];
        $last = $rawLegs[count($rawLegs) - 1];

        $base = [
            // Kept for anything still reading it, but only means something
            // for a genuinely single-leg trip now — a multi-leg dispatch's
            // "return" is just whichever legs say so individually.
            'round_trip' => count($rawLegs) === 1 && (bool) ($rawLegs[0]['roundTrip'] ?? false),
            'distance_km' => $distance,
            'duration_minutes' => $minutes,
            'route_source' => $source,
            'reserve_pct' => $reserve,
            'vehicle_ownership' => $ownership,
            // The header keeps a start-to-end summary — where the trip
            // first leaves from, and where it finally ends up — for the
            // list view, the print sheet and anything else still reading a
            // single origin/destination pair rather than the full itinerary.
            'origin_label' => $first['originLabel'],
            'origin_lat' => $first['originLat'],
            'origin_lng' => $first['originLng'],
            'destination_label' => $last['destinationLabel'],
            'destination_lat' => $last['destinationLat'],
            'destination_lng' => $last['destinationLng'],
            '_legs' => $legs,
        ];

        /*
         * The company doesn't dispense fuel for a car it doesn't own — a
         * personal-vehicle trip is priced as a mileage payout instead, and the
         * litres/cost figures stay at zero rather than a number nobody is
         * issuing.
         */
        if ($ownership === 'PO') {
            $rate = (float) $this->settings->get('logistics', 'ratePerKm', 12.0);

            return $base + [
                'km_per_litre' => 0,
                'suggested_litres' => 0,
                'fuel_price' => 0,
                'estimated_cost' => 0,
                'mileage_rate' => $rate,
                'mileage_amount' => round($distance * $rate, 2),
            ];
        }

        $economy = $vehicle->effectiveEconomy();
        $litres = $this->router->suggestLitres($distance, $economy, $reserve);
        $price = (float) ($data['fuelPrice'] ?? 0);

        return $base + [
            'km_per_litre' => $economy,
            'suggested_litres' => $litres,
            'fuel_price' => $price,
            'estimated_cost' => round($litres * $price, 2),
            'mileage_rate' => null,
            'mileage_amount' => null,
        ];
    }

    /**
     * The validated payload as database columns.
     *
     * `_legs` and the origin/destination summary are deliberately not
     * repeated here — `$figures` (from `priceFrom()`) already carries both
     * and wins the `+` merge below, so this only adds what `priceFrom()`
     * has no reason to know about.
     */
    private function columnsFrom(array $data, array $figures): array
    {
        return $figures + [
            'vehicle_id' => $data['vehicleId'],
            'driver_id' => $data['driverId'] ?? null,
            'purpose' => $data['purpose'],
            'depart_at' => $data['departAt'] ?? null,
            'notes' => $data['notes'] ?? null,

            'business_unit' => $data['businessUnit'] ?? null,
            'supplier' => $data['supplier'] ?: self::DEFAULT_SUPPLIER,
            // vehicle_ownership is deliberately not set here — $figures
            // already carries the resolved effective ownership (request
            // override, else the vehicle's own default) and wins the `+`
            // merge in `return $figures + [...]` above.
            'po_category' => $data['poCategory'] ?? null,
            'products' => $data['products'] ?? [],
            'product_other' => $data['productOther'] ?? null,
            'unit' => $data['unit'] ?? 'Litres',
        ];
    }

    /** Raises the request and freezes the figures it was raised on. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules());
        $columns = $this->columnsFrom($data, $this->priceFrom($data));
        $legs = $columns['_legs'];
        unset($columns['_legs']);

        $fuelRequest = FuelRequest::create(
            $columns + [
                'reference' => $this->nextReference(),
                'requested_by_id' => $request->user()?->id,
                'status' => 'Submitted',
                /*
                 * Charged to the issuer's own department unless they say
                 * otherwise. Asking somebody which department they work in,
                 * every time, on a form the system could answer for them, is
                 * the kind of question that gets answered wrong out of habit.
                 */
                'business_unit' => $data['businessUnit']
                    ?: $request->user()?->employee?->hrDepartment?->name,
            ],
        );

        $this->saveLegs($fuelRequest, $legs);

        return response()->json(['data' => $this->present($fuelRequest)], 201);
    }

    /** Legs are replaced wholesale on every save — simpler, and exactly as correct as diffing them. */
    private function saveLegs(FuelRequest $fuelRequest, array $legs): void
    {
        $fuelRequest->legs()->delete();
        $fuelRequest->legs()->createMany($legs);
    }

    /**
     * Amends a request that has not been decided yet.
     *
     * The route is recomputed rather than carried over, because the pins are
     * the whole basis of the quantity: moving the destination and keeping the
     * old distance leaves a form whose litres no longer follow from anything
     * printed on it.
     *
     * Refused the moment somebody has decided on it. An approval is a decision
     * about specific figures, and letting the requester change those figures
     * afterwards means the approver signed one document and the station reads
     * another — which is exactly why paper forms are filled in ink.
     */
    public function update(Request $request, FuelRequest $fuelRequest): JsonResponse
    {
        if (! in_array($fuelRequest->status, ['Draft', 'Submitted'], true)) {
            return response()->json([
                'message' => $fuelRequest->status === 'Issued'
                    ? "{$fuelRequest->reference} has already been issued and invoiced. Raise a fresh request rather than editing this one."
                    : "{$fuelRequest->reference} is {$fuelRequest->status} and can no longer be changed.",
            ], 422);
        }

        $data = $request->validate($this->rules());
        $columns = $this->columnsFrom($data, $this->priceFrom($data));
        $legs = $columns['_legs'];
        unset($columns['_legs']);

        $fuelRequest->update($columns);
        $this->saveLegs($fuelRequest, $legs);

        return response()->json(['data' => $this->present($fuelRequest->fresh())]);
    }

    /**
     * Withdraws a request without erasing it.
     *
     * The right answer for an approved trip that did not happen: the
     * authorisation is void but the paper trail survives, which is what
     * anybody reconciling the fuel bill later needs. Deleting it would leave a
     * hole in the reference sequence and no record of litres somebody signed
     * for.
     */
    public function cancel(Request $request, FuelRequest $fuelRequest): JsonResponse
    {
        if (in_array($fuelRequest->status, ['Issued', 'Cancelled'], true)) {
            return response()->json([
                'message' => $fuelRequest->status === 'Issued'
                    ? "{$fuelRequest->reference} has been issued and invoiced — it cannot be cancelled, only corrected on the next order."
                    : "{$fuelRequest->reference} is already cancelled.",
            ], 422);
        }

        $data = $request->validate(['reason' => 'nullable|string|max:500']);
        $reason = $data['reason'] ?? null;

        $fuelRequest->update([
            'status' => 'Cancelled',
            'decision_note' => trim(
                ($fuelRequest->decision_note ? $fuelRequest->decision_note."\n" : '')
                .'Cancelled'.($reason ? ': '.$reason : '')
            ),
        ]);

        return response()->json(['data' => $this->present($fuelRequest->fresh())]);
    }

    /**
     * Deletes a request outright.
     *
     * Only ever safe before anybody has authorised fuel against it. An
     * approved request is a commitment somebody put their name to and an
     * issued one is attached to an invoice; neither is a row to remove, so
     * both are refused with the reason and pointed at cancelling instead.
     */
    public function destroy(FuelRequest $fuelRequest): JsonResponse
    {
        if (in_array($fuelRequest->status, ['Approved', 'Issued'], true)) {
            return response()->json([
                'message' => $fuelRequest->status === 'Issued'
                    ? "{$fuelRequest->reference} has an invoice against it. Deleting it would break the trail from authorisation to bill."
                    : "{$fuelRequest->reference} has been approved — somebody authorised fuel against it. Cancel it instead, which keeps the record.",
            ], 422);
        }

        $reference = $fuelRequest->reference;
        $fuelRequest->delete();

        return response()->json(['data' => ['deleted' => true, 'reference' => $reference]]);
    }

    /**
     * Approves or rejects, and tells the people it concerns.
     *
     * One endpoint for both because they are the same act — a decision — and
     * splitting them produces two code paths that drift on who gets emailed.
     */
    public function decide(Request $request, FuelRequest $fuelRequest): JsonResponse
    {
        /** @var User|null $actor */
        $actor = $request->user();

        if (! FuelRequest::canApprove($actor)) {
            return response()->json([
                'message' => 'Fuel requests are approved by a supervisor, a manager or an administrator.',
            ], 403);
        }

        if ($fuelRequest->status !== 'Submitted') {
            return response()->json([
                'message' => "{$fuelRequest->reference} has already been {$fuelRequest->status}.",
            ], 422);
        }

        $data = $request->validate([
            'decision' => 'required|in:Approved,Rejected',
            // An approver may authorise fewer litres than were asked for, which
            // is the usual outcome of a review that actually reviews something.
            'approvedLitres' => 'nullable|numeric|min:0|max:5000',
            'note' => 'nullable|string|max:1000',
        ]);

        $approved = $data['decision'] === 'Approved';

        $fuelRequest->update([
            'status' => $data['decision'],
            'approved_litres' => $approved
                ? ($data['approvedLitres'] ?? $fuelRequest->suggested_litres)
                : null,
            'approved_by_id' => $actor->id,
            'approved_by_role' => FuelRequest::approverRole($actor),
            'decided_at' => now(),
            'decision_note' => $data['note'] ?? null,
        ]);

        $sent = $this->notify($fuelRequest->fresh(['vehicle', 'driver', 'requestedBy', 'approvedBy']));

        // Folded into `data` rather than a sibling `meta` key, because the web
        // client unwraps `data` and a delivery report nobody can read is the
        // same as not producing one.
        return response()->json([
            'data' => $this->present($fuelRequest->fresh()) + ['emailed' => $sent],
        ]);
    }

    /**
     * Emails the decision to the requester and the driver.
     *
     * Returns who it actually reached rather than a bare boolean: "approved,
     * but we have no email address for the driver" is something the approver
     * should see on screen, not discover when the truck leaves without a copy.
     */
    private function notify(FuelRequest $fuelRequest): array
    {
        $recipients = collect([
            $fuelRequest->requestedBy?->email,
            $fuelRequest->driver?->email,
        ])->filter()->unique()->values();

        $subject = sprintf(
            'Fuel request %s %s',
            $fuelRequest->reference,
            strtolower($fuelRequest->status),
        );

        $delivered = [];

        foreach ($recipients as $address) {
            $ok = $this->mailer->send(
                $address,
                $subject,
                'emails.fuel-request',
                ['request' => $fuelRequest],
                'fuel_request.decided',
                'FuelRequest',
                $fuelRequest->id,
            );

            $delivered[] = ['to' => $address, 'sent' => $ok];
        }

        return [
            'recipients' => $delivered,
            'missing' => array_values(array_filter([
                $fuelRequest->requestedBy && ! $fuelRequest->requestedBy->email ? 'the requester' : null,
                $fuelRequest->driver && ! $fuelRequest->driver->email ? 'the driver' : null,
            ])),
        ];
    }

    /**
     * The charge-sales invoice number, written on after the station bills it.
     *
     * The only field on the form filled in after the trip rather than before,
     * and the one that closes the loop between what was authorised and what
     * was actually charged. Left open to anybody who can see the request —
     * the custodian copying a number off an invoice is not making a decision.
     */
    public function recordInvoice(Request $request, FuelRequest $fuelRequest): JsonResponse
    {
        $data = $request->validate(['chargeInvoiceNo' => 'nullable|string|max:64']);

        if (! in_array($fuelRequest->status, ['Approved', 'Issued'], true)) {
            return response()->json([
                'message' => "{$fuelRequest->reference} has not been approved, so there is nothing for a station to invoice yet.",
            ], 422);
        }

        $fuelRequest->update([
            'charge_invoice_no' => $data['chargeInvoiceNo'] ?: null,
            // Recording the invoice is what turns an authorisation into a
            // completed issuance; there is no separate button for it.
            'status' => $data['chargeInvoiceNo'] ? 'Issued' : $fuelRequest->status,
        ]);

        return response()->json(['data' => $this->present($fuelRequest->fresh())]);
    }

    /**
     * Whether the signed-in account may decide on a fuel request.
     *
     * Not admin-gated: a fuel approver is often not an administrator at all,
     * just someone the superadmin named in Admin → Fuel Approvers. The queue
     * calls this once to decide whether to offer the Approve/Reject buttons
     * at all — `decide()` remains the actual authorization check.
     */
    public function canApprove(Request $request): JsonResponse
    {
        return response()->json(['data' => ['canApprove' => FuelRequest::canApprove($request->user())]]);
    }

    /**
     * Today's diesel price.
     *
     * See App\\Services\\FuelPrice for why this is a benchmark plus a local
     * differential rather than a scrape of a Petron station page — the short
     * version is that no such page exists.
     */
    public function price(Request $request, FuelPrice $prices): JsonResponse
    {
        return response()->json([
            'data' => $prices->current($request->boolean('refresh')),
        ]);
    }

    /** The printable form, with everything the paper version carries. */
    public function show(FuelRequest $fuelRequest): JsonResponse
    {
        return response()->json(['data' => $this->present($fuelRequest)]);
    }

    private function nextReference(): string
    {
        $year = now()->year;
        $last = FuelRequest::where('reference', 'like', "FR-{$year}-%")
            ->orderByDesc('id')
            ->value('reference');

        $sequence = $last ? ((int) substr($last, -4)) + 1 : 1;

        return sprintf('FR-%d-%04d', $year, $sequence);
    }

    private function present(FuelRequest $r): array
    {
        $r->loadMissing(['vehicle', 'driver', 'requestedBy', 'approvedBy', 'legs']);

        return [
            'legs' => $r->legs->map(fn (FuelRequestLeg $leg) => [
                'originLabel' => $leg->origin_label,
                'originLat' => (float) $leg->origin_lat,
                'originLng' => (float) $leg->origin_lng,
                'destinationLabel' => $leg->destination_label,
                'destinationLat' => (float) $leg->destination_lat,
                'destinationLng' => (float) $leg->destination_lng,
                'roundTrip' => (bool) $leg->round_trip,
                'distanceKm' => (float) $leg->distance_km,
                'durationMinutes' => (int) $leg->duration_minutes,
                'routeSource' => $leg->route_source,
            ])->values(),
            'id' => $r->id,
            'reference' => $r->reference,
            'status' => $r->status,
            'purpose' => $r->purpose,
            'vehicleId' => $r->vehicle_id,
            'vehicle' => $r->vehicle?->plate_no,
            'vehicleModel' => $r->vehicle?->model,
            'driverId' => $r->driver_id,
            'driver' => $r->driver?->full_name,
            'driverEmail' => $r->driver?->email,
            'requestedBy' => $r->requestedBy?->name,
            'departAt' => $r->depart_at?->toIso8601String(),
            'eta' => $r->eta?->toIso8601String(),
            'originLabel' => $r->origin_label,
            'originLat' => (float) $r->origin_lat,
            'originLng' => (float) $r->origin_lng,
            'destinationLabel' => $r->destination_label,
            'destinationLat' => (float) $r->destination_lat,
            'destinationLng' => (float) $r->destination_lng,
            'roundTrip' => (bool) $r->round_trip,
            'distanceKm' => (float) $r->distance_km,
            'durationMinutes' => (int) $r->duration_minutes,
            'routeSource' => $r->route_source,
            'kmPerLitre' => (float) $r->km_per_litre,
            'reservePct' => (int) $r->reserve_pct,
            'suggestedLitres' => (float) $r->suggested_litres,
            'approvedLitres' => $r->approved_litres === null ? null : (float) $r->approved_litres,
            'fuelPrice' => (float) $r->fuel_price,
            'estimatedCost' => (float) $r->estimated_cost,
            'mileageRate' => $r->mileage_rate === null ? null : (float) $r->mileage_rate,
            'mileageAmount' => $r->mileage_amount === null ? null : (float) $r->mileage_amount,
            'approvedBy' => $r->approvedBy?->name,
            'approvedByRole' => $r->approved_by_role,
            'decidedAt' => $r->decided_at?->toIso8601String(),
            'decisionNote' => $r->decision_note,
            'notes' => $r->notes,
            'createdAt' => $r->created_at?->toIso8601String(),

            'businessUnit' => $r->business_unit,
            'supplier' => $r->supplier,
            'vehicleOwnership' => $r->vehicle_ownership,
            'poCategory' => $r->po_category,
            'products' => $r->products ?? [],
            'productOther' => $r->product_other,
            'unit' => $r->unit,
            'chargeInvoiceNo' => $r->charge_invoice_no,
        ];
    }
}
