<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Backup;
use App\Services\BackupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Backup, restore, import and clear.
 *
 * Anything that can destroy data requires the caller to type an exact
 * confirmation phrase. A checkbox is too easy to click through; typing
 * "CLEAR TRANSACTIONAL DATA" is not something anyone does by accident.
 */
class BackupController extends Controller
{
    public function __construct(private readonly BackupService $backups) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => [
            'backups' => Backup::latest('id')->limit(50)->get(),
            'inventory' => $this->backups->inventory(),
            'mysqldump' => (bool) $this->backups->findMysqlBinary('mysqldump'),
            'driver' => config('database.default'),
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $backup = $this->backups->create('manual', $request->user()?->id);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Backup failed: '.$e->getMessage()], 500);
        }

        return response()->json(['data' => $backup], 201);
    }

    public function download(Backup $backup): BinaryFileResponse
    {
        abort_unless(Storage::disk('local')->exists($backup->path), 404, 'That backup file is no longer on disk.');

        return response()->download($this->backups->path($backup), $backup->filename);
    }

    public function destroy(Backup $backup): JsonResponse
    {
        $this->backups->delete($backup);

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function restore(Request $request, Backup $backup): JsonResponse
    {
        $request->validate([
            'confirm' => ['required', 'string', 'in:RESTORE'],
        ], [], ['confirm' => 'confirmation']);

        try {
            $this->backups->restore($backup, $request->user()?->id);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Restore failed: '.$e->getMessage()], 500);
        }

        return response()->json(['data' => [
            'restored' => true,
            'message' => 'The database was restored. A snapshot of the previous state was saved first.',
        ]]);
    }

    /** Accepts a .sql file produced by this system or by mysqldump. */
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:102400'],
        ]);

        $file = $request->file('file');

        if (! in_array(strtolower($file->getClientOriginalExtension()), ['sql', 'txt'], true)) {
            return response()->json(['message' => 'Upload a .sql file.'], 422);
        }

        $filename = 'imported-'.now()->format('Ymd-His').'.sql';
        $path = "backups/{$filename}";
        Storage::disk('local')->put($path, $file->get());

        $backup = Backup::create([
            'filename' => $filename,
            'path' => $path,
            'kind' => 'manual',
            'created_by' => $request->user()?->id,
            'status' => 'Completed',
            'size_bytes' => Storage::disk('local')->size($path),
        ]);

        return response()->json([
            'data' => $backup,
            'message' => 'Uploaded. Use Restore to apply it — the current data will be snapshotted first.',
        ], 201);
    }

    public function clearTransactional(Request $request): JsonResponse
    {
        // Taking the masterfile as well is a separate, longer phrase. Typing
        // the shorter one must never be able to delete the 201 files by
        // accident, so the two are not the same confirmation.
        $request->validate([
            'confirm' => ['required', 'string', 'in:CLEAR TRANSACTIONAL DATA,CLEAR TRANSACTIONAL DATA AND MASTERFILE'],
        ], [], ['confirm' => 'confirmation']);

        $includeMasterfile = $request->string('confirm')->toString() === 'CLEAR TRANSACTIONAL DATA AND MASTERFILE';

        try {
            $cleared = $this->backups->clearTransactional($request->user()?->id, $includeMasterfile);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Clear failed: '.$e->getMessage()], 500);
        }

        return response()->json(['data' => [
            'cleared' => $cleared,
            'rows' => array_sum($cleared),
            'message' => $includeMasterfile
                ? 'Documents and the employee masterfile removed. Company structure, roles, settings and administrator sign-ins were kept.'
                : 'Documents removed. Company structure, users and settings were kept.',
        ]]);
    }
}
