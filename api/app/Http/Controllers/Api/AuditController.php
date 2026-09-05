<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AuditIntegrity;
use Illuminate\Http\JsonResponse;

/**
 * Answers one question about the audit trail that reading rows off it
 * cannot: whether it is still trustworthy. See `AuditIntegrity` for what
 * "trustworthy" means here.
 */
class AuditController extends Controller
{
    public function __construct(private readonly AuditIntegrity $integrity) {}

    public function verify(): JsonResponse
    {
        return response()->json(['data' => $this->integrity->verify()]);
    }
}
