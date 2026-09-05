<?php

use App\Models;
use App\Models\User;

/**
 * The API resource registry.
 *
 * Each entry describes one endpoint the React app already calls. Rather than
 * 54 near-identical controllers, one controller reads this map:
 *
 *   model  — the Eloquent model to query
 *   with   — relations to eager load (prevents N+1 on every list page)
 *   map    — the JSON contract: 'tsFieldName' => 'db_column' or 'relation.column'
 *   filter — closure applied to the base query
 *   sort   — default ordering
 *
 * The keys match the `endpoint` prop on the frontend's ResourcePage exactly,
 * so switching the app from preview data to live data is one env variable.
 */
$money = fn (string $column) => $column;

return [

    'resources' => [

        /* ===================== SALES & MARKETING ====================== */

        'sales/customers' => [
            'model' => Models\Customer::class,
            'with' => ['salesRep'],
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'channel' => 'channel',
                'contact' => 'contact_person', 'email' => 'email', 'phone' => 'phone',
                'address' => 'address', 'barangay' => 'barangay',
                'city' => 'city', 'province' => 'province', 'postalCode' => 'postal_code',
                'region' => 'region', 'terms' => 'terms',
                'geocodeSource' => 'geocode_source', 'geocodePrecision' => 'geocode_precision',
                'geocodeLabel' => 'geocode_label',
                'creditLimit' => 'credit_limit', 'balance' => 'balance', 'ytdSales' => 'ytd_sales',
                'lastOrder' => 'last_order_at', 'salesRep' => 'salesRep.full_name',
                'salesRepId' => 'sales_rep_id',
                'rating' => 'rating', 'status' => 'status',
                'latitude' => 'latitude', 'longitude' => 'longitude',
            ],
            'write' => [
                'label' => 'name',
                'number' => ['column' => 'code', 'prefix' => 'C-', 'yearly' => false, 'digits' => 4, 'start' => 1001],
                'defaults' => ['status' => 'Active', 'balance' => 0, 'ytd_sales' => 0],
                'rules' => [
                    'name' => 'required|string|max:190',
                    'latitude' => 'nullable|numeric|between:-90,90',
                    'longitude' => 'nullable|numeric|between:-180,180',
                    'channel' => 'required|in:Supermarket,Convenience,Wholesale,HoReCa,E-commerce,Industrial',
                    'contact' => 'nullable|string|max:120',
                    'email' => 'nullable|email|max:150',
                    'phone' => 'nullable|string|max:40',
                    'address' => 'nullable|string|max:255',
                    'barangay' => 'nullable|string|max:120',
                    'city' => 'nullable|string|max:80',
                    'province' => 'nullable|string|max:120',
                    'postalCode' => 'nullable|string|max:16',
                    'region' => 'required|in:NCR,Luzon,Visayas,Mindanao',
                    // Written by the address lookup, never typed on the form.
                    'geocodeSource' => 'nullable|string|max:32',
                    'geocodePrecision' => 'nullable|string|max:16',
                    'geocodeLabel' => 'nullable|string|max:255',
                    'tin' => 'nullable|string|max:32',
                    'terms' => 'required|in:COD,Net 15,Net 30,Net 45,Net 60',
                    'creditLimit' => 'required|numeric|min:0|max:999999999',
                    'salesRepId' => 'nullable|integer|exists:employees,id',
                    'rating' => 'nullable|numeric|between:0,5',
                    'status' => 'required|in:Active,On Hold,Inactive',
                ],
                'fields' => [
                    'name' => 'name', 'channel' => 'channel', 'contact' => 'contact_person',
                    'email' => 'email', 'phone' => 'phone', 'address' => 'address',
                    'barangay' => 'barangay', 'city' => 'city', 'province' => 'province',
                    'postalCode' => 'postal_code',
                    'geocodeSource' => 'geocode_source', 'geocodePrecision' => 'geocode_precision',
                    'geocodeLabel' => 'geocode_label',
                    'region' => 'region', 'tin' => 'tin', 'terms' => 'terms',
                    'creditLimit' => 'credit_limit', 'salesRepId' => 'sales_rep_id',
                    'rating' => 'rating', 'status' => 'status',
                    'latitude' => 'latitude', 'longitude' => 'longitude',
                ],
            ],
        ],

        'sales/quotations' => [
            'model' => Models\Quotation::class,
            'with' => ['customer', 'owner'],
            'sort' => ['quote_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'quote_no', 'customer' => 'customer.name', 'customerId' => 'customer_id',
                'date' => 'quote_date', 'validUntil' => 'valid_until', 'lines' => 'lines_count',
                'amount' => 'total', 'margin' => 'margin_pct', 'owner' => 'owner.full_name',
                'ownerId' => 'owner_id', 'status' => 'status',
            ],
            'counts' => ['lines'],
            'write' => [
                'label' => 'quote_no',
                'number' => ['column' => 'quote_no', 'prefix' => 'QT-', 'digits' => 4],
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'customerId' => 'required|integer|exists:customers,id',
                    'date' => 'required|date',
                    'validUntil' => 'nullable|date|after_or_equal:date',
                    'ownerId' => 'nullable|integer|exists:employees,id',
                    'status' => 'required|in:Draft,Submitted,Approved,Rejected,Expired,Won',
                ],
                'fields' => [
                    'customerId' => 'customer_id', 'date' => 'quote_date',
                    'validUntil' => 'valid_until', 'ownerId' => 'owner_id', 'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'lines',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'quantity' => 'required|numeric|min:0.01',
                        'unitPrice' => 'required|numeric|min:0',
                        'discountPct' => 'nullable|numeric|between:0,100',
                    ],
                    'fields' => [
                        'itemId' => 'item_id', 'quantity' => 'quantity',
                        'unitPrice' => 'unit_price', 'discountPct' => 'discount_pct',
                    ],
                    // Quotation lines store no cost, but the header margin is
                    // still costed from the item master so a quote cannot be
                    // sent out below floor without anyone noticing.
                    'cost_from_items' => true,
                    'header_columns' => ['subtotal', 'total', 'margin_pct'],
                ],
            ],
        ],

        'sales/orders' => [
            'model' => Models\SalesOrder::class,
            'with' => ['customer', 'warehouse', 'salesRep'],
            'sort' => ['order_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'order_no', 'customer' => 'customer.name', 'customerId' => 'customer_id',
                'channel' => 'customer.channel', 'region' => 'customer.region',
                'date' => 'order_date', 'promisedDate' => 'promised_date', 'warehouse' => 'warehouse.name',
                'lines' => 'lines_count', 'amount' => 'total', 'cost' => 'cost_total', 'margin' => 'margin_pct',
                'fulfilled' => 'fulfilled_pct', 'rep' => 'salesRep.full_name',
                'salesRepId' => 'sales_rep_id', 'warehouseId' => 'warehouse_id', 'status' => 'status',
            ],
            'counts' => ['lines'],
            'write' => [
                'label' => 'order_no',
                'number' => ['column' => 'order_no', 'prefix' => 'SO-', 'digits' => 4],
                'defaults' => ['status' => 'Draft', 'fulfilled_pct' => 0],
                'rules' => [
                    'customerId' => 'required|integer|exists:customers,id',
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'salesRepId' => 'nullable|integer|exists:employees,id',
                    'date' => 'required|date',
                    'promisedDate' => 'nullable|date|after_or_equal:date',
                    'status' => 'required|in:Draft,Confirmed,Partial,Delivered,Cancelled,On Hold',
                ],
                'fields' => [
                    'customerId' => 'customer_id', 'warehouseId' => 'warehouse_id',
                    'salesRepId' => 'sales_rep_id', 'date' => 'order_date',
                    'promisedDate' => 'promised_date', 'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'lines',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'quantity' => 'required|numeric|min:0.01',
                        'unitPrice' => 'required|numeric|min:0',
                        'discountPct' => 'nullable|numeric|between:0,100',
                    ],
                    'fields' => [
                        'itemId' => 'item_id', 'quantity' => 'quantity',
                        'unitPrice' => 'unit_price', 'discountPct' => 'discount_pct',
                    ],
                    // Cost is read from the item master so margin cannot be faked.
                    'cost_column' => 'unit_cost',
                    'header_columns' => ['subtotal', 'total', 'cost_total', 'margin_pct'],
                ],
            ],
        ],

        'sales/deliveries' => [
            'model' => Models\Delivery::class,
            'with' => ['salesOrder.customer', 'originWarehouse', 'vehicleAsset', 'driver'],
            'sort' => ['scheduled_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'delivery_no', 'soNo' => 'salesOrder.order_no',
                'customer' => 'salesOrder.customer.name', 'city' => 'salesOrder.customer.region',
                'scheduled' => 'scheduled_at', 'vehicle' => 'vehicleAsset.code', 'driver' => 'driver.full_name',
                'salesOrderId' => 'sales_order_id', 'vehicleAssetId' => 'vehicle_asset_id',
                'driverId' => 'driver_id',
                'origin' => 'originWarehouse.name', 'originWarehouseId' => 'origin_warehouse_id',
                'distanceKm' => 'distance_km', 'roundTrip' => 'round_trip',
                'etaMinutes' => 'eta_minutes', 'fuelLitres' => 'fuel_litres', 'fuelCost' => 'fuel_cost',
                'deliveredAt' => 'delivered_at',
                'pallets' => 'pallets', 'podReceived' => 'pod_received', 'status' => 'status',
            ],
            'write' => [
                'label' => 'delivery_no',
                'number' => ['column' => 'delivery_no', 'prefix' => 'DR-', 'digits' => 4],
                'defaults' => ['status' => 'Scheduled', 'pod_received' => false, 'round_trip' => true],
                'rules' => [
                    'salesOrderId' => 'required|integer|exists:sales_orders,id',
                    'originWarehouseId' => 'nullable|integer|exists:warehouses,id',
                    'vehicleAssetId' => 'nullable|integer|exists:assets,id',
                    'driverId' => 'nullable|integer|exists:employees,id',
                    'scheduled' => 'nullable|date',
                    'deliveredAt' => 'nullable|date',
                    'roundTrip' => 'nullable|boolean',
                    'pallets' => 'nullable|integer|min:0|max:9999',
                    'podReceived' => 'nullable|boolean',
                    'status' => 'required|in:Scheduled,In Transit,Delivered,Partial,Cancelled',
                ],
                'fields' => [
                    'salesOrderId' => 'sales_order_id', 'originWarehouseId' => 'origin_warehouse_id',
                    'vehicleAssetId' => 'vehicle_asset_id',
                    'driverId' => 'driver_id', 'scheduled' => 'scheduled_at', 'deliveredAt' => 'delivered_at',
                    'roundTrip' => 'round_trip',
                    'pallets' => 'pallets', 'podReceived' => 'pod_received', 'status' => 'status',
                ],
            ],
        ],

        'sales/returns' => [
            'model' => Models\SalesReturn::class,
            'with' => ['customer'],
            'sort' => ['return_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'rma_no', 'customer' => 'customer.name', 'date' => 'return_date',
                'reason' => 'reason', 'qty' => 'quantity', 'amount' => 'amount',
                'customerId' => 'customer_id', 'salesOrderId' => 'sales_order_id',
                'disposition' => 'disposition', 'status' => 'status',
            ],
            'write' => [
                'label' => 'rma_no',
                'number' => ['column' => 'rma_no', 'prefix' => 'RMA-', 'digits' => 4],
                'defaults' => ['status' => 'Submitted'],
                'rules' => [
                    'customerId' => 'required|integer|exists:customers,id',
                    'salesOrderId' => 'nullable|integer|exists:sales_orders,id',
                    'date' => 'required|date',
                    'reason' => 'required|in:Damaged in transit,Wrong item shipped,Near expiry,Quality complaint,Over-delivery,Order cancelled',
                    'qty' => 'required|numeric|min:0',
                    'amount' => 'required|numeric|min:0',
                    'disposition' => 'required|in:Restock,Scrap,Return to Supplier,Pending inspection',
                    'status' => 'required|in:Submitted,Approved,Completed,Rejected',
                ],
                'fields' => [
                    'customerId' => 'customer_id', 'salesOrderId' => 'sales_order_id',
                    'date' => 'return_date', 'reason' => 'reason', 'qty' => 'quantity',
                    'amount' => 'amount', 'disposition' => 'disposition', 'status' => 'status',
                ],
            ],
        ],

        'sales/price-lists' => [
            'model' => Models\PriceListEntry::class,
            'with' => ['item'],
            'sort' => ['effective_from' => 'desc'],
            'map' => [
                'id' => 'id', 'sku' => 'item.sku', 'name' => 'item.name', 'category' => 'item.category',
                'tier' => 'tier', 'listPrice' => 'list_price', 'discount' => 'discount_pct',
                'netPrice' => 'net_price', 'unitCost' => 'item.unit_cost', 'margin' => 'margin_pct',
                'itemId' => 'item_id', 'effectiveTo' => 'effective_to',
                'effective' => 'effective_from', 'status' => 'status',
            ],
            'write' => [
                'defaults' => ['status' => 'Active'],
                'rules' => [
                    'itemId' => 'required|integer|exists:items,id',
                    'tier' => 'required|in:Standard,Wholesale,Key Account,Distributor',
                    'listPrice' => 'required|numeric|min:0',
                    'discount' => 'nullable|numeric|between:0,100',
                    'netPrice' => 'required|numeric|min:0',
                    'effective' => 'required|date',
                    'effectiveTo' => 'nullable|date|after:effective',
                    'status' => 'required|in:Active,Scheduled,Expired',
                ],
                'fields' => [
                    'itemId' => 'item_id', 'tier' => 'tier', 'listPrice' => 'list_price',
                    'discount' => 'discount_pct', 'netPrice' => 'net_price',
                    'effective' => 'effective_from', 'effectiveTo' => 'effective_to',
                    'status' => 'status',
                ],
            ],
        ],

        'sales/campaigns' => [
            'model' => Models\Campaign::class,
            'with' => ['owner'],
            'sort' => ['start_date' => 'desc'],
            'map' => [
                'id' => 'id', 'name' => 'name', 'channel' => 'channel', 'start' => 'start_date', 'end' => 'end_date',
                'budget' => 'budget', 'spend' => 'spend', 'leads' => 'leads_generated',
                'conversions' => 'conversions', 'revenue' => 'attributed_revenue',
                'owner' => 'owner.full_name', 'ownerId' => 'owner_id', 'status' => 'status',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['status' => 'Planned'],
                'rules' => [
                    'name' => 'required|string|max:190',
                    'channel' => 'required|in:Trade Promo,Digital Ads,Email,Field Activation,Print,Loyalty',
                    'start' => 'required|date',
                    'end' => 'nullable|date|after_or_equal:start',
                    'budget' => 'required|numeric|min:0',
                    'spend' => 'nullable|numeric|min:0',
                    'leads' => 'nullable|integer|min:0',
                    'conversions' => 'nullable|integer|min:0',
                    'revenue' => 'nullable|numeric|min:0',
                    'ownerId' => 'nullable|integer|exists:employees,id',
                    'status' => 'required|in:Planned,Active,Completed,On Hold',
                ],
                'fields' => [
                    'name' => 'name', 'channel' => 'channel', 'start' => 'start_date', 'end' => 'end_date',
                    'budget' => 'budget', 'spend' => 'spend', 'leads' => 'leads_generated',
                    'conversions' => 'conversions', 'revenue' => 'attributed_revenue',
                    'ownerId' => 'owner_id', 'status' => 'status',
                ],
            ],
            'computed' => [
                'roi' => 'App\\Http\\Controllers\\Api\\Computed::campaignRoi',
            ],
        ],

        'sales/targets' => [
            'model' => Models\SalesTarget::class,
            'with' => ['employee'],
            'sort' => ['actual' => 'desc'],
            'map' => [
                'id' => 'id', 'rep' => 'employee.full_name', 'employeeId' => 'employee_id',
                'territory' => 'territory', 'year' => 'year', 'period' => 'period',
                'quota' => 'quota', 'actual' => 'actual', 'deals' => 'deals',
                'commissionRate' => 'commission_rate', 'commission' => 'commission',
            ],
            'write' => [
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'territory' => 'nullable|string|max:120',
                    'year' => 'required|integer|between:2000,2100',
                    'period' => 'nullable|integer|between:0,12',
                    'quota' => 'required|numeric|min:0',
                    'actual' => 'nullable|numeric|min:0',
                    'deals' => 'nullable|integer|min:0',
                    'commissionRate' => 'nullable|numeric|between:0,100',
                    'commission' => 'nullable|numeric|min:0',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'territory' => 'territory', 'year' => 'year',
                    'period' => 'period', 'quota' => 'quota', 'actual' => 'actual',
                    'deals' => 'deals', 'commissionRate' => 'commission_rate', 'commission' => 'commission',
                ],
                'defaults' => ['period' => 0],
            ],
            'computed' => [
                'attainment' => 'App\\Http\\Controllers\\Api\\Computed::attainment',
                'status' => 'App\\Http\\Controllers\\Api\\Computed::attainmentStatus',
            ],
        ],

        /*
         * People pickers for the Sales screens.
         *
         * These exist so a rep dropdown offers the sales team rather than all
         * 112 employees. Drivers are deliberately a different list: delivery is
         * run by Operations and Warehouse, and putting a sales rep behind the
         * wheel of a truck is not the intent.
         */
        'sales/representatives' => [
            'model' => Models\Employee::class,
            'scopeRelation' => ['hrDepartment.code' => 'SALES'],
            'with' => ['position', 'branchUnit'],
            'sort' => ['last_name' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'employee_no', 'fullName' => 'full_name',
                'position' => 'position.title', 'site' => 'branchUnit.code',
            ],
        ],

        /*
         * Trucks available to dispatch. Scoped to operational delivery
         * vehicles so the picker cannot assign a forklift to a customer run,
         * and it carries km/L so the form can cost the trip as you choose.
         */
        'sales/vehicles' => [
            'model' => Models\Asset::class,
            'scope' => ['category' => 'Delivery Vehicle', 'status' => 'Operational'],
            'with' => ['warehouse'],
            'sort' => ['code' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name',
                'site' => 'warehouse.name', 'kmPerLitre' => 'km_per_litre',
                'payloadPallets' => 'payload_pallets',
            ],
        ],

        'sales/drivers' => [
            'model' => Models\Employee::class,
            'scopeRelationIn' => ['hrDepartment.code' => ['OPERATIONS', 'WAREHOUSE']],
            'with' => ['position', 'branchUnit'],
            'sort' => ['last_name' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'employee_no', 'fullName' => 'full_name',
                'position' => 'position.title', 'site' => 'branchUnit.code',
            ],
        ],

        'sales/leads' => [
            'model' => Models\Lead::class,
            'with' => ['owner'],
            'sort' => ['expected_close' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'company' => 'company', 'contact' => 'contact_person',
                'source' => 'source', 'stage' => 'stage', 'value' => 'value', 'probability' => 'probability',
                'owner' => 'owner.full_name', 'ownerId' => 'owner_id',
                'customerId' => 'customer_id',
                'createdAt' => 'created_at', 'expectedClose' => 'expected_close',
                'nextStep' => 'next_step',
            ],
            'write' => [
                'label' => 'company',
                'number' => ['column' => 'code', 'prefix' => 'OPP-', 'digits' => 4],
                'defaults' => ['stage' => 'Qualification'],
                'rules' => [
                    'company' => 'required|string|max:190',
                    'contact' => 'nullable|string|max:120',
                    'source' => 'required|in:Referral,Trade Show,Cold Call,Website,Existing Customer,Partner',
                    'stage' => 'required|in:Qualification,Needs Analysis,Proposal,Negotiation,Closed Won,Closed Lost',
                    'value' => 'required|numeric|min:0',
                    'probability' => 'required|integer|between:0,100',
                    'ownerId' => 'nullable|integer|exists:employees,id',
                    'customerId' => 'nullable|integer|exists:customers,id',
                    'expectedClose' => 'nullable|date',
                    'nextStep' => 'nullable|string|max:190',
                ],
                'fields' => [
                    'company' => 'company', 'contact' => 'contact_person', 'source' => 'source',
                    'stage' => 'stage', 'value' => 'value', 'probability' => 'probability',
                    'ownerId' => 'owner_id', 'customerId' => 'customer_id',
                    'expectedClose' => 'expected_close', 'nextStep' => 'next_step',
                ],
            ],
        ],

        /* ======================== PROCUREMENT ========================= */

        'procurement/suppliers' => [
            'model' => Models\Supplier::class,
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'category' => 'category',
                'contact' => 'contact_person', 'email' => 'email', 'phone' => 'phone', 'city' => 'city',
                'terms' => 'terms', 'ytdSpend' => 'ytd_spend', 'onTimeRate' => 'on_time_rate',
                'qualityRate' => 'quality_rate', 'priceIndex' => 'price_index', 'scorecard' => 'scorecard',
                'accreditedUntil' => 'accredited_until', 'status' => 'status',
            ],
            'counts' => ['purchaseOrders' => 'openPo'],
            'write' => [
                'label' => 'name',
                'number' => ['column' => 'code', 'prefix' => 'S-', 'yearly' => false, 'digits' => 4, 'start' => 1001],
                'defaults' => ['status' => 'Active', 'ytd_spend' => 0],
                'rules' => [
                    'name' => 'required|string|max:190',
                    'category' => 'nullable|string|max:80',
                    'contact' => 'nullable|string|max:120',
                    'email' => 'nullable|email|max:150',
                    'phone' => 'nullable|string|max:40',
                    'address' => 'nullable|string|max:255',
                    'city' => 'nullable|string|max:80',
                    'tin' => 'nullable|string|max:32',
                    'terms' => 'required|in:COD,Net 15,Net 30,Net 45,Net 60',
                    'accreditedUntil' => 'nullable|date',
                    'status' => 'required|in:Active,Probationary,Blacklisted',
                ],
                'fields' => [
                    'name' => 'name', 'category' => 'category', 'contact' => 'contact_person',
                    'email' => 'email', 'phone' => 'phone', 'address' => 'address', 'city' => 'city',
                    'tin' => 'tin', 'terms' => 'terms', 'accreditedUntil' => 'accredited_until',
                    'status' => 'status',
                ],
            ],
        ],

        /*
         * Scorecards. Read-only on purpose — every figure here is derived from
         * receipts, rejections and prices paid, so there is nothing to edit. Use
         * the evaluate endpoint to recompute rather than a form to type into.
         */
        'procurement/supplier-performance' => [
            'model' => Models\Supplier::class,
            'sort' => ['scorecard' => 'desc'],
            'counts' => ['purchaseOrders' => 'openPo'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'category' => 'category',
                'onTimeRate' => 'on_time_rate', 'qualityRate' => 'quality_rate',
                'priceIndex' => 'price_index', 'scorecard' => 'scorecard',
                'sample' => 'scorecard_sample', 'evaluatedAt' => 'scorecard_updated_at',
                'accreditedUntil' => 'accredited_until',
                'ytdSpend' => 'ytd_spend', 'status' => 'status',
            ],
        ],

        'procurement/requisitions' => [
            'model' => Models\PurchaseRequisition::class,
            'with' => ['requester', 'hrDepartment'],
            'sort' => ['requested_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'requisition_no', 'title' => 'title',
                'requester' => 'requester.full_name', 'requestedById' => 'requested_by',
                'department' => 'hrDepartment.name', 'hrDepartmentId' => 'hr_department_id',
                'date' => 'requested_at', 'needBy' => 'needed_by', 'lines' => 'lines',
                'justification' => 'justification',
                'amount' => 'amount', 'budgetLeft' => 'budget_remaining', 'status' => 'status',
            ],
            'write' => [
                'label' => 'requisition_no',
                'number' => ['column' => 'requisition_no', 'prefix' => 'PR-', 'digits' => 4],
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'title' => 'required|string|max:190',
                    'requestedById' => 'nullable|integer|exists:employees,id',
                    'hrDepartmentId' => 'nullable|integer|exists:hr_departments,id',
                    'date' => 'required|date',
                    'needBy' => 'nullable|date|after_or_equal:date',
                    'justification' => 'nullable|string|max:2000',
                    'budgetLeft' => 'nullable|numeric',
                    'status' => 'required|in:Draft,Submitted,For Approval,Approved,Rejected,Converted',
                ],
                'fields' => [
                    'title' => 'title', 'requestedById' => 'requested_by',
                    'hrDepartmentId' => 'hr_department_id', 'date' => 'requested_at',
                    'needBy' => 'needed_by', 'justification' => 'justification',
                    'budgetLeft' => 'budget_remaining', 'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'items',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'quantity' => 'required|numeric|min:0.01',
                        'unitPrice' => 'required|numeric|min:0',
                    ],
                    'fields' => [
                        'itemId' => 'item_id', 'quantity' => 'quantity', 'unitPrice' => 'estimated_cost',
                    ],
                    // A requisition carries an `amount`, not a `total`.
                    'header_columns' => [],
                    'header_map' => ['total' => 'amount'],
                    'count_column' => 'lines',
                ],
            ],
        ],

        'procurement/rfqs' => [
            'model' => Models\Rfq::class,
            'with' => ['buyer', 'awardedSupplier', 'requisition'],
            'sort' => ['issued_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'rfq_no', 'title' => 'title', 'buyer' => 'buyer.full_name',
                'buyerId' => 'buyer_id', 'requisitionNo' => 'requisition.requisition_no',
                'purchaseRequisitionId' => 'purchase_requisition_id',
                'issued' => 'issued_at', 'closes' => 'closes_at', 'invited' => 'suppliers_invited',
                'responses' => 'responses_received', 'bestBid' => 'best_bid',
                'awardedSupplier' => 'awardedSupplier.name', 'awardedSupplierId' => 'awarded_supplier_id',
                'estimatedValue' => 'estimated_value', 'savings' => 'savings', 'status' => 'status',
            ],
            'write' => [
                'label' => 'rfq_no',
                'number' => ['column' => 'rfq_no', 'prefix' => 'RFQ-', 'digits' => 4],
                'defaults' => ['status' => 'Open'],
                'rules' => [
                    'title' => 'required|string|max:190',
                    'purchaseRequisitionId' => 'nullable|integer|exists:purchase_requisitions,id',
                    'buyerId' => 'nullable|integer|exists:employees,id',
                    'issued' => 'required|date',
                    'closes' => 'nullable|date|after_or_equal:issued',
                    'invited' => 'nullable|integer|min:0|max:255',
                    'estimatedValue' => 'nullable|numeric|min:0',
                    'status' => 'required|in:Open,Under Evaluation,Awarded,Cancelled',
                ],
                'fields' => [
                    'title' => 'title', 'purchaseRequisitionId' => 'purchase_requisition_id',
                    'buyerId' => 'buyer_id', 'issued' => 'issued_at', 'closes' => 'closes_at',
                    'invited' => 'suppliers_invited', 'estimatedValue' => 'estimated_value',
                    'status' => 'status',
                ],
            ],
        ],

        /*
         * The bid comparison grid.
         *
         * Response count, best bid and savings on the RFQ are all derived from
         * these rows rather than typed, so the headline figure on the RFQ can
         * never disagree with the bids underneath it.
         */
        'procurement/rfq-bids' => [
            'model' => Models\RfqBid::class,
            'with' => ['rfq', 'supplier'],
            'sort' => ['amount' => 'asc'],
            'map' => [
                'id' => 'id', 'rfqNo' => 'rfq.rfq_no', 'rfqId' => 'rfq_id',
                'supplier' => 'supplier.name', 'supplierId' => 'supplier_id',
                'amount' => 'amount', 'leadTimeDays' => 'lead_time_days',
                'paymentTerms' => 'payment_terms', 'technicalScore' => 'technical_score',
                'isAwarded' => 'is_awarded',
            ],
            'write' => [
                'rules' => [
                    'rfqId' => 'required|integer|exists:rfqs,id',
                    'supplierId' => 'required|integer|exists:suppliers,id',
                    'amount' => 'required|numeric|min:0',
                    'leadTimeDays' => 'nullable|integer|min:0|max:365',
                    'paymentTerms' => 'nullable|string|max:32',
                    'technicalScore' => 'nullable|integer|between:0,100',
                ],
                'fields' => [
                    'rfqId' => 'rfq_id', 'supplierId' => 'supplier_id', 'amount' => 'amount',
                    'leadTimeDays' => 'lead_time_days', 'paymentTerms' => 'payment_terms',
                    'technicalScore' => 'technical_score',
                ],
            ],
        ],

        'procurement/orders' => [
            'model' => Models\PurchaseOrder::class,
            'with' => ['supplier', 'buyer', 'warehouse'],
            'sort' => ['order_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'po_no', 'supplier' => 'supplier.name', 'supplierId' => 'supplier_id',
                'category' => 'supplier.category', 'date' => 'order_date', 'expected' => 'expected_at',
                'lines' => 'lines_count', 'amount' => 'total', 'receivedPct' => 'received_pct',
                'buyer' => 'buyer.full_name', 'buyerId' => 'buyer_id',
                'warehouseId' => 'warehouse_id', 'warehouse' => 'warehouse.name',
                'status' => 'status',
            ],
            'counts' => ['lines'],
            'write' => [
                'label' => 'po_no',
                'number' => ['column' => 'po_no', 'prefix' => 'PO-', 'digits' => 4],
                'defaults' => ['status' => 'Draft', 'received_pct' => 0],
                'rules' => [
                    'supplierId' => 'required|integer|exists:suppliers,id',
                    'warehouseId' => 'nullable|integer|exists:warehouses,id',
                    'buyerId' => 'nullable|integer|exists:employees,id',
                    'date' => 'required|date',
                    'expected' => 'nullable|date|after_or_equal:date',
                    'status' => 'required|in:Draft,For Approval,Approved,Partial,Completed,Cancelled',
                ],
                'fields' => [
                    'supplierId' => 'supplier_id', 'warehouseId' => 'warehouse_id',
                    'buyerId' => 'buyer_id', 'date' => 'order_date', 'expected' => 'expected_at',
                    'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'lines',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'quantity' => 'required|numeric|min:0.01',
                        'unitPrice' => 'required|numeric|min:0',
                    ],
                    // Purchasing quotes a unit cost rather than a sell price,
                    // so the line's price column is the cost column.
                    'fields' => [
                        'itemId' => 'item_id', 'quantity' => 'quantity', 'unitPrice' => 'unit_cost',
                    ],
                    'header_columns' => ['subtotal', 'total'],
                ],
            ],
        ],

        'procurement/goods-receipts' => [
            'model' => Models\GoodsReceipt::class,
            'with' => ['purchaseOrder.supplier', 'warehouse', 'receiver'],
            'sort' => ['received_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'grn_no', 'poNo' => 'purchaseOrder.po_no',
                'purchaseOrderId' => 'purchase_order_id', 'warehouseId' => 'warehouse_id',
                'supplier' => 'purchaseOrder.supplier.name', 'warehouse' => 'warehouse.name',
                'date' => 'received_at', 'lines' => 'lines', 'qtyReceived' => 'quantity_received',
                'qtyRejected' => 'quantity_rejected', 'receivedBy' => 'receiver.full_name',
                'receivedById' => 'received_by', 'notes' => 'inspection_notes', 'status' => 'status',
            ],
            'write' => [
                'label' => 'grn_no',
                'number' => ['column' => 'grn_no', 'prefix' => 'GRN-', 'digits' => 4],
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'purchaseOrderId' => 'required|integer|exists:purchase_orders,id',
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'receivedById' => 'nullable|integer|exists:employees,id',
                    'date' => 'required|date',
                    'notes' => 'nullable|string|max:2000',
                    // Only a Posted receipt moves the order. Draft is somebody
                    // still counting boxes on the dock.
                    'status' => 'required|in:Draft,For Approval,Posted,Rejected',
                ],
                'fields' => [
                    'purchaseOrderId' => 'purchase_order_id', 'warehouseId' => 'warehouse_id',
                    'receivedById' => 'received_by', 'date' => 'received_at',
                    'notes' => 'inspection_notes', 'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'items',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'purchaseOrderLineId' => 'nullable|integer|exists:purchase_order_lines,id',
                        'quantityReceived' => 'required|numeric|min:0',
                        'quantityRejected' => 'nullable|numeric|min:0',
                        'rejectReason' => 'nullable|string|max:190',
                    ],
                    'fields' => [
                        'itemId' => 'item_id', 'purchaseOrderLineId' => 'purchase_order_line_id',
                        'quantityReceived' => 'quantity_received',
                        'quantityRejected' => 'quantity_rejected', 'rejectReason' => 'reject_reason',
                    ],
                    // Quantities, not money — nothing to extend into a line
                    // total, and the header carries what arrived.
                    'line_total_column' => null,
                    'header_columns' => [],
                    'count_column' => 'lines',
                    'sum_columns' => [
                        'quantityReceived' => 'quantity_received',
                        'quantityRejected' => 'quantity_rejected',
                    ],
                ],
            ],
        ],

        'procurement/supplier-invoices' => [
            'model' => Models\SupplierInvoice::class,
            'with' => ['supplier', 'purchaseOrder', 'goodsReceipt'],
            'sort' => ['invoice_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'invoice_no', 'supplier' => 'supplier.name',
                'supplierId' => 'supplier_id', 'purchaseOrderId' => 'purchase_order_id',
                'goodsReceiptId' => 'goods_receipt_id', 'grnNo' => 'goodsReceipt.grn_no',
                'poNo' => 'purchaseOrder.po_no', 'date' => 'invoice_date', 'due' => 'due_date',
                'amount' => 'amount', 'matched' => 'match_status', 'status' => 'status',
            ],
            'write' => [
                'label' => 'invoice_no',
                'defaults' => ['status' => 'Draft', 'match_status' => 'Unmatched'],
                // Without this the duplicate message reads "The no has already
                // been taken", which tells the clerk nothing.
                'labels' => ['no' => 'invoice number', 'amount' => 'invoice amount'],
                'rules' => [
                    // A supplier's own document number, so it is keyed in
                    // rather than generated — but it must be unique, because
                    // paying the same invoice twice is the classic AP failure.
                    'no' => 'required|string|max:48|unique:supplier_invoices,invoice_no',
                    'supplierId' => 'required|integer|exists:suppliers,id',
                    'purchaseOrderId' => 'nullable|integer|exists:purchase_orders,id',
                    'goodsReceiptId' => 'nullable|integer|exists:goods_receipts,id',
                    'date' => 'required|date',
                    'due' => 'required|date|after_or_equal:date',
                    'amount' => 'required|numeric|min:0',
                    'status' => 'required|in:Draft,For Approval,Approved,Paid,Overdue,Rejected',
                ],
                'fields' => [
                    'no' => 'invoice_no', 'supplierId' => 'supplier_id',
                    'purchaseOrderId' => 'purchase_order_id', 'goodsReceiptId' => 'goods_receipt_id',
                    'date' => 'invoice_date', 'due' => 'due_date', 'amount' => 'amount',
                    'status' => 'status',
                ],
            ],
        ],

        'procurement/contracts' => [
            'model' => Models\SupplierContract::class,
            'with' => ['supplier', 'owner'],
            'sort' => ['end_date' => 'asc'],
            'map' => [
                'id' => 'id', 'no' => 'contract_no', 'supplier' => 'supplier.name',
                'supplierId' => 'supplier_id', 'title' => 'title',
                'type' => 'type', 'start' => 'start_date', 'end' => 'end_date', 'value' => 'value',
                'autoRenew' => 'auto_renew', 'noticeDays' => 'notice_days',
                'owner' => 'owner.full_name', 'ownerId' => 'owner_id', 'status' => 'status',
            ],
            'write' => [
                'label' => 'title',
                'number' => ['column' => 'contract_no', 'prefix' => 'CTR-', 'digits' => 4],
                'defaults' => ['status' => 'Draft', 'auto_renew' => false, 'notice_days' => 30],
                'rules' => [
                    'supplierId' => 'required|integer|exists:suppliers,id',
                    'title' => 'required|string|max:190',
                    'type' => 'required|in:Supply Agreement,Service Contract,Framework Agreement,Lease',
                    'start' => 'required|date',
                    'end' => 'required|date|after:start',
                    'value' => 'nullable|numeric|min:0',
                    'autoRenew' => 'nullable|boolean',
                    'noticeDays' => 'nullable|integer|min:0|max:365',
                    'ownerId' => 'nullable|integer|exists:employees,id',
                    'status' => 'required|in:Draft,Active,Expiring,Expired,Terminated',
                ],
                'fields' => [
                    'supplierId' => 'supplier_id', 'title' => 'title', 'type' => 'type',
                    'start' => 'start_date', 'end' => 'end_date', 'value' => 'value',
                    'autoRenew' => 'auto_renew', 'noticeDays' => 'notice_days',
                    'ownerId' => 'owner_id', 'status' => 'status',
                ],
            ],
        ],

        /*
         * People pickers for Procurement, so a buyer dropdown offers the
         * purchasing team rather than all 112 employees.
         */
        'procurement/buyers' => [
            'model' => Models\Employee::class,
            'scopeRelation' => ['hrDepartment.code' => 'PROCUREMENT'],
            'with' => ['position', 'branchUnit'],
            'sort' => ['last_name' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'employee_no', 'fullName' => 'full_name',
                'position' => 'position.title', 'site' => 'branchUnit.code',
            ],
        ],

        /* Purchase orders still open enough to receive or invoice against. */
        'procurement/open-orders' => [
            'model' => Models\PurchaseOrder::class,
            'scopeIn' => ['status' => ['Approved', 'Partial']],
            'with' => ['supplier', 'warehouse'],
            'sort' => ['expected_at' => 'asc'],
            'counts' => ['lines'],
            'map' => [
                'id' => 'id', 'no' => 'po_no', 'supplier' => 'supplier.name',
                'supplierId' => 'supplier_id', 'warehouseId' => 'warehouse_id',
                'expected' => 'expected_at', 'total' => 'total',
                'receivedPct' => 'received_pct', 'lines' => 'lines_count', 'status' => 'status',
            ],
        ],

        /* ========================= WAREHOUSE ========================== */

        'warehouse/items' => [
            'model' => Models\Item::class,
            'with' => ['primarySupplier'],
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'sku' => 'sku', 'name' => 'name', 'category' => 'category', 'brand' => 'brand',
                'uom' => 'uom', 'packSize' => 'pack_size', 'barcode' => 'barcode',
                'unitCost' => 'unit_cost', 'sellPrice' => 'sell_price',
                'reorderPoint' => 'reorder_point', 'reorderQty' => 'reorder_qty',
                'leadTimeDays' => 'lead_time_days', 'shelfLifeDays' => 'shelf_life_days',
                'abc' => 'abc_class', 'abcComputedAt' => 'abc_class_computed_at',
                'primarySupplier' => 'primarySupplier.name',
                'primarySupplierId' => 'primary_supplier_id', 'isSparePart' => 'is_spare_part',
                'status' => 'status_label',
            ],
            'sums' => ['stockBalances' => ['on_hand' => 'onHand', 'allocated' => 'allocated']],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true, 'uom' => 'CASE', 'abc_class' => 'C'],
                'rules' => [
                    'sku' => 'required|string|max:48|unique:items,sku',
                    'name' => 'required|string|max:190',
                    'category' => 'nullable|string|max:80',
                    'brand' => 'nullable|string|max:80',
                    'uom' => 'required|string|max:16',
                    'packSize' => 'nullable|string|max:32',
                    'barcode' => 'nullable|string|max:32',
                    'unitCost' => 'required|numeric|min:0',
                    'sellPrice' => 'required|numeric|min:0',
                    'reorderPoint' => 'nullable|integer|min:0',
                    'reorderQty' => 'nullable|integer|min:0',
                    'leadTimeDays' => 'nullable|integer|min:0|max:365',
                    'shelfLifeDays' => 'nullable|integer|min:0',
                    'abc' => 'nullable|in:A,B,C',
                    'primarySupplierId' => 'nullable|integer|exists:suppliers,id',
                    // What puts an item on Maintenance's spare parts list and
                    // makes it choosable as a work order part.
                    'isSparePart' => 'nullable|boolean',
                ],
                'fields' => [
                    'sku' => 'sku', 'name' => 'name', 'category' => 'category', 'brand' => 'brand',
                    'uom' => 'uom', 'packSize' => 'pack_size', 'barcode' => 'barcode',
                    'unitCost' => 'unit_cost', 'sellPrice' => 'sell_price',
                    'reorderPoint' => 'reorder_point', 'reorderQty' => 'reorder_qty',
                    'leadTimeDays' => 'lead_time_days', 'shelfLifeDays' => 'shelf_life_days',
                    'abc' => 'abc_class', 'primarySupplierId' => 'primary_supplier_id',
                    'isSparePart' => 'is_spare_part',
                ],
            ],
        ],

        'warehouse/stock' => [
            'model' => Models\StockBalance::class,
            'with' => ['item', 'warehouse', 'warehouseBin'],
            'sort' => ['id' => 'asc'],
            'map' => [
                'id' => 'id', 'sku' => 'item.sku', 'name' => 'item.name', 'category' => 'item.category',
                // The adjust action needs both keys to post a correction.
                'itemId' => 'item_id', 'warehouseId' => 'warehouse_id',
                'warehouse' => 'warehouse.name', 'bin' => 'warehouseBin.code', 'batch' => 'batch',
                'expiry' => 'expiry_date', 'onHand' => 'on_hand', 'allocated' => 'allocated',
                'available' => 'available', 'unitCost' => 'unit_cost', 'abc' => 'item.abc_class',
            ],
            'computed' => [
                'value' => 'App\\Http\\Controllers\\Api\\Computed::stockValue',
                'status' => 'App\\Http\\Controllers\\Api\\Computed::stockStatus',
                'lastCountedAt' => 'App\\Http\\Controllers\\Api\\Computed::lastCountedAt',
            ],
        ],

        'warehouse/inbound' => [
            'model' => Models\InboundShipment::class,
            'with' => ['warehouse', 'supplier', 'purchaseOrder'],
            'sort' => ['arrival_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'asn_no', 'reference' => 'reference', 'supplier' => 'supplier.name',
                'warehouse' => 'warehouse.name', 'arrival' => 'arrival_at', 'dock' => 'dock',
                'purchaseOrderId' => 'purchase_order_id', 'poNo' => 'purchaseOrder.po_no',
                'poTotal' => 'purchaseOrder.total', 'warehouseId' => 'warehouse_id',
                'pallets' => 'pallets', 'linesTotal' => 'lines_total', 'linesPutaway' => 'lines_putaway',
                'status' => 'status',
            ],
            'write' => [
                'label' => 'asn_no',
                'number' => ['column' => 'asn_no', 'prefix' => 'ASN-', 'digits' => 4],
                'defaults' => ['status' => 'Expected', 'lines_putaway' => 0],
                'rules' => [
                    // Goods only arrive because someone ordered them. Supplier,
                    // warehouse and reference are copied from the PO on save.
                    'purchaseOrderId' => 'required|integer|exists:purchase_orders,id',
                    'warehouseId' => 'nullable|integer|exists:warehouses,id',
                    'arrival' => 'nullable|date',
                    'dock' => 'nullable|string|max:32',
                    'pallets' => 'nullable|integer|min:0|max:9999',
                    'linesTotal' => 'nullable|integer|min:0|max:9999',
                    'linesPutaway' => 'nullable|integer|min:0|max:9999',
                    'status' => 'required|in:Expected,Receiving,In Inspection,Putaway,Completed',
                ],
                'fields' => [
                    'purchaseOrderId' => 'purchase_order_id', 'warehouseId' => 'warehouse_id',
                    'arrival' => 'arrival_at', 'dock' => 'dock', 'pallets' => 'pallets',
                    'linesTotal' => 'lines_total', 'linesPutaway' => 'lines_putaway', 'status' => 'status',
                ],
            ],
        ],

        /*
         * Purchase orders the warehouse is still waiting on.
         *
         * The receiving dock should only be able to announce a shipment for
         * something that was actually ordered and has not fully arrived —
         * which is what makes inbound a consequence of procurement rather than
         * a parallel list somebody keys in.
         */
        'warehouse/expected-orders' => [
            'model' => Models\PurchaseOrder::class,
            'scopeIn' => ['status' => ['Approved', 'Partial']],
            'with' => ['supplier', 'warehouse'],
            'sort' => ['expected_at' => 'asc'],
            'counts' => ['lines'],
            'map' => [
                'id' => 'id', 'no' => 'po_no', 'supplier' => 'supplier.name',
                'warehouse' => 'warehouse.name', 'warehouseId' => 'warehouse_id',
                'expected' => 'expected_at', 'total' => 'total',
                'receivedPct' => 'received_pct', 'lines' => 'lines_count', 'status' => 'status',
            ],
        ],

        'warehouse/outbound' => [
            'model' => Models\PickList::class,
            'with' => ['warehouse', 'picker', 'salesOrder.customer'],
            'sort' => ['cutoff_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'pick_no',
                // Prefers the linked order, falling back to the copied number
                // on rows created before the two were joined up.
                'soNo' => 'sales_order_no', 'warehouse' => 'warehouse.name',
                'salesOrderId' => 'sales_order_id', 'customer' => 'salesOrder.customer.name',
                'cutoff' => 'cutoff_at', 'wave' => 'wave', 'waveId' => 'wave_id', 'picker' => 'picker.full_name',
                'pickerId' => 'picker_id', 'warehouseId' => 'warehouse_id',
                'packedAt' => 'packed_at', 'dispatchedAt' => 'dispatched_at',
                'lines' => 'lines', 'linesPicked' => 'lines_picked', 'status' => 'status',
            ],
            'write' => [
                'label' => 'pick_no',
                'number' => ['column' => 'pick_no', 'prefix' => 'PICK-', 'digits' => 4],
                'defaults' => ['status' => 'Released', 'lines_picked' => 0],
                'rules' => [
                    'salesOrderId' => 'nullable|integer|exists:sales_orders,id',
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'pickerId' => 'nullable|integer|exists:employees,id',
                    'wave' => 'nullable|string|max:32',
                    'cutoff' => 'nullable|date',
                    'lines' => 'required|integer|min:0|max:9999',
                    'linesPicked' => 'nullable|integer|min:0|max:9999',
                    'status' => 'required|in:Released,Picking,Packed,Staged,Dispatched,On Hold',
                ],
                'fields' => [
                    'salesOrderId' => 'sales_order_id', 'warehouseId' => 'warehouse_id',
                    'pickerId' => 'picker_id', 'wave' => 'wave', 'cutoff' => 'cutoff_at',
                    'lines' => 'lines', 'linesPicked' => 'lines_picked', 'status' => 'status',
                ],
            ],
        ],

        'warehouse/transfers' => [
            'model' => Models\StockTransfer::class,
            'with' => ['fromWarehouse', 'toWarehouse'],
            'sort' => ['transfer_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'transfer_no', 'from' => 'fromWarehouse.name', 'to' => 'toWarehouse.name',
                'fromWarehouseId' => 'from_warehouse_id', 'toWarehouseId' => 'to_warehouse_id',
                'date' => 'transfer_date', 'eta' => 'eta', 'lines' => 'lines', 'qty' => 'quantity',
                'value' => 'value', 'status' => 'status',
            ],
            'write' => [
                'label' => 'transfer_no',
                'number' => ['column' => 'transfer_no', 'prefix' => 'TR-', 'digits' => 4],
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'fromWarehouseId' => 'required|integer|exists:warehouses,id',
                    'toWarehouseId' => 'required|integer|exists:warehouses,id|different:fromWarehouseId',
                    'date' => 'required|date',
                    'eta' => 'nullable|date|after_or_equal:date',
                    // In Transit takes stock off the source shelf; Received puts
                    // it on the destination's. Between them it is on a truck.
                    'status' => 'required|in:Draft,Approved,In Transit,Received,Cancelled',
                ],
                'fields' => [
                    'fromWarehouseId' => 'from_warehouse_id', 'toWarehouseId' => 'to_warehouse_id',
                    'date' => 'transfer_date', 'eta' => 'eta', 'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'items',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'quantity' => 'required|numeric|min:0.01',
                        'unitPrice' => 'nullable|numeric|min:0',
                    ],
                    'fields' => [
                        'itemId' => 'item_id', 'quantity' => 'quantity', 'unitPrice' => 'unit_cost',
                    ],
                    'header_columns' => [],
                    'header_map' => ['total' => 'value'],
                    'count_column' => 'lines',
                    'sum_columns' => ['quantity' => 'quantity'],
                ],
            ],
        ],

        'warehouse/cycle-counts' => [
            'model' => Models\CycleCount::class,
            'with' => ['warehouse', 'counter'],
            'sort' => ['count_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'count_no', 'warehouse' => 'warehouse.name', 'zone' => 'zone',
                'warehouseId' => 'warehouse_id', 'countedById' => 'counted_by',
                'date' => 'count_date', 'counter' => 'counter.full_name', 'skusCounted' => 'skus_counted',
                'variances' => 'variances', 'accuracy' => 'accuracy', 'valueVariance' => 'value_variance',
                'status' => 'status',
            ],
            'write' => [
                'label' => 'count_no',
                'number' => ['column' => 'count_no', 'prefix' => 'CC-', 'digits' => 4],
                'defaults' => ['status' => 'Scheduled'],
                'rules' => [
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'zone' => 'nullable|string|max:32',
                    'date' => 'required|date',
                    'countedById' => 'nullable|integer|exists:employees,id',
                    // Only Posted corrects the books. Anything earlier is
                    // somebody's clipboard, not a decision.
                    'status' => 'required|in:Scheduled,In Progress,For Approval,Posted',
                ],
                'fields' => [
                    'warehouseId' => 'warehouse_id', 'zone' => 'zone', 'date' => 'count_date',
                    'countedById' => 'counted_by', 'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'items',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'systemQuantity' => 'nullable|numeric|min:0',
                        'countedQuantity' => 'required|numeric|min:0',
                        'note' => 'nullable|string|max:190',
                    ],
                    'fields' => [
                        'itemId' => 'item_id', 'systemQuantity' => 'system_quantity',
                        'countedQuantity' => 'counted_quantity', 'note' => 'note',
                    ],
                    // Quantities, not money. Accuracy and value variance on the
                    // header are derived by the model from these lines.
                    'line_total_column' => null,
                    'header_columns' => [],
                ],
            ],
        ],

        'warehouse/locations' => [
            'model' => Models\Warehouse::class,
            'with' => ['manager'],
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'city' => 'city', 'region' => 'region',
                'type' => 'type', 'capacityPallets' => 'capacity_pallets', 'usedPallets' => 'used_pallets',
                'manager' => 'manager.full_name', 'managerId' => 'manager_id',
                'latitude' => 'latitude', 'longitude' => 'longitude',
                'isDefaultOrigin' => 'is_default_origin',
                'status' => 'status_label',
            ],
            'counts' => ['bins'],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true],
                'rules' => [
                    'code' => 'required|string|max:32|unique:warehouses,code',
                    'name' => 'required|string|max:150',
                    'type' => 'required|in:Distribution Center,Branch Warehouse,Transit Hub',
                    'city' => 'nullable|string|max:80',
                    'region' => 'required|in:NCR,Luzon,Visayas,Mindanao',
                    'capacityPallets' => 'nullable|integer|min:0',
                    'managerId' => 'nullable|integer|exists:employees,id',
                    'latitude' => 'nullable|numeric|between:-90,90',
                    'longitude' => 'nullable|numeric|between:-180,180',
                    'isDefaultOrigin' => 'nullable|boolean',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'type' => 'type', 'city' => 'city',
                    'region' => 'region', 'capacityPallets' => 'capacity_pallets', 'managerId' => 'manager_id',
                    'latitude' => 'latitude', 'longitude' => 'longitude',
                    'isDefaultOrigin' => 'is_default_origin',
                ],
            ],
        ],

        'warehouse/labels' => [
            'model' => Models\LabelPrintJob::class,
            'with' => ['warehouse'],
            'sort' => ['created_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'job_no', 'template' => 'template', 'warehouse' => 'warehouse.name',
                'warehouseId' => 'warehouse_id',
                'quantity' => 'quantity', 'printer' => 'printer', 'status' => 'status', 'created' => 'created_at',
            ],
            'write' => [
                'label' => 'job_no',
                'number' => ['column' => 'job_no', 'prefix' => 'LBL-', 'digits' => 4],
                'defaults' => ['status' => 'Queued'],
                'rules' => [
                    'template' => 'required|in:SKU Label,Bin Label,Pallet Label,Price Tag,Batch Label',
                    'warehouseId' => 'nullable|integer|exists:warehouses,id',
                    'quantity' => 'required|integer|min:1|max:100000',
                    'printer' => 'nullable|string|max:96',
                    'status' => 'required|in:Queued,Printing,Completed,Failed',
                ],
                'fields' => [
                    'template' => 'template', 'warehouseId' => 'warehouse_id',
                    'quantity' => 'quantity', 'printer' => 'printer', 'status' => 'status',
                ],
            ],
        ],

        /* Bin locations inside a warehouse. */
        'warehouse/bins' => [
            'model' => Models\WarehouseBin::class,
            'with' => ['warehouse'],
            'sort' => ['code' => 'asc'],
            'sums' => ['stockBalances' => ['on_hand' => 'onHand']],
            'map' => [
                'id' => 'id', 'code' => 'code', 'warehouse' => 'warehouse.name',
                'warehouseId' => 'warehouse_id', 'zone' => 'zone', 'aisle' => 'aisle',
                'capacity' => 'capacity', 'preferredClass' => 'preferred_class', 'status' => 'status_label',
            ],
            'write' => [
                'label' => 'code',
                'defaults' => ['is_active' => true],
                'rules' => [
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'code' => 'required|string|max:32',
                    'zone' => 'nullable|string|max:16',
                    'aisle' => 'nullable|string|max:16',
                    'capacity' => 'nullable|integer|min:0|max:1000000',
                    'preferredClass' => 'nullable|in:A,B,C',
                    'isActive' => 'nullable|boolean',
                ],
                'fields' => [
                    'warehouseId' => 'warehouse_id', 'code' => 'code', 'zone' => 'zone',
                    'aisle' => 'aisle', 'capacity' => 'capacity', 'preferredClass' => 'preferred_class',
                    'isActive' => 'is_active',
                ],
            ],
        ],

        /*
         * HSSE, Kaizen and dock scheduling — the three practice areas the
         * training material treats as foundational and nothing existed for.
         * Plain generic resources: none need workflow logic beyond a status
         * field, so none get a bespoke controller.
         */
        'warehouse/incidents' => [
            'model' => Models\WarehouseIncident::class,
            'with' => ['warehouse', 'reporter'],
            'sort' => ['occurred_on' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'incident_no', 'warehouseId' => 'warehouse_id',
                'warehouse' => 'warehouse.name', 'reportedBy' => 'reporter.full_name',
                'occurredOn' => 'occurred_on', 'hazardType' => 'hazard_type', 'severity' => 'severity',
                'location' => 'location', 'description' => 'description', 'ppeInvolved' => 'ppe_involved',
                'correctiveAction' => 'corrective_action', 'status' => 'status', 'resolvedAt' => 'resolved_at',
            ],
            'write' => [
                'label' => 'incident_no',
                'number' => ['column' => 'incident_no', 'prefix' => 'INC-', 'digits' => 4],
                'defaults' => ['status' => 'Open'],
                'rules' => [
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'reportedBy' => 'nullable|integer|exists:employees,id',
                    'occurredOn' => 'required|date',
                    'hazardType' => 'required|in:MHE,Dock,Racking,Manual Handling,Chemical,Fire,Other',
                    'severity' => 'required|in:Near-miss,Minor,Moderate,Major',
                    'location' => 'nullable|string|max:80',
                    'description' => 'required|string|max:4000',
                    'ppeInvolved' => 'nullable|string|max:2000',
                    'correctiveAction' => 'nullable|string|max:4000',
                    'status' => 'required|in:Open,Investigating,Resolved,Closed',
                ],
                'fields' => [
                    'warehouseId' => 'warehouse_id', 'reportedBy' => 'reported_by', 'occurredOn' => 'occurred_on',
                    'hazardType' => 'hazard_type', 'severity' => 'severity', 'location' => 'location',
                    'description' => 'description', 'ppeInvolved' => 'ppe_involved',
                    'correctiveAction' => 'corrective_action', 'status' => 'status',
                ],
            ],
        ],

        'warehouse/suggestions' => [
            'model' => Models\WarehouseSuggestion::class,
            'with' => ['warehouse', 'raiser'],
            'sort' => ['created_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'suggestion_no', 'warehouseId' => 'warehouse_id',
                'warehouse' => 'warehouse.name', 'raisedBy' => 'raiser.full_name', 'category' => 'category',
                'zone' => 'zone', 'description' => 'description', 'status' => 'status',
                'impactNote' => 'impact_note', 'createdAt' => 'created_at',
            ],
            'write' => [
                'label' => 'suggestion_no',
                'number' => ['column' => 'suggestion_no', 'prefix' => 'SUG-', 'digits' => 4],
                'defaults' => ['status' => 'Submitted'],
                'rules' => [
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'raisedBy' => 'nullable|integer|exists:employees,id',
                    'category' => 'required|in:5S,Safety,Efficiency,Quality,Other',
                    'zone' => 'nullable|string|max:32',
                    'description' => 'required|string|max:4000',
                    'status' => 'required|in:Submitted,Under Review,In Progress,Implemented,Rejected',
                    'impactNote' => 'nullable|string|max:2000',
                ],
                'fields' => [
                    'warehouseId' => 'warehouse_id', 'raisedBy' => 'raised_by', 'category' => 'category',
                    'zone' => 'zone', 'description' => 'description', 'status' => 'status',
                    'impactNote' => 'impact_note',
                ],
            ],
        ],

        'warehouse/five-s-audits' => [
            'model' => Models\Warehouse5sAudit::class,
            'with' => ['warehouse', 'auditor'],
            'sort' => ['audited_on' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'audit_no', 'warehouseId' => 'warehouse_id',
                'warehouse' => 'warehouse.name', 'zone' => 'zone', 'auditedBy' => 'auditor.full_name',
                'auditedOn' => 'audited_on', 'sortScore' => 'sort_score', 'setScore' => 'set_score',
                'shineScore' => 'shine_score', 'standardizeScore' => 'standardize_score',
                'sustainScore' => 'sustain_score', 'notes' => 'notes',
            ],
            'computed' => [
                'totalScore' => fn ($row) => $row->total_score,
            ],
            'write' => [
                'label' => 'audit_no',
                'number' => ['column' => 'audit_no', 'prefix' => 'AUD-', 'digits' => 4],
                'rules' => [
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'zone' => 'required|string|max:32',
                    'auditedBy' => 'nullable|integer|exists:employees,id',
                    'auditedOn' => 'required|date',
                    'sortScore' => 'required|integer|min:1|max:5',
                    'setScore' => 'required|integer|min:1|max:5',
                    'shineScore' => 'required|integer|min:1|max:5',
                    'standardizeScore' => 'required|integer|min:1|max:5',
                    'sustainScore' => 'required|integer|min:1|max:5',
                    'notes' => 'nullable|string|max:2000',
                ],
                'fields' => [
                    'warehouseId' => 'warehouse_id', 'zone' => 'zone', 'auditedBy' => 'audited_by',
                    'auditedOn' => 'audited_on', 'sortScore' => 'sort_score', 'setScore' => 'set_score',
                    'shineScore' => 'shine_score', 'standardizeScore' => 'standardize_score',
                    'sustainScore' => 'sustain_score', 'notes' => 'notes',
                ],
            ],
        ],

        'warehouse/docks' => [
            'model' => Models\DockAppointment::class,
            'with' => ['warehouse'],
            'sort' => ['scheduled_at' => 'asc'],
            'map' => [
                'id' => 'id', 'no' => 'appointment_no', 'warehouseId' => 'warehouse_id',
                'warehouse' => 'warehouse.name', 'dockCode' => 'dock_code', 'scheduledAt' => 'scheduled_at',
                'durationMinutes' => 'duration_minutes', 'type' => 'type', 'reference' => 'reference',
                'carrier' => 'carrier', 'driver' => 'driver', 'status' => 'status', 'notes' => 'notes',
            ],
            'write' => [
                'label' => 'appointment_no',
                'number' => ['column' => 'appointment_no', 'prefix' => 'DOCK-', 'digits' => 4],
                'defaults' => ['status' => 'Scheduled', 'duration_minutes' => 30],
                'rules' => [
                    'warehouseId' => 'required|integer|exists:warehouses,id',
                    'dockCode' => 'required|string|max:16',
                    'scheduledAt' => 'required|date',
                    'durationMinutes' => 'nullable|integer|min:5|max:1440',
                    'type' => 'required|in:Inbound,Outbound',
                    'reference' => 'nullable|string|max:64',
                    'carrier' => 'nullable|string|max:120',
                    'driver' => 'nullable|string|max:120',
                    'status' => 'required|in:Scheduled,Checked In,In Progress,Completed,No-show,Cancelled',
                    'notes' => 'nullable|string|max:2000',
                ],
                'fields' => [
                    'warehouseId' => 'warehouse_id', 'dockCode' => 'dock_code', 'scheduledAt' => 'scheduled_at',
                    'durationMinutes' => 'duration_minutes', 'type' => 'type', 'reference' => 'reference',
                    'carrier' => 'carrier', 'driver' => 'driver', 'status' => 'status', 'notes' => 'notes',
                ],
            ],
        ],

        /*
         * The stock movement log.
         *
         * Read-only and deliberately so — it is the audit trail. A quantity
         * changes by posting a document, never by editing history.
         */
        'warehouse/movements' => [
            'model' => Models\StockMovement::class,
            'with' => ['item', 'warehouse'],
            'sort' => ['moved_at' => 'desc'],
            'limit' => 500,
            'map' => [
                'id' => 'id', 'movedAt' => 'moved_at', 'sku' => 'item.sku', 'name' => 'item.name',
                'warehouse' => 'warehouse.name', 'direction' => 'direction', 'reason' => 'reason',
                'quantity' => 'quantity', 'unitCost' => 'unit_cost',
                'referenceType' => 'reference_type', 'referenceId' => 'reference_id',
            ],
        ],

        /* ======================== MAINTENANCE ========================= */

        'maintenance/assets' => [
            'model' => Models\Asset::class,
            'with' => ['warehouse', 'assignee'],
            'sort' => ['code' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'category' => 'category',
                'site' => 'warehouse.name', 'acquiredOn' => 'acquired_on',
                'acquisitionCost' => 'acquisition_cost', 'bookValue' => 'book_value',
                'usefulLifeYears' => 'useful_life_years', 'salvageValue' => 'salvage_value',
                'meterReading' => 'meter_reading', 'meterUnit' => 'meter_unit',
                'criticality' => 'criticality', 'condition' => 'condition',
                'lastService' => 'last_service_at', 'nextService' => 'next_service_at',
                'assignedTo' => 'assignee.full_name', 'status' => 'status',
                'kmPerLitre' => 'km_per_litre', 'payloadPallets' => 'payload_pallets',
                'warehouseId' => 'warehouse_id', 'assignedToId' => 'assigned_to',
            ],
            'counts' => ['workOrders' => 'jobs', 'downtimeEvents' => 'breakdowns'],
            'write' => [
                'label' => 'name',
                'defaults' => ['status' => 'Operational', 'condition' => 'Good', 'criticality' => 'Medium'],
                'rules' => [
                    'code' => 'required|string|max:32|unique:assets,code',
                    'name' => 'required|string|max:190',
                    'category' => 'required|in:Delivery Vehicle,Material Handling,Facility,Cold Chain,Power,IT Equipment',
                    'warehouseId' => 'nullable|integer|exists:warehouses,id',
                    'acquiredOn' => 'nullable|date',
                    'acquisitionCost' => 'nullable|numeric|min:0',
                    // Book value is depreciated from these, never typed — see
                    // Asset::depreciatedValue.
                    'usefulLifeYears' => 'nullable|integer|min:1|max:60',
                    'salvageValue' => 'nullable|numeric|min:0',
                    'lastService' => 'nullable|date',
                    'nextService' => 'nullable|date',
                    'meterReading' => 'nullable|numeric|min:0',
                    'meterUnit' => 'required|in:km,hours',
                    // Fuel economy drives every delivery cost estimate.
                    'kmPerLitre' => 'nullable|numeric|min:0.1|max:100',
                    'payloadPallets' => 'nullable|integer|min:0|max:1000',
                    'criticality' => 'required|in:High,Medium,Low',
                    'condition' => 'required|in:Excellent,Good,Fair,Poor',
                    'assignedToId' => 'nullable|integer|exists:employees,id',
                    'status' => 'required|in:Operational,Under Maintenance,Breakdown,Retired',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'category' => 'category',
                    'warehouseId' => 'warehouse_id', 'acquiredOn' => 'acquired_on',
                    'acquisitionCost' => 'acquisition_cost', 'usefulLifeYears' => 'useful_life_years',
                    'salvageValue' => 'salvage_value', 'lastService' => 'last_service_at',
                    'nextService' => 'next_service_at', 'meterReading' => 'meter_reading',
                    'meterUnit' => 'meter_unit', 'kmPerLitre' => 'km_per_litre',
                    'payloadPallets' => 'payload_pallets', 'criticality' => 'criticality',
                    'condition' => 'condition', 'assignedToId' => 'assigned_to', 'status' => 'status',
                ],
            ],
        ],

        'maintenance/work-orders' => [
            'model' => Models\WorkOrder::class,
            'with' => ['asset', 'technician', 'warehouse', 'pmSchedule'],
            'sort' => ['reported_at' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'wo_no', 'asset' => 'asset.code', 'assetName' => 'asset.name',
                'summary' => 'summary', 'description' => 'description',
                'type' => 'type', 'priority' => 'priority', 'reported' => 'reported_at', 'due' => 'due_at',
                'completed' => 'completed_at', 'technician' => 'technician.full_name',
                'downtimeHours' => 'downtime_hours', 'meterReading' => 'meter_reading',
                'laborCost' => 'labor_cost', 'partsCost' => 'parts_cost', 'status' => 'status',
                'warehouse' => 'warehouse.name', 'schedule' => 'pmSchedule.code',
                'assetId' => 'asset_id', 'warehouseId' => 'warehouse_id',
                'technicianId' => 'technician_id', 'pmScheduleId' => 'pm_schedule_id',
            ],
            'counts' => ['parts' => 'partsUsed'],
            'computed' => [
                'totalCost' => 'App\\Http\\Controllers\\Api\\Computed::workOrderCost',
            ],
            'write' => [
                'label' => 'wo_no',
                'number' => ['column' => 'wo_no', 'prefix' => 'WO-', 'digits' => 4],
                'defaults' => ['status' => 'Open', 'type' => 'Corrective', 'priority' => 'Medium'],
                'rules' => [
                    'assetId' => 'required|integer|exists:assets,id',
                    'summary' => 'required|string|max:190',
                    'description' => 'nullable|string|max:2000',
                    'type' => 'required|in:Corrective,Preventive,Inspection,Calibration,Emergency',
                    'priority' => 'required|in:Critical,High,Medium,Low',
                    'reported' => 'required|date',
                    'due' => 'nullable|date|after_or_equal:reported',
                    'technicianId' => 'nullable|integer|exists:employees,id',
                    'pmScheduleId' => 'nullable|integer|exists:pm_schedules,id',
                    // Where the spare parts come off. Required only in practice
                    // — a job with no parts has nothing to issue.
                    'warehouseId' => 'nullable|integer|exists:warehouses,id',
                    'downtimeHours' => 'nullable|numeric|min:0|max:9999',
                    'meterReading' => 'nullable|numeric|min:0',
                    'laborCost' => 'nullable|numeric|min:0',
                    // Completed issues the parts, returns the asset to service
                    // and rolls its preventive schedule forward.
                    'status' => 'required|in:Open,Assigned,In Progress,On Hold,Completed,Cancelled',
                ],
                'fields' => [
                    'assetId' => 'asset_id', 'warehouseId' => 'warehouse_id', 'summary' => 'summary',
                    'description' => 'description', 'type' => 'type', 'priority' => 'priority',
                    'reported' => 'reported_at', 'due' => 'due_at', 'technicianId' => 'technician_id',
                    'pmScheduleId' => 'pm_schedule_id', 'downtimeHours' => 'downtime_hours',
                    'meterReading' => 'meter_reading', 'laborCost' => 'labor_cost', 'status' => 'status',
                ],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'parts',
                    'rules' => [
                        'itemId' => 'required|integer|exists:items,id',
                        'quantity' => 'required|numeric|min:0.01',
                    ],
                    'fields' => ['itemId' => 'item_id', 'quantity' => 'quantity'],
                    // Parts are costed from the item master by the model, so the
                    // generic line-total arithmetic is switched off here.
                    'line_total_column' => null,
                    'header_columns' => [],
                ],
            ],
        ],

        'maintenance/preventive' => [
            'model' => Models\PmSchedule::class,
            'with' => ['asset', 'assignee'],
            'sort' => ['next_due_at' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'asset' => 'asset.code', 'assetName' => 'asset.name',
                'task' => 'task', 'frequency' => 'frequency', 'meterInterval' => 'meter_interval',
                'lastDone' => 'last_done_at', 'nextDue' => 'next_due_at',
                'lastMeter' => 'last_meter', 'nextDueMeter' => 'next_due_meter',
                'assignedTo' => 'assignee.full_name', 'compliance' => 'compliance_pct', 'status' => 'status',
                'assetId' => 'asset_id', 'assignedToId' => 'assigned_to',
            ],
            'counts' => ['workOrders' => 'jobs'],
            'write' => [
                'label' => 'code',
                'number' => ['column' => 'code', 'prefix' => 'PM-', 'digits' => 4],
                'defaults' => ['status' => 'Scheduled'],
                'rules' => [
                    'assetId' => 'required|integer|exists:assets,id',
                    'task' => 'required|string|max:190',
                    'frequency' => 'required|in:Weekly,Monthly,Quarterly,Semi-annual,Annual,Meter',
                    // Meter plans fall due on hours or kilometres run, so the
                    // interval is what makes them a rule rather than a note.
                    'meterInterval' => 'nullable|numeric|min:1|required_if:frequency,Meter',
                    'lastDone' => 'nullable|date',
                    'nextDue' => 'nullable|date',
                    'assignedToId' => 'nullable|integer|exists:employees,id',
                    'status' => 'required|in:Scheduled,Due,Overdue,Completed,Inactive',
                ],
                'fields' => [
                    'assetId' => 'asset_id', 'task' => 'task', 'frequency' => 'frequency',
                    'meterInterval' => 'meter_interval', 'lastDone' => 'last_done_at',
                    'nextDue' => 'next_due_at', 'assignedToId' => 'assigned_to', 'status' => 'status',
                ],
            ],
        ],

        'maintenance/fleet' => [
            'model' => Models\Vehicle::class,
            'with' => ['asset.warehouse', 'driver', 'ownerEmployee'],
            'sort' => ['plate_no' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'asset.code', 'plate' => 'plate_no', 'model' => 'model',
                'driver' => 'driver.full_name', 'site' => 'asset.warehouse.name', 'odometer' => 'odometer',
                'kmSinceService' => 'km_since_service', 'fuelEfficiency' => 'fuel_efficiency',
                'registrationExpiry' => 'registration_expiry', 'insuranceExpiry' => 'insurance_expiry',
                'status' => 'status', 'assetId' => 'asset_id', 'driverId' => 'driver_id',
                'ownership' => 'ownership', 'ownerEmployeeId' => 'owner_employee_id',
                'ownerEmployee' => 'ownerEmployee.full_name', 'vehicleType' => 'vehicle_type',
            ],
            'write' => [
                'label' => 'plate_no',
                'defaults' => ['status' => 'Available', 'ownership' => 'CO'],
                'rules' => [
                    // One vehicle row per asset — the asset register is where a
                    // truck's history and value live, and two rows for one truck
                    // is how a fleet ends up with two odometers.
                    'assetId' => 'required|integer|exists:assets,id|unique:vehicles,asset_id',
                    'plate' => 'required|string|max:24|unique:vehicles,plate_no',
                    'model' => 'nullable|string|max:120',
                    'driverId' => 'nullable|integer|exists:employees,id',
                    'odometer' => 'nullable|numeric|min:0',
                    'kmSinceService' => 'nullable|numeric|min:0',
                    'registrationExpiry' => 'nullable|date',
                    'insuranceExpiry' => 'nullable|date',
                    'status' => 'required|in:Available,On Trip,Under Maintenance,Breakdown,Retired',
                    'ownership' => 'nullable|in:CO,PO,R&C',
                    // A personally-owned vehicle needs someone to reimburse —
                    // required exactly when ownership says the company doesn't
                    // own it, optional (and usually blank) otherwise.
                    'ownerEmployeeId' => 'required_if:ownership,PO|nullable|integer|exists:employees,id',
                    'vehicleType' => 'nullable|in:Sedan,Pickup,Van,Truck,Motorcycle',
                ],
                'fields' => [
                    'assetId' => 'asset_id', 'plate' => 'plate_no', 'model' => 'model',
                    'driverId' => 'driver_id', 'odometer' => 'odometer',
                    'kmSinceService' => 'km_since_service',
                    'registrationExpiry' => 'registration_expiry',
                    'insuranceExpiry' => 'insurance_expiry', 'status' => 'status',
                    'ownership' => 'ownership', 'ownerEmployeeId' => 'owner_employee_id',
                    'vehicleType' => 'vehicle_type',
                ],
            ],
        ],

        /* The trip ticket. Read-only through the registry: raising one has to
           compute a route, and deciding one has to check who is asking, so both
           go through FuelRequestController rather than the generic writer. */
        'maintenance/fuel-requests' => [
            'model' => Models\FuelRequest::class,
            'with' => ['vehicle', 'driver', 'requestedBy', 'approvedBy'],
            'sort' => ['id' => 'desc'],
            'map' => [
                'id' => 'id', 'reference' => 'reference', 'status' => 'status',
                'purpose' => 'purpose',
                'vehicleId' => 'vehicle_id', 'vehicle' => 'vehicle.plate_no',
                'vehicleModel' => 'vehicle.model',
                'driverId' => 'driver_id', 'driver' => 'driver.full_name',
                'requestedBy' => 'requestedBy.name',
                'departAt' => 'depart_at',
                // Derived on the model — departure plus the routed duration. Without
                // it here the printed form, which reads the list, has no arrival time.
                'eta' => 'eta',
                'originLabel' => 'origin_label', 'originLat' => 'origin_lat', 'originLng' => 'origin_lng',
                'destinationLabel' => 'destination_label',
                'destinationLat' => 'destination_lat', 'destinationLng' => 'destination_lng',
                'roundTrip' => 'round_trip',
                'distanceKm' => 'distance_km', 'durationMinutes' => 'duration_minutes',
                'routeSource' => 'route_source',
                'kmPerLitre' => 'km_per_litre', 'reservePct' => 'reserve_pct',
                'suggestedLitres' => 'suggested_litres', 'approvedLitres' => 'approved_litres',
                'fuelPrice' => 'fuel_price', 'estimatedCost' => 'estimated_cost',
                'mileageRate' => 'mileage_rate', 'mileageAmount' => 'mileage_amount',
                'approvedBy' => 'approvedBy.name', 'approvedByRole' => 'approved_by_role',
                'decidedAt' => 'decided_at', 'decisionNote' => 'decision_note',
                'notes' => 'notes', 'createdAt' => 'created_at',
                'businessUnit' => 'business_unit', 'supplier' => 'supplier',
                'vehicleOwnership' => 'vehicle_ownership', 'poCategory' => 'po_category',
                'products' => 'products', 'productOther' => 'product_other',
                'unit' => 'unit', 'chargeInvoiceNo' => 'charge_invoice_no',
            ],
        ],

        'maintenance/fuel' => [
            'model' => Models\FuelLog::class,
            'with' => ['vehicle.asset', 'driver'],
            'sort' => ['logged_at' => 'desc'],
            'map' => [
                'id' => 'id', 'date' => 'logged_at', 'vehicle' => 'vehicle.asset.code',
                'plate' => 'vehicle.plate_no', 'driver' => 'driver.full_name',
                'liters' => 'litres', 'cost' => 'cost', 'odometer' => 'odometer',
                'distance' => 'distance_km', 'kmPerLiter' => 'km_per_litre', 'station' => 'station',
                'flagged' => 'is_flagged', 'vehicleId' => 'vehicle_id', 'driverId' => 'driver_id',
            ],
            'computed' => [
                'review' => 'App\\Http\\Controllers\\Api\\Computed::fuelReview',
            ],
            'write' => [
                'defaults' => [],
                'rules' => [
                    'vehicleId' => 'required|integer|exists:vehicles,id',
                    'driverId' => 'nullable|integer|exists:employees,id',
                    'date' => 'required|date',
                    'liters' => 'required|numeric|min:0.01|max:2000',
                    'cost' => 'required|numeric|min:0',
                    // Distance, efficiency and the anomaly flag are all derived
                    // from this against the previous fill — see FuelLog::booted.
                    'odometer' => 'required|numeric|min:0',
                    'station' => 'nullable|string|max:120',
                ],
                'fields' => [
                    'vehicleId' => 'vehicle_id', 'driverId' => 'driver_id', 'date' => 'logged_at',
                    'liters' => 'litres', 'cost' => 'cost', 'odometer' => 'odometer',
                    'station' => 'station',
                ],
            ],
        ],

        'maintenance/spare-parts' => [
            'model' => Models\Item::class,
            'scope' => ['is_spare_part' => true],
            'with' => ['primarySupplier'],
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'sku' => 'sku', 'name' => 'name', 'category' => 'category',
                'unitCost' => 'unit_cost', 'reorderPoint' => 'reorder_point',
                'reorderQty' => 'reorder_qty', 'leadTimeDays' => 'lead_time_days',
                'supplier' => 'primarySupplier.name', 'supplierId' => 'primary_supplier_id',
                'uom' => 'uom',
            ],
            'sums' => ['stockBalances' => ['on_hand' => 'onHand', 'available' => 'available']],
            'computed' => [
                'value' => 'App\\Http\\Controllers\\Api\\Computed::sparePartValue',
                'status' => 'App\\Http\\Controllers\\Api\\Computed::sparePartStatus',
            ],
        ],

        'maintenance/technicians' => [
            'model' => Models\Employee::class,
            'scopeRelation' => ['hrDepartment.code' => 'MAINTENANCE'],
            'with' => ['position', 'branchUnit'],
            'sort' => ['last_name' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'employee_no', 'name' => 'full_name',
                'position' => 'position.title', 'site' => 'branchUnit.code',
                'status' => 'employment_status',
            ],
        ],

        'maintenance/downtime' => [
            'model' => Models\DowntimeEvent::class,
            'with' => ['asset', 'workOrder'],
            'sort' => ['occurred_at' => 'desc'],
            'map' => [
                'id' => 'id', 'date' => 'occurred_at', 'asset' => 'asset.code', 'assetName' => 'asset.name',
                'cause' => 'cause', 'hours' => 'hours', 'impact' => 'impact', 'rootCause' => 'root_cause',
                'costImpact' => 'cost_impact', 'status' => 'status',
                'workOrder' => 'workOrder.wo_no', 'assetId' => 'asset_id', 'workOrderId' => 'work_order_id',
            ],
            'write' => [
                'defaults' => ['status' => 'Under Investigation', 'impact' => 'None'],
                'rules' => [
                    'assetId' => 'required|integer|exists:assets,id',
                    'date' => 'required|date',
                    'cause' => 'required|string|max:190',
                    'hours' => 'required|numeric|min:0|max:9999',
                    'impact' => 'required|in:Deliveries delayed,Reduced throughput,None,Line stopped,Cold chain risk',
                    // The root cause is what stops a failure recurring, so it is
                    // asked for by name rather than buried in a notes field.
                    'rootCause' => 'nullable|string|max:190',
                    'costImpact' => 'nullable|numeric|min:0',
                    'workOrderId' => 'nullable|integer|exists:work_orders,id',
                    'status' => 'required|in:Under Investigation,Resolved,Recurring',
                ],
                'fields' => [
                    'assetId' => 'asset_id', 'date' => 'occurred_at', 'cause' => 'cause',
                    'hours' => 'hours', 'impact' => 'impact', 'rootCause' => 'root_cause',
                    'costImpact' => 'cost_impact', 'workOrderId' => 'work_order_id', 'status' => 'status',
                ],
            ],
        ],

        /* ========================== FINANCE =========================== */

        'finance/accounts' => [
            'model' => Models\Account::class,
            'with' => ['parent'],
            'sort' => ['code' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'type' => 'type', 'subtype' => 'subtype',
                'normal' => 'normal_balance', 'level' => 'level', 'balance' => 'balance',
                'parent' => 'parent.name', 'parentId' => 'parent_id', 'isPostable' => 'is_postable',
                'isActive' => 'is_active', 'status' => 'status_label',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true, 'is_postable' => true, 'level' => 2],
                'rules' => [
                    'code' => 'required|string|max:16|unique:accounts,code',
                    'name' => 'required|string|max:190',
                    // The normal balance follows from the type and is never
                    // asked for: an account that increases on the wrong side
                    // reports its own balance backwards.
                    'type' => 'required|in:Asset,Liability,Equity,Revenue,Expense',
                    'subtype' => 'nullable|string|max:64',
                    'parentId' => 'nullable|integer|exists:accounts,id',
                    'level' => 'nullable|integer|min:0|max:5',
                    'isPostable' => 'nullable|boolean',
                    'isActive' => 'nullable|boolean',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'type' => 'type', 'subtype' => 'subtype',
                    'parentId' => 'parent_id', 'level' => 'level',
                    'isPostable' => 'is_postable', 'isActive' => 'is_active',
                ],
            ],
        ],

        'finance/journals' => [
            'model' => Models\JournalEntry::class,
            'with' => ['preparedBy', 'postedBy', 'reverses'],
            'sort' => ['entry_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'journal_no', 'date' => 'entry_date', 'memo' => 'memo',
                'source' => 'source', 'reference' => 'reference_type',
                'debit' => 'total_debit', 'credit' => 'total_credit', 'status' => 'status',
                'preparedBy' => 'preparedBy.name', 'postedBy' => 'postedBy.name',
                'postedAt' => 'posted_at', 'reverses' => 'reverses.journal_no',
            ],
            'counts' => ['lines' => 'lineCount'],
            'computed' => [
                'outOfBalance' => 'App\\Http\\Controllers\\Api\\Computed::journalOutOfBalance',
            ],
            'write' => [
                'label' => 'journal_no',
                'number' => ['column' => 'journal_no', 'prefix' => 'JV-', 'digits' => 4],
                'defaults' => ['status' => 'Draft', 'source' => 'Manual'],
                'rules' => [
                    'date' => 'required|date',
                    'memo' => 'nullable|string|max:255',
                    'source' => 'required|in:Sales,Purchases,Payroll,Cash,Adjusting,Depreciation,Manual',
                    // Status is deliberately absent. Only the Ledger moves an
                    // entry to Posted, and only once it balances.
                ],
                'fields' => ['date' => 'entry_date', 'memo' => 'memo', 'source' => 'source'],
                'lines' => [
                    'input' => 'lines',
                    'relation' => 'lines',
                    'rules' => [
                        'accountId' => 'required|integer|exists:accounts,id',
                        'description' => 'nullable|string|max:255',
                        'debit' => 'nullable|numeric|min:0',
                        'credit' => 'nullable|numeric|min:0',
                        'departmentId' => 'nullable|integer|exists:hr_departments,id',
                    ],
                    'fields' => [
                        'accountId' => 'account_id', 'description' => 'description',
                        'debit' => 'debit', 'credit' => 'credit', 'departmentId' => 'hr_department_id',
                    ],
                    // Header totals are recomputed by the model from the lines.
                    'line_total_column' => null,
                    'header_columns' => [],
                ],
            ],
        ],

        'finance/receivables' => [
            'model' => Models\ArInvoice::class,
            'with' => ['customer', 'salesOrder', 'collector'],
            'sort' => ['due_date' => 'asc'],
            'map' => [
                'id' => 'id', 'no' => 'invoice_no', 'customer' => 'customer.name', 'customerId' => 'customer_id',
                'soNo' => 'salesOrder.order_no', 'salesOrderId' => 'sales_order_id',
                'date' => 'invoice_date', 'due' => 'due_date', 'memo' => 'memo',
                'amount' => 'amount', 'vat' => 'vat_amount', 'paid' => 'paid', 'balance' => 'balance',
                'daysOverdue' => 'days_overdue', 'bucket' => 'ageing_bucket',
                'collector' => 'collector.full_name', 'collectorId' => 'collector_id', 'status' => 'status',
            ],
            'write' => [
                'label' => 'invoice_no',
                'number' => ['column' => 'invoice_no', 'prefix' => 'INV-', 'digits' => 4],
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'customerId' => 'required|integer|exists:customers,id',
                    'salesOrderId' => 'nullable|integer|exists:sales_orders,id',
                    'date' => 'required|date',
                    'due' => 'required|date|after_or_equal:date',
                    'memo' => 'nullable|string|max:255',
                    'amount' => 'required|numeric|min:0.01',
                    // Split out so Output VAT can be posted and the 2550M has
                    // something to be assembled from.
                    'vat' => 'nullable|numeric|min:0|lte:amount',
                    'collectorId' => 'nullable|integer|exists:employees,id',
                    // Paid, balance, ageing and status are all derived.
                ],
                'fields' => [
                    'customerId' => 'customer_id', 'salesOrderId' => 'sales_order_id',
                    'date' => 'invoice_date', 'due' => 'due_date', 'memo' => 'memo',
                    'amount' => 'amount', 'vat' => 'vat_amount', 'collectorId' => 'collector_id',
                ],
            ],
        ],

        'finance/ar-receipts' => [
            'model' => Models\ArReceipt::class,
            'with' => ['customer', 'bankAccount', 'receivedBy', 'journalEntry'],
            'sort' => ['receipt_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'receipt_no', 'customer' => 'customer.name',
                'date' => 'receipt_date', 'amount' => 'amount', 'unapplied' => 'unapplied',
                'method' => 'method', 'reference' => 'reference', 'bank' => 'bankAccount.name',
                'receivedBy' => 'receivedBy.full_name', 'journalNo' => 'journalEntry.journal_no',
                'status' => 'status',
            ],
            'counts' => ['allocations' => 'invoices'],
        ],

        'finance/payables' => [
            'model' => Models\ApBill::class,
            'with' => ['supplier', 'supplierInvoice.purchaseOrder', 'account'],
            'sort' => ['due_date' => 'asc'],
            'map' => [
                'id' => 'id', 'no' => 'bill_no', 'supplier' => 'supplier.name', 'supplierId' => 'supplier_id',
                'poNo' => 'supplierInvoice.purchaseOrder.po_no', 'supplierInvoiceId' => 'supplier_invoice_id',
                'date' => 'bill_date', 'due' => 'due_date', 'memo' => 'memo',
                'amount' => 'amount', 'vat' => 'vat_amount', 'paid' => 'paid', 'balance' => 'balance',
                'account' => 'account.name', 'accountId' => 'account_id',
                'daysToDue' => 'days_to_due', 'bucket' => 'ageing_bucket', 'status' => 'status',
            ],
            'write' => [
                'label' => 'bill_no',
                'number' => ['column' => 'bill_no', 'prefix' => 'BILL-', 'digits' => 4],
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'supplierId' => 'required|integer|exists:suppliers,id',
                    'supplierInvoiceId' => 'nullable|integer|exists:supplier_invoices,id',
                    'date' => 'required|date',
                    'due' => 'required|date|after_or_equal:date',
                    'memo' => 'nullable|string|max:255',
                    'amount' => 'required|numeric|min:0.01',
                    'vat' => 'nullable|numeric|min:0|lte:amount',
                    // Which expense or asset account the bill lands in.
                    'accountId' => 'nullable|integer|exists:accounts,id',
                ],
                'fields' => [
                    'supplierId' => 'supplier_id', 'supplierInvoiceId' => 'supplier_invoice_id',
                    'date' => 'bill_date', 'due' => 'due_date', 'memo' => 'memo',
                    'amount' => 'amount', 'vat' => 'vat_amount', 'accountId' => 'account_id',
                ],
            ],
        ],

        'finance/ap-payments' => [
            'model' => Models\ApPayment::class,
            'with' => ['supplier', 'bankAccount', 'journalEntry'],
            'sort' => ['payment_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'payment_no', 'supplier' => 'supplier.name',
                'date' => 'payment_date', 'amount' => 'amount', 'unapplied' => 'unapplied',
                'method' => 'method', 'reference' => 'reference', 'bank' => 'bankAccount.name',
                'journalNo' => 'journalEntry.journal_no', 'status' => 'status',
            ],
            'counts' => ['allocations' => 'bills'],
        ],

        'finance/bank-accounts' => [
            'model' => Models\BankAccount::class,
            'with' => ['glAccount'],
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'name' => 'name', 'bank' => 'bank', 'accountNo' => 'account_no',
                'type' => 'type', 'currency' => 'currency', 'balance' => 'balance',
                'unreconciled' => 'unreconciled_count', 'lastReconciled' => 'last_reconciled_at',
                'glAccount' => 'glAccount.name', 'glAccountId' => 'gl_account_id', 'status' => 'status',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['status' => 'Active', 'currency' => 'PHP'],
                'rules' => [
                    'name' => 'required|string|max:150',
                    'bank' => 'required|string|max:120',
                    'accountNo' => 'required|string|max:48',
                    'type' => 'required|in:Operating,Payroll,Savings,Time Deposit',
                    'currency' => 'required|string|max:8',
                    'glAccountId' => 'nullable|integer|exists:accounts,id',
                    'status' => 'required|in:Active,Dormant,Closed',
                    // Balance is absent by design: it is the sum of the
                    // statement lines, and the bank is the authority on it.
                ],
                'fields' => [
                    'name' => 'name', 'bank' => 'bank', 'accountNo' => 'account_no', 'type' => 'type',
                    'currency' => 'currency', 'glAccountId' => 'gl_account_id', 'status' => 'status',
                ],
            ],
        ],

        'finance/bank-transactions' => [
            'model' => Models\BankTransaction::class,
            'with' => ['bankAccount', 'journalEntry'],
            'sort' => ['transaction_date' => 'desc'],
            'map' => [
                'id' => 'id', 'account' => 'bankAccount.name', 'bankAccountId' => 'bank_account_id',
                'date' => 'transaction_date', 'description' => 'description', 'reference' => 'reference',
                'debit' => 'debit', 'credit' => 'credit', 'reconciled' => 'is_reconciled',
                'journalNo' => 'journalEntry.journal_no',
            ],
            'computed' => [
                'status' => 'App\\Http\\Controllers\\Api\\Computed::reconciliationStatus',
            ],
            'write' => [
                'defaults' => ['is_reconciled' => false],
                'rules' => [
                    'bankAccountId' => 'required|integer|exists:bank_accounts,id',
                    'date' => 'required|date',
                    'description' => 'nullable|string|max:255',
                    'reference' => 'nullable|string|max:64',
                    'debit' => 'nullable|numeric|min:0',
                    'credit' => 'nullable|numeric|min:0',
                ],
                'fields' => [
                    'bankAccountId' => 'bank_account_id', 'date' => 'transaction_date',
                    'description' => 'description', 'reference' => 'reference',
                    'debit' => 'debit', 'credit' => 'credit',
                ],
            ],
        ],

        'finance/expenses' => [
            'model' => Models\Expense::class,
            'with' => ['employee', 'hrDepartment', 'account', 'journalEntry'],
            'sort' => ['expense_date' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'expense_no', 'employee' => 'employee.full_name',
                'employeeId' => 'employee_id', 'department' => 'hrDepartment.name',
                'departmentId' => 'hr_department_id', 'category' => 'category',
                'description' => 'description', 'date' => 'expense_date',
                'amount' => 'amount', 'fundType' => 'fund_type', 'account' => 'account.name',
                'accountId' => 'account_id', 'journalNo' => 'journalEntry.journal_no', 'status' => 'status',
            ],
            'write' => [
                'label' => 'expense_no',
                'number' => ['column' => 'expense_no', 'prefix' => 'EXP-', 'digits' => 4],
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'departmentId' => 'nullable|integer|exists:hr_departments,id',
                    'category' => 'required|in:Travel,Meals,Fuel,Supplies,Representation,Utilities,Repairs,Communication',
                    'description' => 'nullable|string|max:255',
                    'date' => 'required|date',
                    'amount' => 'required|numeric|min:0.01',
                    'fundType' => 'required|in:Petty Cash,Reimbursement,Corporate Card,Cash Advance',
                    'accountId' => 'nullable|integer|exists:accounts,id',
                    // Approved and Liquidated are reached by approving the
                    // claim, which posts it — not by picking them here.
                    'status' => 'required|in:Draft,Submitted,For Approval,Rejected',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'departmentId' => 'hr_department_id',
                    'category' => 'category', 'description' => 'description', 'date' => 'expense_date',
                    'amount' => 'amount', 'fundType' => 'fund_type', 'accountId' => 'account_id',
                    'status' => 'status',
                ],
            ],
        ],

        /* An employee's own money, paid back. Approve/reject/mark-paid and
           the create-from-fuel-request cross-link are bespoke
           (ReimbursementClaimController) — everything else, including plain
           create/edit for a Draft claim, goes through here. */
        'finance/reimbursements' => [
            'model' => Models\ReimbursementClaim::class,
            'with' => ['employee', 'approvedBy', 'fuelRequest'],
            'sort' => ['claim_date' => 'desc'],
            'map' => [
                'id' => 'id', 'claimNo' => 'claim_no', 'employee' => 'employee.full_name',
                'employeeId' => 'employee_id', 'category' => 'category', 'claimDate' => 'claim_date',
                'amount' => 'amount', 'description' => 'description', 'receiptPath' => 'receipt_path',
                'fuelRequestId' => 'fuel_request_id', 'fuelRequestReference' => 'fuelRequest.reference',
                'distanceKm' => 'distance_km', 'ratePerKm' => 'rate_per_km', 'status' => 'status',
                'approvedBy' => 'approvedBy.name', 'decidedAt' => 'decided_at', 'decisionNote' => 'decision_note',
                'paidAt' => 'paid_at', 'paymentReference' => 'payment_reference',
            ],
            'write' => [
                'label' => 'claim_no',
                'number' => ['column' => 'claim_no', 'prefix' => 'RC-', 'digits' => 4],
                'defaults' => ['status' => 'Draft', 'category' => 'Other'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'category' => 'required|in:Mileage,Travel,Meals,Supplies,Other',
                    'claimDate' => 'required|date',
                    'amount' => 'required|numeric|min:0.01',
                    'description' => 'nullable|string|max:255',
                    // A receipt is the point of most claims — a mileage claim
                    // has none, because the record it stands on is the trip
                    // itself, not a piece of paper.
                    'receiptPath' => 'nullable|string|max:255|required_unless:category,Mileage',
                    'distanceKm' => 'nullable|numeric|min:0',
                    'ratePerKm' => 'nullable|numeric|min:0',
                    // Approved/Paid/Rejected are reached by deciding the
                    // claim, which stamps who and when — not by picking them
                    // here.
                    'status' => 'required|in:Draft,Submitted',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'category' => 'category', 'claimDate' => 'claim_date',
                    'amount' => 'amount', 'description' => 'description', 'receiptPath' => 'receipt_path',
                    'distanceKm' => 'distance_km', 'ratePerKm' => 'rate_per_km', 'status' => 'status',
                ],
            ],
        ],

        'finance/fixed-assets' => [
            'model' => Models\FixedAsset::class,
            'with' => ['asset'],
            'sort' => ['code' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'class' => 'asset_class',
                'acquired' => 'acquired_on', 'cost' => 'cost', 'salvageValue' => 'salvage_value',
                'accumulatedDep' => 'accumulated_depreciation', 'netBookValue' => 'net_book_value',
                'method' => 'method', 'usefulLifeYears' => 'useful_life_years',
                'monthlyDep' => 'monthly_depreciation', 'depreciatedTo' => 'depreciated_to',
                'assetCode' => 'asset.code', 'assetId' => 'asset_id',
                'disposedOn' => 'disposed_on', 'status' => 'status',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['status' => 'In Service', 'method' => 'Straight Line'],
                'rules' => [
                    'code' => 'required|string|max:32|unique:fixed_assets,code',
                    'name' => 'required|string|max:190',
                    'class' => 'nullable|string|max:120',
                    'assetId' => 'nullable|integer|exists:assets,id',
                    'acquired' => 'required|date',
                    'cost' => 'required|numeric|min:0',
                    'salvageValue' => 'nullable|numeric|min:0|lte:cost',
                    'method' => 'required|in:Straight Line,Declining Balance',
                    'usefulLifeYears' => 'required|integer|min:1|max:60',
                    'disposedOn' => 'nullable|date',
                    // Accumulated depreciation and NBV are absent by design:
                    // they are what the depreciation runs have posted.
                    'status' => 'required|in:In Service,Fully Depreciated,Disposed,Impaired',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'class' => 'asset_class', 'assetId' => 'asset_id',
                    'acquired' => 'acquired_on', 'cost' => 'cost', 'salvageValue' => 'salvage_value',
                    'method' => 'method', 'usefulLifeYears' => 'useful_life_years',
                    'disposedOn' => 'disposed_on', 'status' => 'status',
                ],
            ],
        ],

        'finance/tax-filings' => [
            'model' => Models\TaxFiling::class,
            'with' => ['journalEntry'],
            'sort' => ['due_date' => 'asc'],
            'map' => [
                'id' => 'id', 'form' => 'form', 'description' => 'description', 'period' => 'period',
                'dueDate' => 'due_date', 'taxBase' => 'tax_base', 'taxDue' => 'tax_due',
                'filedOn' => 'filed_on', 'confirmationNo' => 'confirmation_no', 'status' => 'status',
            ],
            'write' => [
                'label' => 'form',
                'defaults' => ['status' => 'Not Started'],
                'rules' => [
                    'form' => 'required|string|max:24',
                    'description' => 'required|string|max:190',
                    'period' => 'required|string|max:48',
                    'dueDate' => 'required|date',
                    'taxBase' => 'nullable|numeric|min:0',
                    'taxDue' => 'nullable|numeric|min:0',
                    // Overdue follows from the due date, and Filed is reached
                    // by filing the return.
                    'status' => 'required|in:Not Started,In Preparation,For Review,Paid',
                ],
                'fields' => [
                    'form' => 'form', 'description' => 'description', 'period' => 'period',
                    'dueDate' => 'due_date', 'taxBase' => 'tax_base', 'taxDue' => 'tax_due',
                    'status' => 'status',
                ],
            ],
        ],

        'finance/budgets' => [
            'model' => Models\BudgetLine::class,
            'with' => ['hrDepartment', 'account'],
            'sort' => ['id' => 'asc'],
            'map' => [
                'id' => 'id', 'year' => 'year', 'department' => 'hrDepartment.name',
                'departmentId' => 'hr_department_id', 'category' => 'account.name',
                'accountId' => 'account_id', 'annualBudget' => 'annual_budget',
                'ytdBudget' => 'ytd_budget', 'ytdActual' => 'ytd_actual', 'committed' => 'committed',
            ],
            'computed' => [
                'account' => 'App\\Http\\Controllers\\Api\\Computed::budgetAccount',
                'variance' => 'App\\Http\\Controllers\\Api\\Computed::budgetVariance',
                'variancePct' => 'App\\Http\\Controllers\\Api\\Computed::budgetVariancePct',
                'status' => 'App\\Http\\Controllers\\Api\\Computed::budgetStatus',
            ],
            'write' => [
                'label' => 'id',
                'defaults' => [],
                'rules' => [
                    'year' => 'required|integer|min:2000|max:2100',
                    'departmentId' => 'required|integer|exists:hr_departments,id',
                    'accountId' => 'required|integer|exists:accounts,id',
                    'annualBudget' => 'required|numeric|min:0',
                    'committed' => 'nullable|numeric|min:0',
                    // ytdBudget is a share of the annual figure and ytdActual is
                    // what the ledger says. Neither is typed.
                ],
                'fields' => [
                    'year' => 'year', 'departmentId' => 'hr_department_id', 'accountId' => 'account_id',
                    'annualBudget' => 'annual_budget', 'committed' => 'committed',
                ],
            ],
        ],

        /* ============================ HR ============================== */

        'hr/employees' => [
            'model' => Models\Employee::class,
            'with' => ['businessGroup', 'legalEntity', 'hrDepartment', 'branchUnit', 'position', 'payrollGroup', 'shift'],
            'sort' => ['employee_no' => 'asc'],
            'map' => [
                'id' => 'id', 'employeeNo' => 'employee_no',
                'firstName' => 'first_name', 'middleName' => 'middle_name', 'lastName' => 'last_name',
                'suffix' => 'suffix', 'fullName' => 'full_name', 'birthDate' => 'birth_date',
                'civilStatus' => 'civil_status', 'sex' => 'sex', 'group' => 'businessGroup.code',
                'department' => 'hrDepartment.code', 'branchUnit' => 'branchUnit.code',
                'positionTitle' => 'position.title', 'level' => 'level', 'costCenter' => 'cost_center',
                'employmentStatus' => 'employment_status',
                // Foreign keys, so the edit form opens with the right options
                // already selected rather than blank.
                'businessGroupId' => 'business_group_id', 'departmentId' => 'hr_department_id',
                'branchUnitId' => 'branch_unit_id', 'positionId' => 'position_id',
                'payrollGroupId' => 'payroll_group_id', 'reportsToId' => 'reports_to_id',
                'shiftId' => 'shift_id', 'shift' => 'shift.name',
                'legalEntityId' => 'legal_entity_id', 'legalEntity' => 'legalEntity.name',
                'mobile' => 'mobile', 'address' => 'address',
                'emergencyContactName' => 'emergency_contact_name',
                'emergencyContactRelationship' => 'emergency_contact_relationship',
                'emergencyContactPhone' => 'emergency_contact_phone',
                'dateSeparated' => 'date_separated', 'perHourFlag' => 'per_hour',
                'tin' => 'tin', 'sss' => 'sss_no', 'phic' => 'philhealth_no', 'pagibig' => 'pagibig_no',
                'atmAccount' => 'atm_account', 'payrollFrequency' => 'payrollGroup.frequency',
                'salary' => 'salary', 'dateHired' => 'date_hired',
                'payrollGroup' => 'payrollGroup.code', 'paymentMode' => 'payment_mode',
                'emailAddress' => 'email', 'dailyRate' => 'daily_rate',
                'monthlyEquivalent' => 'monthly_equivalent',
            ],
            'booleansAsYesNo' => [
                'taxExempted' => 'tax_exempted', 'sssExempted' => 'sss_exempted',
                'phicExempted' => 'philhealth_exempted', 'pagibigExempted' => 'pagibig_exempted',
                'perHour' => 'per_hour', 'confidential' => 'confidential',
                'minimumWageEarner' => 'minimum_wage_earner',
            ],
            'write' => [
                'label' => 'employee_no',
                'defaults' => [
                    'employment_status' => 'PROBATION',
                    'civil_status' => 'S',
                    'payment_mode' => 'ATM',
                    'level' => 1,
                    'per_hour' => false,
                ],
                'rules' => [
                    // The number staff quote, and the stem of their sign-in.
                    'employeeNo' => 'required|string|max:32|unique:employees,employee_no',
                    'firstName' => 'required|string|max:80',
                    'middleName' => 'nullable|string|max:80',
                    'lastName' => 'required|string|max:80',
                    'suffix' => 'nullable|string|max:16',
                    'birthDate' => 'nullable|date|before:today',
                    'civilStatus' => 'required|in:S,M,D,W',
                    'sex' => 'nullable|in:Male,Female',

                    'businessGroupId' => 'required|integer|exists:business_groups,id',
                    'legalEntityId' => 'nullable|integer|exists:legal_entities,id',
                    'departmentId' => 'required|integer|exists:hr_departments,id',
                    'branchUnitId' => 'required|integer|exists:branch_units,id',
                    'positionId' => 'required|integer|exists:positions,id',
                    'payrollGroupId' => 'required|integer|exists:payroll_groups,id',
                    'reportsToId' => 'nullable|integer|exists:employees,id',
                    'shiftId' => 'nullable|integer|exists:shifts,id',

                    'level' => 'nullable|integer|min:1|max:20',
                    'costCenter' => 'nullable|string|max:64',
                    'employmentStatus' => 'required|in:PROBATION,REGULAR,RESIGNED,TERMINATED',
                    'dateHired' => 'required|date',
                    'dateSeparated' => 'nullable|date|after_or_equal:dateHired',

                    'tin' => 'nullable|string|max:32',
                    'sss' => 'nullable|string|max:32',
                    'phic' => 'nullable|string|max:32',
                    'pagibig' => 'nullable|string|max:32',
                    'taxExempted' => 'nullable|boolean',
                    'sssExempted' => 'nullable|boolean',
                    'phicExempted' => 'nullable|boolean',
                    'pagibigExempted' => 'nullable|boolean',

                    // Hourly when `perHour` is set, monthly otherwise — which
                    // is why the label on the form changes with the switch.
                    'salary' => 'required|numeric|min:0',
                    'perHour' => 'nullable|boolean',
                    'minimumWageEarner' => 'nullable|boolean',
                    'confidential' => 'nullable|boolean',
                    'paymentMode' => 'required|in:ATM,CASH,CHEQUE',
                    'atmAccount' => 'nullable|string|max:32|required_if:paymentMode,ATM',

                    'emailAddress' => 'nullable|email|max:150',
                    'mobile' => 'nullable|string|max:32',
                    'address' => 'nullable|string|max:500',
                    'emergencyContactName' => 'nullable|string|max:150',
                    'emergencyContactRelationship' => 'nullable|string|max:60',
                    'emergencyContactPhone' => 'nullable|string|max:40',
                ],
                'fields' => [
                    'employeeNo' => 'employee_no',
                    'firstName' => 'first_name', 'middleName' => 'middle_name',
                    'lastName' => 'last_name', 'suffix' => 'suffix',
                    'birthDate' => 'birth_date', 'civilStatus' => 'civil_status', 'sex' => 'sex',

                    'businessGroupId' => 'business_group_id', 'departmentId' => 'hr_department_id',
                    'branchUnitId' => 'branch_unit_id', 'positionId' => 'position_id',
                    'payrollGroupId' => 'payroll_group_id', 'reportsToId' => 'reports_to_id',
                    'shiftId' => 'shift_id', 'legalEntityId' => 'legal_entity_id',

                    'level' => 'level', 'costCenter' => 'cost_center',
                    'employmentStatus' => 'employment_status',
                    'dateHired' => 'date_hired', 'dateSeparated' => 'date_separated',

                    'tin' => 'tin', 'sss' => 'sss_no', 'phic' => 'philhealth_no', 'pagibig' => 'pagibig_no',
                    'taxExempted' => 'tax_exempted', 'sssExempted' => 'sss_exempted',
                    'phicExempted' => 'philhealth_exempted', 'pagibigExempted' => 'pagibig_exempted',

                    'salary' => 'salary', 'perHour' => 'per_hour',
                    'minimumWageEarner' => 'minimum_wage_earner', 'confidential' => 'confidential',
                    'paymentMode' => 'payment_mode', 'atmAccount' => 'atm_account',

                    'emailAddress' => 'email', 'mobile' => 'mobile', 'address' => 'address',
                    'emergencyContactName' => 'emergency_contact_name',
                    'emergencyContactRelationship' => 'emergency_contact_relationship',
                    'emergencyContactPhone' => 'emergency_contact_phone',
                ],
            ],
        ],

        /* Lookups the employee form needs. Read-only: these are the operating
           structure, maintained under Company & Branches. */
        'hr/business-groups' => [
            'model' => Models\BusinessGroup::class,
            'sort' => ['code' => 'asc'],
            'map' => ['id' => 'id', 'code' => 'code', 'name' => 'name'],
            'counts' => ['employees' => 'headcount'],
        ],

        'hr/branch-units' => [
            'model' => Models\BranchUnit::class,
            'sort' => ['code' => 'asc'],
            'map' => ['id' => 'id', 'code' => 'code', 'name' => 'name'],
            'counts' => ['employees' => 'headcount'],
        ],

        /* Who gets paid together, and how often.

           This was read-only, which meant the only payroll groups that could
           ever exist were the ones the seeder happened to create. A business
           that opens a second branch or moves its drivers onto a weekly cycle
           had nowhere to say so. Deleting one is guarded — a group with people
           in it is load-bearing. */
        'hr/payroll-groups' => [
            'model' => Models\PayrollGroup::class,
            'sort' => ['code' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'frequency' => 'frequency',
                'statutorySchedule' => 'statutory_schedule',
                'isConfidential' => 'is_confidential', 'isActive' => 'is_active',
            ],
            'counts' => ['employees' => 'headcount'],
            'write' => [
                'label' => 'name',
                'defaults' => [
                    'frequency' => 'S', 'statutory_schedule' => 'second',
                    'is_confidential' => false, 'is_active' => true,
                ],
                'rules' => [
                    'code' => 'required|string|max:64|unique:payroll_groups,code',
                    'name' => 'required|string|max:120',
                    // The stored codes, not the words. The screen shows the
                    // words; writing "Semi-monthly" into an enum of S/M/W/MM
                    // is rejected by the database, not by the form.
                    'frequency' => 'required|in:S,M,W,MM',
                    'statutorySchedule' => 'required|in:first,second,split',
                    'isConfidential' => 'nullable|boolean',
                    'isActive' => 'nullable|boolean',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'frequency' => 'frequency',
                    'statutorySchedule' => 'statutory_schedule',
                    'isConfidential' => 'is_confidential', 'isActive' => 'is_active',
                ],
            ],
        ],

        /* Department picker, used wherever a document is charged to one. */
        'hr/departments' => [
            'model' => Models\HrDepartment::class,
            'sort' => ['name' => 'asc'],
            'map' => ['id' => 'id', 'code' => 'code', 'name' => 'name'],
            'counts' => ['employees' => 'headcount'],
            'write' => [
                'label' => 'name',
                'rules' => [
                    'code' => 'required|string|max:32|unique:hr_departments,code',
                    'name' => 'required|string|max:120',
                ],
                'fields' => ['code' => 'code', 'name' => 'name'],
            ],
        ],

        'hr/positions' => [
            'model' => Models\Position::class,
            'sort' => ['title' => 'asc'],
            'map' => ['id' => 'id', 'title' => 'title', 'level' => 'level'],
            'counts' => ['employees' => 'filled'],
            'write' => [
                'label' => 'title',
                'defaults' => ['level' => 1],
                'rules' => [
                    'title' => 'required|string|max:120|unique:positions,title',
                    'level' => 'nullable|integer|min:1|max:10',
                ],
                'fields' => ['title' => 'title', 'level' => 'level'],
            ],
        ],

        'hr/attendance' => [
            'model' => Models\AttendanceRecord::class,
            'with' => ['employee.hrDepartment', 'shift'],
            'sort' => ['work_date' => 'desc'],
            'map' => [
                'id' => 'id', 'date' => 'work_date', 'employee' => 'employee.full_name',
                'employeeCode' => 'employee.employee_no', 'employeeId' => 'employee_id',
                'department' => 'employee.hrDepartment.code',
                'shift' => 'shift.name', 'shiftId' => 'shift_id',
                'timeIn' => 'time_in', 'timeOut' => 'time_out',
                'clockIn' => 'clock_in_at', 'breakOut' => 'break_out_at',
                'breakIn' => 'break_in_at', 'clockOut' => 'clock_out_at',
                'otClockIn' => 'ot_clock_in_at', 'otClockOut' => 'ot_clock_out_at',
                'hoursWorked' => 'hours_worked', 'overtime' => 'overtime_hours',
                'breakMinutes' => 'break_minutes',
                'lateMinutes' => 'late_minutes', 'undertimeMinutes' => 'undertime_minutes',
                'source' => 'source', 'remarks' => 'remarks', 'status' => 'status',
            ],
            'write' => [
                'defaults' => ['status' => 'Present', 'source' => 'Manual'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'date' => 'required|date',
                    'shiftId' => 'nullable|integer|exists:shifts,id',
                    // Hours, lateness, undertime and overtime are all worked
                    // out from these by the model — none of them is an input.
                    'clockIn' => 'nullable|date',
                    'breakOut' => 'nullable|date',
                    'breakIn' => 'nullable|date',
                    'clockOut' => 'nullable|date',
                    'status' => 'required|in:Present,Late,Absent,On Leave,Rest Day,Holiday',
                    'remarks' => 'nullable|string|max:190',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'date' => 'work_date', 'shiftId' => 'shift_id',
                    'clockIn' => 'clock_in_at', 'breakOut' => 'break_out_at',
                    'breakIn' => 'break_in_at', 'clockOut' => 'clock_out_at',
                    'status' => 'status', 'remarks' => 'remarks',
                ],
            ],
        ],

        'hr/leaves' => [
            'model' => Models\LeaveRequest::class,
            'with' => ['employee.hrDepartment', 'leaveType', 'approver'],
            'sort' => ['filed_on' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'request_no', 'employee' => 'employee.full_name',
                'employeeId' => 'employee_id', 'employeeNo' => 'employee.employee_no',
                'department' => 'employee.hrDepartment.code', 'type' => 'leaveType.name',
                'leaveTypeId' => 'leave_type_id',
                'from' => 'start_date', 'to' => 'end_date', 'days' => 'days',
                'balanceBefore' => 'balance_before', 'balanceAfter' => 'balance_after',
                'reason' => 'reason', 'approver' => 'approver.full_name',
                'filed' => 'filed_on', 'status' => 'status',
            ],
            'write' => [
                'label' => 'request_no',
                'number' => ['column' => 'request_no', 'prefix' => 'LV-', 'digits' => 4],
                'defaults' => ['status' => 'For Approval'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'leaveTypeId' => 'required|integer|exists:leave_types,id',
                    'startDate' => 'required|date',
                    'endDate' => 'required|date|after_or_equal:startDate',
                    'days' => 'required|numeric|min:0.5|max:365',
                    'reason' => 'nullable|string|max:255',
                    'filedOn' => 'required|date',
                    // Approved and Rejected are reached by deciding the request,
                    // which is what moves the balance.
                    'status' => 'required|in:Draft,For Approval',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'leaveTypeId' => 'leave_type_id',
                    'startDate' => 'start_date', 'endDate' => 'end_date', 'days' => 'days',
                    'reason' => 'reason', 'filedOn' => 'filed_on', 'status' => 'status',
                ],
            ],
        ],

        /* The cut-off calendar. Every run and every DTR is scoped to one. */
        'hr/payroll-periods' => [
            'model' => Models\PayrollPeriod::class,
            'sort' => ['period_end' => 'desc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'label' => 'label', 'year' => 'year',
                'month' => 'month', 'half' => 'half', 'periodStart' => 'period_start',
                'periodEnd' => 'period_end', 'payDate' => 'pay_date', 'status' => 'status',
            ],
            'counts' => ['runs' => 'runs'],
            'write' => [
                'label' => 'code',
                'defaults' => ['status' => 'Open'],
                /* Three of these rules used to disagree with the table, which
                   is the worst kind of validation: the form accepts the value
                   and the database throws a 500 two layers down.

                     - `code` is unique and 16 characters, not a free 32.
                     - `label` and `payDate` are NOT NULL; letting them through
                       empty produced an integrity error, not a field error.
                     - the status enum has no "Locked" in it. Saving one was
                       always going to fail. */
                'rules' => [
                    'code' => 'required|string|max:16|unique:payroll_periods,code',
                    'label' => 'required|string|max:64',
                    'year' => 'required|integer|between:2000,2100',
                    'month' => 'required|integer|between:1,12',
                    'half' => 'required|integer|between:1,2',
                    'periodStart' => 'required|date',
                    'periodEnd' => 'required|date|after_or_equal:periodStart',
                    'payDate' => 'required|date|after_or_equal:periodEnd',
                    'status' => 'required|in:Open,Processing,For Approval,Approved,Released,Closed',
                ],
                'fields' => [
                    'code' => 'code', 'label' => 'label', 'year' => 'year', 'month' => 'month',
                    'half' => 'half', 'periodStart' => 'period_start', 'periodEnd' => 'period_end',
                    'payDate' => 'pay_date', 'status' => 'status',
                ],
            ],
        ],

        /* One computation of one group over one cut-off. Its totals are
           derived from the payslips by the engine, never typed. */
        'hr/payroll-runs' => [
            'model' => Models\PayrollRun::class,
            'with' => ['payrollPeriod', 'payrollGroup'],
            'sort' => ['id' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'run_no',
                'period' => 'payrollPeriod.code', 'periodId' => 'payroll_period_id',
                'group' => 'payrollGroup.name', 'groupId' => 'payroll_group_id',
                'headcount' => 'headcount', 'grossPay' => 'gross_pay',
                'statutoryEmployee' => 'statutory_employee', 'statutoryEmployer' => 'statutory_employer',
                'withholdingTax' => 'withholding_tax', 'totalDeductions' => 'total_deductions',
                'netPay' => 'net_pay', 'employerCost' => 'employer_cost',
                'status' => 'status', 'approvedAt' => 'approved_at', 'releasedAt' => 'released_at',
            ],
            'counts' => ['payslips' => 'payslips'],
            'write' => [
                'label' => 'run_no',
                'number' => ['column' => 'run_no', 'prefix' => 'PR-', 'digits' => 4],
                'defaults' => [
                    'status' => 'Draft', 'headcount' => 0, 'gross_pay' => 0,
                    'statutory_employee' => 0, 'statutory_employer' => 0, 'withholding_tax' => 0,
                    'other_deductions' => 0, 'total_deductions' => 0, 'net_pay' => 0, 'employer_cost' => 0,
                ],
                'rules' => [
                    'periodId' => 'required|integer|exists:payroll_periods,id',
                    'groupId' => 'required|integer|exists:payroll_groups,id',
                ],
                'fields' => ['periodId' => 'payroll_period_id', 'groupId' => 'payroll_group_id'],
            ],
        ],

        /* Deductions that are not statutory: loans, advances, and the rest.
           The balance is never stored — it is the principal less the payslip
           lines that have actually collected against it, so recomputing a
           payroll run hands the balance back rather than double-collecting. */
        'hr/deduction-types' => [
            'model' => Models\DeductionType::class,
            'sort' => ['priority' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name',
                'isLoan' => 'is_loan', 'priority' => 'priority',
                'isActive' => 'is_active', 'notes' => 'notes',
            ],
            'counts' => ['employeeDeductions' => 'arrangements'],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true, 'priority' => 100, 'is_loan' => false],
                'rules' => [
                    'code' => 'required|string|max:32',
                    'name' => 'required|string|max:120',
                    'isLoan' => 'boolean',
                    'priority' => 'required|integer|min:1|max:999',
                    'isActive' => 'boolean',
                    'notes' => 'nullable|string|max:255',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'isLoan' => 'is_loan',
                    'priority' => 'priority', 'isActive' => 'is_active', 'notes' => 'notes',
                ],
            ],
        ],

        'hr/deductions' => [
            'model' => Models\EmployeeDeduction::class,
            'with' => ['employee', 'deductionType'],
            'sort' => ['id' => 'desc'],
            'sums' => ['lines' => ['amount' => 'collectedRaw']],
            'map' => [
                'id' => 'id',
                'employee' => 'employee.full_name', 'employeeId' => 'employee_id',
                'employeeNo' => 'employee.employee_no',
                'type' => 'deductionType.name', 'typeId' => 'deduction_type_id',
                'typeCode' => 'deductionType.code', 'isLoan' => 'deductionType.is_loan',
                'reference' => 'reference',
                'principal' => 'principal', 'amountPerCutoff' => 'amount_per_cutoff',
                'startsOn' => 'starts_on', 'endsOn' => 'ends_on',
                'status' => 'status', 'notes' => 'notes',
            ],
            'computed' => [
                'collected' => 'App\Http\Controllers\Api\Computed::deductionCollected',
                'outstanding' => 'App\Http\Controllers\Api\Computed::deductionOutstanding',
                'cutoffsLeft' => 'App\Http\Controllers\Api\Computed::deductionCutoffsLeft',
            ],
            'write' => [
                'label' => 'reference',
                'defaults' => ['status' => 'Active'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'typeId' => 'required|integer|exists:deduction_types,id',
                    'reference' => 'nullable|string|max:64',
                    'principal' => 'nullable|numeric|min:0',
                    'amountPerCutoff' => 'required|numeric|min:0.01',
                    'startsOn' => 'required|date',
                    'endsOn' => 'nullable|date|after_or_equal:startsOn',
                    'status' => 'required|in:Active,Suspended,Cancelled',
                    'notes' => 'nullable|string|max:255',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'typeId' => 'deduction_type_id',
                    'reference' => 'reference', 'principal' => 'principal',
                    'amountPerCutoff' => 'amount_per_cutoff',
                    'startsOn' => 'starts_on', 'endsOn' => 'ends_on',
                    'status' => 'status', 'notes' => 'notes',
                ],
            ],
        ],

        'hr/salary-bands' => [
            'model' => Models\SalaryBand::class,
            'with' => ['position'],
            'sort' => ['id' => 'asc'],
            'map' => [
                'id' => 'id', 'positionId' => 'position_id', 'position' => 'position.title',
                'minMonthly' => 'min_monthly', 'midMonthly' => 'mid_monthly', 'maxMonthly' => 'max_monthly',
                'currency' => 'currency', 'notes' => 'notes',
            ],
            'write' => [
                'label' => 'position.title',
                'defaults' => ['currency' => 'PHP'],
                'rules' => [
                    'positionId' => 'required|integer|exists:positions,id|unique:salary_bands,position_id',
                    'minMonthly' => 'required|numeric|min:0',
                    'midMonthly' => 'required|numeric|gte:minMonthly',
                    'maxMonthly' => 'required|numeric|gte:midMonthly',
                    'currency' => 'nullable|string|size:3',
                    'notes' => 'nullable|string|max:255',
                ],
                'fields' => [
                    'positionId' => 'position_id', 'minMonthly' => 'min_monthly',
                    'midMonthly' => 'mid_monthly', 'maxMonthly' => 'max_monthly',
                    'currency' => 'currency', 'notes' => 'notes',
                ],
            ],
        ],

        'hr/benefit-plans' => [
            'model' => Models\BenefitPlan::class,
            'sort' => ['name' => 'asc'],
            'counts' => ['enrollments' => 'enrolled'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'type' => 'type',
                'provider' => 'provider', 'description' => 'description',
                'employerCost' => 'employer_cost', 'employeeCost' => 'employee_cost', 'active' => 'active',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['active' => true, 'employer_cost' => 0, 'employee_cost' => 0],
                'rules' => [
                    'code' => 'required|string|max:32|unique:benefit_plans,code',
                    'name' => 'required|string|max:150',
                    'type' => 'required|in:HMO,Life Insurance,Retirement,Allowance,Other',
                    'provider' => 'nullable|string|max:150',
                    'description' => 'nullable|string|max:255',
                    'employerCost' => 'nullable|numeric|min:0',
                    'employeeCost' => 'nullable|numeric|min:0',
                    'active' => 'sometimes|boolean',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'type' => 'type', 'provider' => 'provider',
                    'description' => 'description', 'employerCost' => 'employer_cost',
                    'employeeCost' => 'employee_cost', 'active' => 'active',
                ],
            ],
        ],

        'hr/employee-benefits' => [
            'model' => Models\EmployeeBenefit::class,
            'with' => ['employee.hrDepartment', 'benefitPlan'],
            'sort' => ['id' => 'desc'],
            'map' => [
                'id' => 'id', 'employeeId' => 'employee_id', 'employee' => 'employee.full_name',
                'employeeNo' => 'employee.employee_no', 'department' => 'employee.hrDepartment.name',
                'benefitPlanId' => 'benefit_plan_id', 'plan' => 'benefitPlan.name', 'planType' => 'benefitPlan.type',
                'enrolledOn' => 'enrolled_on', 'endedOn' => 'ended_on', 'dependents' => 'dependents',
                'status' => 'status', 'notes' => 'notes',
            ],
            'write' => [
                'label' => 'employee.full_name',
                'defaults' => ['status' => 'Active', 'dependents' => 0],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'benefitPlanId' => 'required|integer|exists:benefit_plans,id',
                    'enrolledOn' => 'required|date',
                    'endedOn' => 'nullable|date|after_or_equal:enrolledOn',
                    'dependents' => 'nullable|integer|min:0|max:20',
                    'status' => 'required|in:Active,Ended',
                    'notes' => 'nullable|string|max:255',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'benefitPlanId' => 'benefit_plan_id',
                    'enrolledOn' => 'enrolled_on', 'endedOn' => 'ended_on',
                    'dependents' => 'dependents', 'status' => 'status', 'notes' => 'notes',
                ],
            ],
        ],

        'hr/competencies' => [
            'model' => Models\Competency::class,
            'sort' => ['name' => 'asc'],
            'counts' => ['ratings' => 'rated'],
            'map' => [
                'id' => 'id', 'name' => 'name', 'category' => 'category', 'description' => 'description',
            ],
            'write' => [
                'label' => 'name',
                'rules' => [
                    'name' => 'required|string|max:150|unique:competencies,name',
                    'category' => 'nullable|string|max:80',
                    'description' => 'nullable|string|max:255',
                ],
                'fields' => ['name' => 'name', 'category' => 'category', 'description' => 'description'],
            ],
        ],

        'hr/employee-competencies' => [
            'model' => Models\EmployeeCompetency::class,
            'with' => ['employee.hrDepartment', 'competency', 'assessedBy'],
            'sort' => ['id' => 'desc'],
            'map' => [
                'id' => 'id', 'employeeId' => 'employee_id', 'employee' => 'employee.full_name',
                'employeeNo' => 'employee.employee_no', 'department' => 'employee.hrDepartment.name',
                'competencyId' => 'competency_id', 'competency' => 'competency.name',
                'category' => 'competency.category', 'level' => 'level',
                'assessedOn' => 'assessed_on', 'assessedBy' => 'assessedBy.full_name', 'notes' => 'notes',
            ],
            'write' => [
                'label' => 'employee.full_name',
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'competencyId' => 'required|integer|exists:competencies,id',
                    'level' => 'required|integer|between:1,5',
                    'assessedOn' => 'required|date',
                    'assessedById' => 'nullable|integer|exists:employees,id',
                    'notes' => 'nullable|string|max:255',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'competencyId' => 'competency_id', 'level' => 'level',
                    'assessedOn' => 'assessed_on', 'assessedById' => 'assessed_by_id', 'notes' => 'notes',
                ],
            ],
        ],

        'hr/succession-plans' => [
            'model' => Models\SuccessionPlan::class,
            'with' => ['employee.hrDepartment', 'employee.position', 'targetPosition'],
            'sort' => ['id' => 'desc'],
            'map' => [
                'id' => 'id', 'employeeId' => 'employee_id', 'employee' => 'employee.full_name',
                'employeeNo' => 'employee.employee_no', 'department' => 'employee.hrDepartment.name',
                'currentTitle' => 'employee.position.title',
                'targetPositionId' => 'target_position_id', 'targetPosition' => 'targetPosition.title',
                'performanceRating' => 'performance_rating', 'potentialRating' => 'potential_rating',
                'readiness' => 'readiness', 'notes' => 'notes', 'assessedOn' => 'assessed_on',
            ],
            'write' => [
                'label' => 'employee.full_name',
                'defaults' => ['readiness' => '3-5 Years'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id|unique:succession_plans,employee_id',
                    'targetPositionId' => 'nullable|integer|exists:positions,id',
                    'performanceRating' => 'required|integer|between:1,5',
                    'potentialRating' => 'required|integer|between:1,5',
                    'readiness' => 'required|in:Ready Now,1-2 Years,3-5 Years,Not Ready',
                    'notes' => 'nullable|string|max:255',
                    'assessedOn' => 'required|date',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'targetPositionId' => 'target_position_id',
                    'performanceRating' => 'performance_rating', 'potentialRating' => 'potential_rating',
                    'readiness' => 'readiness', 'notes' => 'notes', 'assessedOn' => 'assessed_on',
                ],
            ],
        ],

        'hr/legal-entities' => [
            'model' => Models\LegalEntity::class,
            'sort' => ['name' => 'asc'],
            'counts' => ['employees' => 'employeeCount'],
            'map' => [
                'id' => 'id', 'name' => 'name', 'legalName' => 'legal_name', 'tin' => 'tin',
                'sssEmployerNo' => 'sss_employer_no', 'philhealthEmployerNo' => 'philhealth_employer_no',
                'pagibigEmployerNo' => 'pagibig_employer_no', 'pagibigBranchCode' => 'pagibig_branch_code',
                'address' => 'address', 'zipCode' => 'zip_code', 'phone' => 'phone', 'active' => 'active',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['active' => true],
                'rules' => [
                    'name' => 'required|string|max:150|unique:legal_entities,name',
                    'legalName' => 'nullable|string|max:190',
                    'tin' => 'nullable|string|max:32',
                    'sssEmployerNo' => 'nullable|string|max:32',
                    'philhealthEmployerNo' => 'nullable|string|max:32',
                    'pagibigEmployerNo' => 'nullable|string|max:32',
                    'pagibigBranchCode' => 'nullable|string|max:64',
                    'address' => 'nullable|string|max:255',
                    'zipCode' => 'nullable|string|max:12',
                    'phone' => 'nullable|string|max:32',
                    'active' => 'sometimes|boolean',
                ],
                'fields' => [
                    'name' => 'name', 'legalName' => 'legal_name', 'tin' => 'tin',
                    'sssEmployerNo' => 'sss_employer_no', 'philhealthEmployerNo' => 'philhealth_employer_no',
                    'pagibigEmployerNo' => 'pagibig_employer_no', 'pagibigBranchCode' => 'pagibig_branch_code',
                    'address' => 'address', 'zipCode' => 'zip_code', 'phone' => 'phone', 'active' => 'active',
                ],
            ],
        ],

        'hr/payroll-disputes' => [
            'model' => Models\PayrollDispute::class,
            'with' => ['employee.hrDepartment', 'payrollPeriod', 'resolvedBy'],
            'sort' => ['raised_on' => 'desc'],
            'map' => [
                'id' => 'id', 'employeeId' => 'employee_id', 'employee' => 'employee.full_name',
                'employeeNo' => 'employee.employee_no', 'department' => 'employee.hrDepartment.name',
                'payrollPeriodId' => 'payroll_period_id', 'period' => 'payrollPeriod.label',
                'complaint' => 'complaint', 'hrFeedback' => 'hr_feedback', 'liable' => 'liable',
                'actionPlan' => 'action_plan', 'deductAmount' => 'deduct_amount', 'retroAmount' => 'retro_amount',
                'status' => 'status', 'raisedOn' => 'raised_on', 'resolvedOn' => 'resolved_on',
                'resolvedBy' => 'resolvedBy.name',
            ],
            'write' => [
                'label' => 'employee.full_name',
                'defaults' => ['status' => 'Open'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'payrollPeriodId' => 'nullable|integer|exists:payroll_periods,id',
                    'complaint' => 'required|string|max:2000',
                    'hrFeedback' => 'nullable|string|max:2000',
                    'liable' => 'nullable|string|max:120',
                    'actionPlan' => 'nullable|string|max:2000',
                    'deductAmount' => 'nullable|numeric|min:0',
                    'retroAmount' => 'nullable|numeric|min:0',
                    'status' => 'required|in:Open,Under Review,Resolved,Applied to Payroll',
                    'raisedOn' => 'required|date',
                    'resolvedOn' => 'nullable|date|after_or_equal:raisedOn',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'payrollPeriodId' => 'payroll_period_id',
                    'complaint' => 'complaint', 'hrFeedback' => 'hr_feedback', 'liable' => 'liable',
                    'actionPlan' => 'action_plan', 'deductAmount' => 'deduct_amount', 'retroAmount' => 'retro_amount',
                    'status' => 'status', 'raisedOn' => 'raised_on', 'resolvedOn' => 'resolved_on',
                ],
            ],
        ],

        'hr/payslips' => [
            'model' => Models\Payslip::class,
            'with' => ['employee.branchUnit', 'employee.position', 'employee.payrollGroup',
                'payrollRun.payrollPeriod', 'lines'],
            'sort' => ['id' => 'asc'],
            'map' => [
                'id' => 'id', 'periodId' => 'payrollRun.payroll_period_id', 'employeeId' => 'employee_id',
                'employeeNo' => 'employee.employee_no', 'employee' => 'employee.full_name',
                'payrollGroup' => 'employee.payrollGroup.code', 'branchUnit' => 'employee.branchUnit.code',
                'positionTitle' => 'employee.position.title', 'atmAccount' => 'atm_account',
                'period' => 'payrollRun.payrollPeriod.code', 'periodLabel' => 'payrollRun.payrollPeriod.label',
                'runId' => 'payroll_run_id', 'runNo' => 'payrollRun.run_no', 'status' => 'payrollRun.status',
                'hourlyRate' => 'hourly_rate', 'dailyRate' => 'daily_rate',
                'monthlyEquivalent' => 'monthly_equivalent',
                'basicPay' => 'basic_pay', 'overtimePay' => 'overtime_pay',
                'nightDiffPay' => 'night_diff_pay', 'restDayPay' => 'rest_day_pay',
                'holidayPay' => 'holiday_pay', 'leavePay' => 'leave_pay',
                'taxableAllowances' => 'taxable_allowances', 'nonTaxableAllowances' => 'non_taxable_allowances',
                'lateDeduction' => 'late_deduction', 'undertimeDeduction' => 'undertime_deduction',
                'absenceDeduction' => 'absence_deduction',
                'sssSalaryCredit' => 'sss_salary_credit',
                'sssEmployee' => 'sss_employee', 'sssEmployer' => 'sss_employer',
                'philhealthEmployee' => 'philhealth_employee', 'philhealthEmployer' => 'philhealth_employer',
                'pagibigEmployee' => 'pagibig_employee', 'pagibigEmployer' => 'pagibig_employer',
                'taxableIncome' => 'taxable_income', 'withholdingTax' => 'withholding_tax',
                'otherDeductions' => 'other_deductions',
                'thirteenthMonthAccrual' => 'thirteenth_month_accrual',
                'employerCost' => 'employer_cost',
                'grossPay' => 'gross_pay', 'totalDeductions' => 'total_deductions', 'netPay' => 'net_pay',
                'holdAmount' => 'hold_amount', 'retroAdjustment' => 'retro_adjustment',
            ],
            'computed' => [
                // The itemised non-statutory deductions, so a payslip says
                // which loan it paid down rather than only how much came off.
                'deductionLines' => 'App\Http\Controllers\Api\Computed::payslipDeductionLines',
                // And the one-off earnings, for the same reason on the other
                // side of the payslip.
                'earningLines' => 'App\Http\Controllers\Api\Computed::payslipEarningLines',
            ],
        ],

        /* The manpower request a vacancy starts from. Nothing should be
           sourced for a role nobody approved. */
        'hr/requisitions' => [
            'model' => Models\JobRequisition::class,
            'with' => ['position', 'hrDepartment', 'branchUnit', 'requester'],
            'sort' => ['needed_by' => 'asc'],
            'map' => [
                'id' => 'id', 'no' => 'requisition_no', 'position' => 'position.title',
                'positionId' => 'position_id', 'department' => 'hrDepartment.name',
                'departmentId' => 'hr_department_id', 'branch' => 'branchUnit.name',
                'branchId' => 'branch_unit_id', 'headcount' => 'headcount', 'filled' => 'filled',
                'neededBy' => 'needed_by', 'budgetRate' => 'budget_rate',
                'requestedBy' => 'requester.full_name', 'requestedById' => 'requested_by',
                'status' => 'status',
            ],
            'counts' => ['applicants' => 'applicants'],
            'computed' => [
                'openings' => 'App\\Http\\Controllers\\Api\\Computed::requisitionOpenings',
            ],
            'write' => [
                'label' => 'requisition_no',
                'number' => ['column' => 'requisition_no', 'prefix' => 'MRF-', 'digits' => 4],
                'defaults' => ['status' => 'Draft', 'filled' => 0],
                'rules' => [
                    'positionId' => 'required|integer|exists:positions,id',
                    'departmentId' => 'required|integer|exists:hr_departments,id',
                    'branchId' => 'nullable|integer|exists:branch_units,id',
                    'headcount' => 'required|integer|min:1|max:200',
                    'neededBy' => 'nullable|date',
                    'budgetRate' => 'nullable|numeric|min:0',
                    'requestedById' => 'nullable|integer|exists:employees,id',
                    'status' => 'required|in:Draft,For Approval,Approved,Sourcing,Filled,Cancelled',
                ],
                'fields' => [
                    'positionId' => 'position_id', 'departmentId' => 'hr_department_id',
                    'branchId' => 'branch_unit_id', 'headcount' => 'headcount',
                    'neededBy' => 'needed_by', 'budgetRate' => 'budget_rate',
                    'requestedById' => 'requested_by', 'status' => 'status',
                ],
            ],
        ],

        'hr/applicants' => [
            'model' => Models\Applicant::class,
            'with' => ['position', 'jobRequisition.hrDepartment', 'jobPosting', 'recruiter'],
            'sort' => ['applied_on' => 'desc'],
            'map' => [
                'id' => 'id', 'code' => 'applicant_no', 'name' => 'full_name',
                'email' => 'email', 'phone' => 'phone',
                'position' => 'position.title', 'positionId' => 'position_id',
                'requisition' => 'jobRequisition.requisition_no',
                'requisitionId' => 'job_requisition_id',
                'department' => 'jobRequisition.hrDepartment.code',
                'source' => 'source', 'applied' => 'applied_on', 'stage' => 'stage',
                'rating' => 'rating', 'expectedSalary' => 'expected_salary',
                'recruiter' => 'recruiter.full_name', 'recruiterId' => 'recruiter_id',
                /* What the board and the applicant list need to triage a
                   hundred applications without opening each one: where they
                   came from, whether there is a CV, and how well it reads
                   against the advert. */
                'reference' => 'reference_code', 'appliedVia' => 'applied_via',
                'posting' => 'jobPosting.title', 'postingId' => 'job_posting_id',
                'city' => 'city', 'province' => 'province',
                'currentTitle' => 'current_title', 'currentEmployer' => 'current_employer',
                'yearsExperience' => 'years_experience', 'educationLevel' => 'education_level',
                'course' => 'course', 'school' => 'school',
                'hasResume' => 'resume_path', 'resumeStatus' => 'resume_status',
                'matchScore' => 'match_score',
            ],
            'write' => [
                'label' => 'full_name',
                'number' => ['column' => 'applicant_no', 'prefix' => 'APP-', 'digits' => 4],
                'defaults' => ['stage' => 'Applied'],
                'rules' => [
                    'name' => 'required|string|max:190',
                    'email' => 'nullable|email|max:150',
                    'phone' => 'nullable|string|max:40',
                    'positionId' => 'required|integer|exists:positions,id',
                    'requisitionId' => 'nullable|integer|exists:job_requisitions,id',
                    'source' => 'required|in:Referral,Job Board,Walk-in,Agency,Social Media,University',
                    'applied' => 'required|date',
                    // The stage is moved through the pipeline endpoint, not
                    // typed here — that is what keeps the transitions honest.
                    'rating' => 'nullable|numeric|between:0,5',
                    'expectedSalary' => 'nullable|numeric|min:0',
                    'recruiterId' => 'nullable|integer|exists:employees,id',
                ],
                'fields' => [
                    'name' => 'full_name', 'email' => 'email', 'phone' => 'phone',
                    'positionId' => 'position_id', 'requisitionId' => 'job_requisition_id',
                    'source' => 'source', 'applied' => 'applied_on', 'rating' => 'rating',
                    'expectedSalary' => 'expected_salary', 'recruiterId' => 'recruiter_id',
                ],
            ],
        ],

        /* The advert. The outward-facing half of a manpower request — written
           for a candidate rather than an approver, and openable on its own URL
           by anybody, which is why publishing is an action rather than a
           status typed into this form. */
        'hr/job-postings' => [
            'model' => Models\JobPosting::class,
            'with' => ['position', 'hrDepartment', 'branchUnit', 'jobRequisition'],
            'sort' => ['created_at' => 'desc'],
            'counts' => ['applicants' => 'applicants'],
            'map' => [
                'id' => 'id', 'slug' => 'slug', 'title' => 'title',
                'position' => 'position.title', 'positionId' => 'position_id',
                'department' => 'hrDepartment.name', 'departmentId' => 'hr_department_id',
                'branch' => 'branchUnit.name', 'branchId' => 'branch_unit_id',
                'requisition' => 'jobRequisition.requisition_no', 'requisitionId' => 'job_requisition_id',
                'location' => 'location', 'employmentType' => 'employment_type',
                'workSetup' => 'work_setup', 'experienceLevel' => 'experience_level',
                'summary' => 'summary', 'responsibilities' => 'responsibilities',
                'qualifications' => 'qualifications', 'benefits' => 'benefits',
                'salaryMin' => 'salary_min', 'salaryMax' => 'salary_max',
                'salaryVisible' => 'salary_visible', 'openings' => 'openings',
                'status' => 'status', 'publishedAt' => 'published_at',
                'closesOn' => 'closes_on', 'views' => 'views',
            ],
            'write' => [
                'label' => 'title',
                'defaults' => ['status' => 'Draft'],
                'rules' => [
                    'title' => 'required|string|max:150',
                    'positionId' => 'nullable|integer|exists:positions,id',
                    'departmentId' => 'nullable|integer|exists:hr_departments,id',
                    'branchId' => 'nullable|integer|exists:branch_units,id',
                    'requisitionId' => 'nullable|integer|exists:job_requisitions,id',
                    'location' => 'nullable|string|max:150',
                    'employmentType' => 'required|in:Full-time,Part-time,Contract,Project-based,Internship',
                    'workSetup' => 'required|in:On-site,Hybrid,Remote',
                    'experienceLevel' => 'required|in:Entry level,Associate,Mid-Senior,Manager,Director',
                    'summary' => 'nullable|string|max:4000',
                    'responsibilities' => 'nullable|string|max:6000',
                    'qualifications' => 'nullable|string|max:6000',
                    'benefits' => 'nullable|string|max:4000',
                    'salaryMin' => 'nullable|numeric|min:0',
                    'salaryMax' => 'nullable|numeric|min:0',
                    'salaryVisible' => 'nullable|boolean',
                    'openings' => 'required|integer|min:1|max:500',
                    'closesOn' => 'nullable|date',
                    // Not writable: the status moves through the publish and
                    // close endpoints, which stamp the date and tell the
                    // requisition it is being sourced against.
                ],
                'fields' => [
                    'title' => 'title', 'positionId' => 'position_id',
                    'departmentId' => 'hr_department_id', 'branchId' => 'branch_unit_id',
                    'requisitionId' => 'job_requisition_id', 'location' => 'location',
                    'employmentType' => 'employment_type', 'workSetup' => 'work_setup',
                    'experienceLevel' => 'experience_level', 'summary' => 'summary',
                    'responsibilities' => 'responsibilities', 'qualifications' => 'qualifications',
                    'benefits' => 'benefits', 'salaryMin' => 'salary_min',
                    'salaryMax' => 'salary_max', 'salaryVisible' => 'salary_visible',
                    'openings' => 'openings', 'closesOn' => 'closes_on',
                ],
            ],
        ],

        'hr/reviews' => [
            'model' => Models\PerformanceReview::class,
            'with' => ['employee.hrDepartment', 'employee.position', 'reviewer'],
            'sort' => ['due_date' => 'asc'],
            'map' => [
                'id' => 'id', 'employee' => 'employee.full_name',
                'department' => 'employee.hrDepartment.code', 'position' => 'employee.position.title',
                'employeeId' => 'employee_id',
                'period' => 'period', 'reviewer' => 'reviewer.full_name',
                'reviewerId' => 'reviewer_id', 'score' => 'score',
                'rating' => 'rating', 'dueDate' => 'due_date', 'status' => 'status',
                'strengths' => 'strengths', 'developmentAreas' => 'development_areas',
            ],
            'write' => [
                'label' => 'period',
                'defaults' => ['status' => 'Not Started'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    'period' => 'required|string|max:40',
                    'reviewerId' => 'nullable|integer|exists:employees,id',
                    'dueDate' => 'nullable|date',
                    // The score is the input; the rating band is derived from
                    // it when the review is completed, never typed alongside.
                    'score' => 'nullable|numeric|between:0,5',
                    'strengths' => 'nullable|string|max:2000',
                    'developmentAreas' => 'nullable|string|max:2000',
                    'status' => 'required|in:Not Started,Self-Assessment,Manager Review,Calibration,Completed',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'period' => 'period',
                    'reviewerId' => 'reviewer_id', 'dueDate' => 'due_date', 'score' => 'score',
                    'strengths' => 'strengths', 'developmentAreas' => 'development_areas',
                    'status' => 'status',
                ],
            ],
        ],

        /* The catalogue: what can be taught, and how long it stays valid.
           A session is scheduled against one of these. */
        'hr/training-courses' => [
            'model' => Models\TrainingCourse::class,
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'name' => 'name', 'type' => 'type', 'provider' => 'provider',
                'validityMonths' => 'validity_months', 'isMandatory' => 'is_mandatory',
                'isActive' => 'is_active',
            ],
            'counts' => ['sessions' => 'sessions', 'records' => 'certified'],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true, 'is_mandatory' => false],
                'rules' => [
                    'name' => 'required|string|max:190',
                    'type' => 'required|in:Safety,Technical,Compliance,Leadership,Onboarding,Refresher',
                    'provider' => 'nullable|string|max:190',
                    // Blank means the certification never lapses.
                    'validityMonths' => 'nullable|integer|min:1|max:120',
                    'isMandatory' => 'nullable|boolean',
                    'isActive' => 'nullable|boolean',
                ],
                'fields' => [
                    'name' => 'name', 'type' => 'type', 'provider' => 'provider',
                    'validityMonths' => 'validity_months', 'isMandatory' => 'is_mandatory',
                    'isActive' => 'is_active',
                ],
            ],
        ],

        'hr/training' => [
            'model' => Models\TrainingRecord::class,
            'with' => ['employee.hrDepartment', 'trainingCourse'],
            'sort' => ['expires_on' => 'asc'],
            'map' => [
                'id' => 'id', 'course' => 'trainingCourse.name', 'type' => 'trainingCourse.type',
                'employee' => 'employee.full_name', 'department' => 'employee.hrDepartment.code',
                'provider' => 'trainingCourse.provider', 'completedOn' => 'completed_on',
                'expiresOn' => 'expires_on', 'score' => 'score', 'status' => 'status',
            ],
        ],

        'hr/cases' => [
            'model' => Models\EmployeeCase::class,
            'with' => ['employee.hrDepartment', 'handler'],
            'sort' => ['reported_on' => 'desc'],
            'map' => [
                'id' => 'id', 'no' => 'case_no', 'employee' => 'employee.full_name',
                'employeeId' => 'employee_id', 'employeeNo' => 'employee.employee_no',
                'department' => 'employee.hrDepartment.code', 'type' => 'type',
                'reported' => 'reported_on', 'severity' => 'severity', 'action' => 'action',
                'points' => 'points', 'details' => 'details',
                'handler' => 'handler.full_name', 'handledById' => 'handled_by',
                'hearingOn' => 'hearing_on', 'acknowledgedAt' => 'acknowledged_at',
                'automatic' => 'is_automatic', 'status' => 'status',
            ],
            'computed' => [
                'raisedBy' => 'App\\Http\\Controllers\\Api\\Computed::caseOrigin',
                'acknowledged' => 'App\\Http\\Controllers\\Api\\Computed::caseAcknowledged',
            ],
            'write' => [
                'label' => 'case_no',
                'number' => ['column' => 'case_no', 'prefix' => 'ER-', 'digits' => 4],
                'defaults' => ['status' => 'Open', 'severity' => 'Minor', 'action' => 'Under Review'],
                'rules' => [
                    'employeeId' => 'required|integer|exists:employees,id',
                    // Just causes (misconduct) run on the twin-notice rule;
                    // authorised causes run on 30 days' notice to the employee
                    // and to DOLE. DueProcess tells the two apart by type.
                    'type' => 'required|in:Tardiness,Absence Without Leave,Policy Violation,Safety Incident,Performance,Grievance,Redundancy,Retrenchment,Closure,Disease,Constructive Dismissal',
                    'reportedOn' => 'required|date',
                    'details' => 'nullable|string|max:2000',
                    'handledById' => 'nullable|integer|exists:employees,id',
                    'hearingOn' => 'nullable|date',
                    // Severity, action and points come from the running total
                    // the employee has accumulated, not from this form.
                    'status' => 'required|in:Open,Notice Issued,Hearing Scheduled,Resolved,Closed',
                ],
                'fields' => [
                    'employeeId' => 'employee_id', 'type' => 'type', 'reportedOn' => 'reported_on',
                    'details' => 'details', 'handledById' => 'handled_by',
                    'hearingOn' => 'hearing_on', 'status' => 'status',
                ],
            ],
        ],

        /* Shifts, leave types and holidays: the reference data attendance and
           leave are measured against. */
        'hr/shifts' => [
            'model' => Models\Shift::class,
            'sort' => ['starts_at' => 'asc'],
            'map' => [
                'id' => 'id', 'name' => 'name', 'startsAt' => 'starts_at', 'endsAt' => 'ends_at',
                'breakMinutes' => 'break_minutes', 'graceMinutes' => 'grace_minutes',
                'isNightShift' => 'is_night_shift', 'isActive' => 'is_active',
            ],
            'counts' => ['employees' => 'assigned'],
            'computed' => [
                'window' => 'App\\Http\\Controllers\\Api\\Computed::shiftWindow',
                'status' => 'App\\Http\\Controllers\\Api\\Computed::activeStatus',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true, 'break_minutes' => 60, 'grace_minutes' => 15],
                'rules' => [
                    'name' => 'required|string|max:64',
                    'startsAt' => 'required|date_format:H:i',
                    'endsAt' => 'required|date_format:H:i',
                    'breakMinutes' => 'nullable|integer|min:0|max:240',
                    // Arrive inside this and the day is not late. The infraction
                    // monitor measures against the same figure.
                    'graceMinutes' => 'nullable|integer|min:0|max:120',
                    'isNightShift' => 'nullable|boolean',
                    'isActive' => 'nullable|boolean',
                ],
                'fields' => [
                    'name' => 'name', 'startsAt' => 'starts_at', 'endsAt' => 'ends_at',
                    'breakMinutes' => 'break_minutes', 'graceMinutes' => 'grace_minutes',
                    'isNightShift' => 'is_night_shift', 'isActive' => 'is_active',
                ],
            ],
        ],

        'hr/leave-types' => [
            'model' => Models\LeaveType::class,
            'sort' => ['code' => 'asc'],
            'map' => [
                'id' => 'id', 'code' => 'code', 'name' => 'name', 'annualCredits' => 'annual_credits',
                'isPaid' => 'is_paid', 'requiresAttachment' => 'requires_attachment', 'isActive' => 'is_active',
            ],
            'computed' => [
                'status' => 'App\\Http\\Controllers\\Api\\Computed::activeStatus',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true, 'is_paid' => true],
                'rules' => [
                    'code' => 'required|string|max:24|unique:leave_types,code',
                    'name' => 'required|string|max:96',
                    'annualCredits' => 'nullable|integer|min:0|max:365',
                    'isPaid' => 'nullable|boolean',
                    'requiresAttachment' => 'nullable|boolean',
                    'isActive' => 'nullable|boolean',
                ],
                'fields' => [
                    'code' => 'code', 'name' => 'name', 'annualCredits' => 'annual_credits',
                    'isPaid' => 'is_paid', 'requiresAttachment' => 'requires_attachment',
                    'isActive' => 'is_active',
                ],
            ],
        ],

        'hr/holidays' => [
            'model' => Models\Holiday::class,
            'with' => ['branchUnit'],
            'sort' => ['holiday_date' => 'asc'],
            'map' => [
                'id' => 'id', 'holidayDate' => 'holiday_date', 'name' => 'name', 'type' => 'type',
                'branch' => 'branchUnit.code', 'branchUnitId' => 'branch_unit_id',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['type' => 'Regular'],
                'rules' => [
                    'holidayDate' => 'required|date',
                    'name' => 'required|string|max:150',
                    'type' => 'required|in:Regular,Special Non-Working,Local',
                    // Blank means nationwide.
                    'branchUnitId' => 'nullable|integer|exists:branch_units,id',
                ],
                'fields' => [
                    'holidayDate' => 'holiday_date', 'name' => 'name', 'type' => 'type',
                    'branchUnitId' => 'branch_unit_id',
                ],
            ],
        ],

        'hr/announcements' => [
            'model' => Models\Announcement::class,
            'with' => ['hrDepartment', 'createdBy'],
            'sort' => ['published_at' => 'desc'],
            'map' => [
                'id' => 'id', 'title' => 'title', 'body' => 'body',
                'hrDepartmentId' => 'hr_department_id', 'department' => 'hrDepartment.name',
                'pinned' => 'pinned', 'publishedAt' => 'published_at', 'expiresAt' => 'expires_at',
                'createdBy' => 'createdBy.name',
            ],
            'write' => [
                'label' => 'title',
                'defaults' => ['pinned' => false],
                'rules' => [
                    'title' => 'required|string|max:190',
                    'body' => 'required|string|max:5000',
                    'hrDepartmentId' => 'nullable|integer|exists:hr_departments,id',
                    'pinned' => 'sometimes|boolean',
                    'publishedAt' => 'required|date',
                    'expiresAt' => 'nullable|date|after:publishedAt',
                ],
                'fields' => [
                    'title' => 'title', 'body' => 'body', 'hrDepartmentId' => 'hr_department_id',
                    'pinned' => 'pinned', 'publishedAt' => 'published_at', 'expiresAt' => 'expires_at',
                ],
            ],
        ],

        'hr/leave-balances' => [
            'model' => Models\LeaveBalance::class,
            'with' => ['employee', 'leaveType'],
            'sort' => ['id' => 'asc'],
            'map' => [
                'id' => 'id', 'employee' => 'employee.full_name', 'employeeNo' => 'employee.employee_no',
                'type' => 'leaveType.name', 'year' => 'year', 'credits' => 'credits',
                'used' => 'used', 'balance' => 'balance',
            ],
        ],

        /* ======================== ADMINISTRATION ====================== */

        'admin/users' => [
            'model' => User::class,
            'with' => ['roles', 'employee.branchUnit'],
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'name' => 'name', 'username' => 'username', 'email' => 'email',
                'branch' => 'employee.branchUnit.code', 'lastLogin' => 'last_login_at',
                'status' => 'status', 'deactivateAt' => 'deactivate_at',
            ],
            'computed' => [
                'role' => 'App\\Http\\Controllers\\Api\\Computed::primaryRole',
            ],
            // Update only — creating an account goes through the hire flow or
            // "Invite user"/"Send sign-in details", which issue a password.
            // This is deliberately narrow: status and its scheduled-deactivation
            // date, nothing that would let the generic writer touch a password
            // or a role assignment it was never built to validate.
            'write' => [
                'label' => 'name',
                'rules' => [
                    'status' => 'required|in:Active,Suspended,Locked,Invited,Inactive',
                    'deactivateAt' => 'nullable|date',
                ],
                'fields' => [
                    'status' => 'status', 'deactivateAt' => 'deactivate_at',
                ],
            ],
        ],

        'admin/approval-rules' => [
            'model' => Models\ApprovalRule::class,
            'with' => ['approverRole', 'approverUser'],
            'sort' => ['document_type' => 'asc', 'step' => 'asc'],
            'map' => [
                'id' => 'id', 'documentType' => 'document_type', 'name' => 'name',
                'minAmount' => 'min_amount', 'maxAmount' => 'max_amount', 'step' => 'step',
                'approverRole' => 'approverRole.name', 'approverRoleId' => 'approver_role_id',
                'approverUser' => 'approverUser.name', 'approverUserId' => 'approver_user_id',
                'isActive' => 'is_active',
            ],
            'computed' => [
                'condition' => 'App\\Http\\Controllers\\Api\\Computed::approvalCondition',
                'approver' => 'App\\Http\\Controllers\\Api\\Computed::approvalApprover',
                'status' => 'App\\Http\\Controllers\\Api\\Computed::activeStatus',
            ],
            'write' => [
                'label' => 'name',
                'defaults' => ['is_active' => true, 'step' => 1, 'min_amount' => 0],
                'rules' => [
                    'documentType' => 'required|string|max:64',
                    'name' => 'required|string|max:150',
                    'minAmount' => 'nullable|numeric|min:0',
                    // Blank means "no ceiling" — the last step in a chain.
                    'maxAmount' => 'nullable|numeric|min:0|gte:minAmount',
                    'step' => 'required|integer|min:1|max:10',
                    // One or the other: a step routed to nobody approves
                    // nothing, and routing to both is ambiguous.
                    'approverRoleId' => 'nullable|integer|exists:roles,id|required_without:approverUserId',
                    'approverUserId' => 'nullable|integer|exists:users,id|required_without:approverRoleId',
                    'isActive' => 'nullable|boolean',
                ],
                'fields' => [
                    'documentType' => 'document_type', 'name' => 'name',
                    'minAmount' => 'min_amount', 'maxAmount' => 'max_amount', 'step' => 'step',
                    'approverRoleId' => 'approver_role_id', 'approverUserId' => 'approver_user_id',
                    'isActive' => 'is_active',
                ],
            ],
        ],

        /* Who may decide on a fuel/trip request. Plain CRUD — the
           authorization check itself lives in FuelRequest::canApprove(),
           which reads this table directly rather than through the API. */
        'admin/fuel-approvers' => [
            'model' => Models\FuelApprover::class,
            'with' => ['user', 'role'],
            'sort' => ['id' => 'desc'],
            'map' => [
                'id' => 'id', 'userId' => 'user_id', 'user' => 'user.name',
                'roleId' => 'role_id', 'role' => 'role.name', 'active' => 'active',
            ],
            'write' => [
                'label' => 'id',
                'defaults' => ['active' => true],
                'rules' => [
                    // One or the other: a row approving nobody approves
                    // nothing, and naming both is ambiguous about which one
                    // actually granted the approval.
                    'userId' => 'nullable|integer|exists:users,id|required_without:roleId',
                    'roleId' => 'nullable|integer|exists:roles,id|required_without:userId',
                    'active' => 'nullable|boolean',
                ],
                'fields' => [
                    'userId' => 'user_id', 'roleId' => 'role_id', 'active' => 'active',
                ],
            ],
        ],

        /* Who gets emailed for which event — one row per event, seeded, never
           created or deleted from the UI, only edited (recipients, on/off). */
        'admin/notification-rules' => [
            'model' => Models\NotificationRule::class,
            'sort' => ['name' => 'asc'],
            'map' => [
                'id' => 'id', 'event' => 'event', 'name' => 'name', 'description' => 'description',
                'emailEnabled' => 'email_enabled', 'inAppEnabled' => 'in_app_enabled',
                'recipientRoles' => 'recipient_roles', 'recipientEmails' => 'recipient_emails',
            ],
            'write' => [
                'label' => 'name',
                'rules' => [
                    'emailEnabled' => 'sometimes|boolean',
                    'inAppEnabled' => 'sometimes|boolean',
                    'recipientRoles' => 'nullable|array',
                    'recipientRoles.*' => 'string',
                    'recipientEmails' => 'nullable|array',
                    'recipientEmails.*' => 'email',
                ],
                'fields' => [
                    'emailEnabled' => 'email_enabled', 'inAppEnabled' => 'in_app_enabled',
                    'recipientRoles' => 'recipient_roles', 'recipientEmails' => 'recipient_emails',
                ],
            ],
        ],

        /* Roles, so an approval step can be routed to one. */
        'admin/roles' => [
            'model' => Models\Role::class,
            'sort' => ['name' => 'asc'],
            'map' => ['id' => 'id', 'code' => 'code', 'name' => 'name', 'description' => 'description'],
            'counts' => ['users' => 'members'],
        ],

        'admin/audit-log' => [
            'model' => Models\AuditLog::class,
            'sort' => ['occurred_at' => 'desc'],
            'limit' => 500,
            'map' => [
                'id' => 'id', 'user' => 'user_label', 'actorType' => 'actor_type', 'action' => 'action',
                'entity' => 'entity_type', 'entityLabel' => 'entity_label', 'module' => 'module',
                'outcome' => 'outcome', 'changes' => 'changes', 'ip' => 'ip_address',
                'userAgent' => 'user_agent', 'requestId' => 'request_id', 'occurred' => 'occurred_at',
            ],
        ],

        // Geo-IP rules are served by GeoRuleController, not from this registry —
        // they need write operations and a lock-yourself-out guard.

        /* Every sign-in attempt, with the browser's own reported location
           alongside the IP address — see AuthController::reportLocation().
           Read-only and superadmin-only: this is exactly the kind of record
           that should never be editable, and it says where every account
           holder has actually been signing in from. */
        'admin/login-activity' => [
            'model' => Models\LoginAttempt::class,
            'with' => ['user'],
            'sort' => ['attempted_at' => 'desc'],
            'limit' => 500,
            'map' => [
                'id' => 'id', 'username' => 'username', 'userId' => 'user_id', 'userName' => 'user.name',
                'ip' => 'ip_address', 'countryCode' => 'country_code',
                'latitude' => 'latitude', 'longitude' => 'longitude', 'accuracyM' => 'location_accuracy_m',
                'userAgent' => 'user_agent', 'succeeded' => 'succeeded', 'failureReason' => 'failure_reason',
                'attemptedAt' => 'attempted_at',
            ],
        ],

        'admin/email-log' => [
            'model' => Models\EmailLog::class,
            'sort' => ['created_at' => 'desc'],
            'limit' => 500,
            'map' => [
                'id' => 'id', 'to' => 'to_address', 'subject' => 'subject', 'event' => 'event',
                'status' => 'status', 'error' => 'error', 'sent' => 'sent_at', 'created' => 'created_at',
            ],
        ],

        // Backups are served by BackupController — they need create, restore
        // and download, none of which a read-only registry entry can do.
    ],

    /*
     * Text recognition for uploaded CVs.
     *
     * Only needed for scans and photographs; a PDF or a DOCX is read without
     * it. Left as a bare command name so a host that has tesseract on PATH
     * works with no configuration, and overridable because on Windows it
     * installs to a path with a space in it and is not on PATH.
     *
     * When it is absent the upload still succeeds — the applicant is told the
     * document could not be read and fills the form in by hand.
     */
    'ocr' => [
        'tesseract' => env('TESSERACT_PATH', 'tesseract'),
        'language' => env('TESSERACT_LANG', 'eng'),
    ],
];
