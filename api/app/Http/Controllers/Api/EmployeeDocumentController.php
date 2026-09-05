<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DocumentType;
use App\Models\Employee;
use App\Models\EmployeeDocument;
use App\Services\EmployeeDocumentChecklist;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The 201 file as paper: the checklist, the upload, and the sign-off.
 *
 * Mirrors OnboardingController's shape deliberately — that one answers
 * "is the data complete", this one answers "were the documents collected" —
 * so the two screens feel like one system rather than two half-built ones.
 */
class EmployeeDocumentController extends Controller
{
    private const MAX_KILOBYTES = 10240; // 10MB — a scanned multi-page PDF, generously.

    private const MIMES = 'pdf,jpg,jpeg,png,webp';

    public function __construct(private readonly EmployeeDocumentChecklist $checklist) {}

    public function types(): JsonResponse
    {
        return response()->json(['data' => DocumentType::orderBy('sort_order')->get()]);
    }

    /** One employee's checklist: every type, what is on file, and the completion figure. */
    public function index(Employee $employee): JsonResponse
    {
        return response()->json([
            'data' => [
                'employeeId' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
            ] + $this->checklist->forEmployee($employee),
        ]);
    }

    /** Every employee with something missing or lapsing, worst first — the dashboard/masterfile panel. */
    public function outstanding(): JsonResponse
    {
        $rows = $this->checklist->outstanding();

        return response()->json([
            'data' => [
                'employees' => $rows,
                'counts' => [
                    // Every active employee this checklist evaluated — not
                    // the count of rows below, which is only the ones with
                    // something outstanding. Conflating the two is what
                    // made "Employees tracked" read as a 50-person cap.
                    'total' => $this->checklist->trackedCount(),
                    'missing' => $rows->where('missing', '>', 0)->count(),
                    'expiringSoon' => $rows->where('expiringSoon', '>', 0)->count(),
                ],
            ],
        ]);
    }

    /**
     * Uploads (or replaces) one document for one employee.
     *
     * A re-upload overwrites the slot rather than adding a version — see the
     * migration's unique constraint — and always resets status to Pending, so
     * a rejected scan re-uploaded correctly has to be looked at again rather
     * than quietly inheriting a stale Verified flag.
     */
    public function store(Request $request, Employee $employee): JsonResponse
    {
        $data = $request->validate([
            'document_type_id' => 'required|exists:document_types,id',
            'file' => 'required|file|max:'.self::MAX_KILOBYTES.'|mimes:'.self::MIMES,
            'expiry_date' => 'nullable|date',
        ]);

        $type = DocumentType::findOrFail($data['document_type_id']);

        if ($type->expires && empty($data['expiry_date'])) {
            return response()->json(['message' => 'This document type expires — an expiry date is required.'], 422);
        }

        $file = $request->file('file');
        $path = $file->store("employee-documents/{$employee->id}", 'local');

        // Delete the file it replaces, if any, so the disk does not accumulate
        // scans nobody will ever look at again.
        $existing = EmployeeDocument::where('employee_id', $employee->id)
            ->where('document_type_id', $type->id)->first();

        if ($existing && Storage::disk('local')->exists($existing->disk_path)) {
            Storage::disk('local')->delete($existing->disk_path);
        }

        $document = EmployeeDocument::updateOrCreate(
            ['employee_id' => $employee->id, 'document_type_id' => $type->id],
            [
                'disk_path' => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime' => $file->getMimeType(),
                'bytes' => $file->getSize(),
                'status' => 'Pending',
                'uploaded_by' => $request->user()?->id,
                'verified_by' => null,
                'verified_at' => null,
                'expiry_date' => $data['expiry_date'] ?? null,
                'notes' => null,
            ],
        );

        return response()->json(['data' => $document->fresh(['documentType'])]);
    }

    /** Confirms a document is genuine and legible — the act that makes it count toward completion. */
    public function verify(Request $request, EmployeeDocument $document): JsonResponse
    {
        $document->update([
            'status' => 'Verified',
            'verified_by' => $request->user()?->id,
            'verified_at' => now(),
            'notes' => null,
        ]);

        return response()->json(['data' => $document->fresh(['documentType', 'verifiedBy'])]);
    }

    /** Sends a document back — wrong file, illegible scan, mismatched name. */
    public function reject(Request $request, EmployeeDocument $document): JsonResponse
    {
        $data = $request->validate(['notes' => 'required|string|max:500']);

        $document->update([
            'status' => 'Rejected',
            'verified_by' => $request->user()?->id,
            'verified_at' => now(),
            'notes' => $data['notes'],
        ]);

        return response()->json(['data' => $document->fresh(['documentType', 'verifiedBy'])]);
    }

    public function download(EmployeeDocument $document): StreamedResponse
    {
        abort_unless(Storage::disk('local')->exists($document->disk_path), 404, 'That file is no longer here.');

        return Storage::disk('local')->response(
            $document->disk_path,
            $document->original_name,
            ['Content-Type' => $document->mime ?: 'application/octet-stream'],
            str_contains((string) $document->mime, 'pdf') ? 'inline' : 'attachment',
        );
    }

    public function destroy(EmployeeDocument $document): JsonResponse
    {
        if (Storage::disk('local')->exists($document->disk_path)) {
            Storage::disk('local')->delete($document->disk_path);
        }

        $document->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }
}
