<?php

use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuditController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\CareersController;
use App\Http\Controllers\Api\ChatAttachmentController;
use App\Http\Controllers\Api\ChatController;
use App\Http\Controllers\Api\ComplianceController;
use App\Http\Controllers\Api\CredentialController;
use App\Http\Controllers\Api\DepartmentAccessController;
use App\Http\Controllers\Api\EmployeeDocumentController;
use App\Http\Controllers\Api\EmployeeIdCardController;
use App\Http\Controllers\Api\EmployeeImportController;
use App\Http\Controllers\Api\FinanceController;
use App\Http\Controllers\Api\ReimbursementClaimController;
use App\Http\Controllers\Api\FuelRequestController;
use App\Http\Controllers\Api\GeocodeController;
use App\Http\Controllers\Api\GeoRuleController;
use App\Http\Controllers\Api\HrController;
use App\Http\Controllers\Api\ImpersonationController;
use App\Http\Controllers\Api\MaintenanceController;
use App\Http\Controllers\Api\MyComplianceController;
use App\Http\Controllers\Api\OffboardingController;
use App\Http\Controllers\Api\OnboardingController;
use App\Http\Controllers\Api\OnboardingTaskController;
use App\Http\Controllers\Api\PayrollController;
use App\Http\Controllers\Api\ProcessExtrasController;
use App\Http\Controllers\Api\ProcurementController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\PublicEmployeeController;
use App\Http\Controllers\Api\PublicFileController;
use App\Http\Controllers\Api\RecruitmentController;
use App\Http\Controllers\Api\CoeController;
use App\Http\Controllers\Api\HrEventsController;
use App\Http\Controllers\Api\OvertimeController;
use App\Http\Controllers\Api\ResignationController;
use App\Http\Controllers\Api\ResourceController;
use App\Http\Controllers\Api\SalesController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\SupportController;
use App\Http\Controllers\Api\SystemController;
use App\Http\Controllers\Api\TaskController;
use App\Http\Controllers\Api\TrainingController;
use App\Http\Controllers\Api\VacancyArchiveController;
use App\Http\Controllers\Api\WageOrderController;
use App\Http\Controllers\Api\WarehouseController;
use App\Services\GeoGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API routes
|--------------------------------------------------------------------------
|
| The React app talks to /api/v1. Most list endpoints are served from the
| registry in config/erp.php, so adding a screen is a config entry rather
| than a new controller. Anything with real behaviour — auth, settings,
| Geo-IP — gets a controller of its own.
|
| ORDER MATTERS: the registry catch-all is last, or it would swallow every
| specific route below it.
|
*/

Route::prefix('v1')->group(function () {

    /* ------------------------------- Public ------------------------------- */

    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('auth/verify-code', [AuthController::class, 'verifyCode'])->middleware('throttle:10,1');

    /* Forgotten password. Public by necessity, so both ends are throttled and
       neither reveals whether an account exists. */
    Route::post('auth/forgot-password', [CredentialController::class, 'forgot'])->middleware('throttle:5,1');
    Route::post('auth/verify-reset-code', [CredentialController::class, 'verifyResetCode'])->middleware('throttle:10,1');
    Route::post('auth/reset-password', [CredentialController::class, 'reset'])->middleware('throttle:10,1');

    // Drives the setup wizard, which has to work before anyone can sign in.
    Route::get('system/status', [SystemController::class, 'status']);

    // Company name and logo for the sign-in screen and booking portal.
    Route::get('branding', [SystemController::class, 'branding']);

    // Serves files off the `public` disk without needing the `storage:link`
    // symlink — see PublicFileController. `.*` so a path with subfolders
    // (`employee-photos/12/headshot.jpg`) is captured as one segment.
    Route::get('public-files/{path}', [PublicFileController::class, 'show'])
        ->where('path', '.*')
        ->name('public-files.show');

    /*
     * The careers site.
     *
     * Public by necessity — a jobseeker has no account and will not make one
     * to apply. Everything here is therefore throttled per IP and deliberately
     * narrow: the reads expose only what the posting says may be published,
     * the write creates one applicant at stage Applied and nothing else, and
     * the status lookup needs both the reference code and the email it was
     * filed with, so it cannot be used to discover who applied.
     *
     * The parse endpoint gets the tightest limit of the three: it inflates a
     * PDF and may shell out to OCR, which is the most expensive thing an
     * anonymous request can ask this server to do.
     */
    Route::get('careers/jobs', [CareersController::class, 'jobs'])->middleware('throttle:60,1');
    Route::get('careers/jobs/{slug}', [CareersController::class, 'job'])->middleware('throttle:60,1');
    Route::post('careers/resume/parse', [CareersController::class, 'parseResume'])->middleware('throttle:10,1');
    Route::post('careers/apply', [CareersController::class, 'apply'])->middleware('throttle:6,1');
    Route::post('careers/status', [CareersController::class, 'status'])->middleware('throttle:15,1');

    /* Answering an offer. Same credential as the status lookup — the reference
       code and the email it was filed with, together — so the links in the
       offer email are not a permanent forwardable key to somebody's salary. */
    Route::post('careers/offer/respond', [CareersController::class, 'respondToOffer'])->middleware('throttle:10,1');

    Route::get('connection', fn (Request $request, GeoGuard $guard) => response()->json([
        'data' => $guard->describe($request->ip()),
    ]));

    Route::get('health', fn () => response()->json([
        'status' => 'ok',
        'database' => config('database.default'),
        'time' => now()->toIso8601String(),
    ]));

    /*
     * Chat attachments, on a signed URL rather than a bearer token.
     *
     * An <img src> cannot carry an Authorization header, so a token-guarded
     * route renders every photo as a broken image. The signature is the
     * credential instead: it is minted only for somebody the membership check
     * has already passed, and it expires in hours rather than never.
     *
     * The trade-off is that a copied link works until it expires. That is the
     * same bargain every messaging app makes for inline images, and it is a
     * better one than the alternative — a permanently public path under
     * `storage/` that never expires at all.
     */
    Route::get('chat/attachments/{attachment}', [ChatAttachmentController::class, 'show'])
        ->name('chat.attachment')
        ->middleware('signed');

    /*
     * What a scanned ID badge shows a stranger.
     *
     * Not a signed URL like the one above — a badge is printed and laminated
     * for the employee's whole tenure, so a link that expires in hours would
     * turn every card into a dead QR code the day after it was printed. The
     * token itself is the only credential (see Employee::ensurePublicToken);
     * throttled per IP since it needs no login to try.
     */
    Route::get('public/employees/{token}', [PublicEmployeeController::class, 'show'])->middleware('throttle:30,1');

    /* ----------------------------- Authenticated -------------------------- */

    Route::middleware(['auth:sanctum', 'department-access'])->group(function () {

        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::post('auth/login-location', [AuthController::class, 'reportLocation'])->middleware('throttle:10,1');
        Route::post('account/password', [SettingsController::class, 'changeOwnPassword']);

        /* Dashboards — roll-ups the registry cannot express. */
        Route::get('sales/dashboard', [AnalyticsController::class, 'sales']);

        /* Sales endpoints with behaviour of their own. */
        Route::get('sales/customers/{customer}/history', [SalesController::class, 'customerHistory']);
        Route::post('sales/quotations/{quotation}/convert', [SalesController::class, 'convertQuotation']);
        Route::get('sales/deliveries/route-preview', [SalesController::class, 'routePreview']);
        Route::post('sales/orders/{order}/release', [SalesController::class, 'releaseOrder']);

        /* Procurement: the chain from requisition to invoice. */
        Route::get('procurement/dashboard', [ProcurementController::class, 'dashboard']);
        Route::get('procurement/suppliers/{supplier}/history', [ProcurementController::class, 'supplierHistory']);
        Route::post('procurement/requisitions/{requisition}/rfq', [ProcurementController::class, 'requisitionToRfq']);
        Route::post('procurement/requisitions/{requisition}/order', [ProcurementController::class, 'requisitionToOrder']);
        Route::post('procurement/rfq-bids/{bid}/award', [ProcurementController::class, 'awardBid']);
        Route::post('procurement/supplier-invoices/{invoice}/match', [ProcurementController::class, 'matchInvoice']);

        /* Supplier scoring. Derived from documents, never typed. */
        Route::get('procurement/suppliers/{supplier}/scorecard', [ProcurementController::class, 'supplierScorecard']);
        Route::post('procurement/suppliers/evaluate', [ProcurementController::class, 'evaluateSuppliers']);
        Route::post('procurement/suppliers/{supplier}/evaluate', [ProcurementController::class, 'evaluateSupplier']);

        /* Warehouse: the dashboard, and replenishment as a calculation. */
        Route::get('warehouse/dashboard', [WarehouseController::class, 'dashboard']);
        Route::get('warehouse/replenishment', [WarehouseController::class, 'replenishment']);
        Route::post('warehouse/replenishment/requisition', [WarehouseController::class, 'requisition']);
        Route::get('warehouse/expiring', [WarehouseController::class, 'expiring']);
        Route::post('warehouse/stock/adjust', [WarehouseController::class, 'adjust']);
        Route::post('warehouse/abc/recompute', [WarehouseController::class, 'recomputeAbc']);
        Route::post('warehouse/bins/suggest', [WarehouseController::class, 'suggestBin']);
        Route::post('warehouse/waves', [WarehouseController::class, 'buildWave']);

        /* Maintenance: the dashboard, and the events that change an asset. */
        Route::get('maintenance/dashboard', [MaintenanceController::class, 'dashboard']);
        Route::get('maintenance/technician-load', [MaintenanceController::class, 'technicianLoad']);
        Route::get('maintenance/assets/{asset}/history', [MaintenanceController::class, 'assetHistory']);
        Route::post('maintenance/preventive/generate', [MaintenanceController::class, 'generatePreventive']);
        Route::post('maintenance/work-orders/{workOrder}/complete', [MaintenanceController::class, 'completeWorkOrder']);
        Route::post('maintenance/downtime/{downtimeEvent}/work-order', [MaintenanceController::class, 'workOrderFromBreakdown']);

        /* Fuel requests — the trip ticket.

           `preview` is deliberately a GET-shaped read with no side effects: the
           form calls it as the pins move, and burning a reference number on a
           trip somebody is still sketching out would leave the sequence full of
           holes. The decision route is where the authority check lives. */
        Route::post('maintenance/fuel-requests/preview', [FuelRequestController::class, 'preview'])
            ->middleware('throttle:120,1');
        Route::get('maintenance/fuel-price', [FuelRequestController::class, 'price']);
        Route::post('maintenance/fuel-requests', [FuelRequestController::class, 'store']);
        // Ahead of the {fuelRequest} route below — otherwise "can-approve"
        // is swallowed by the wildcard and treated as an id to look up.
        Route::get('maintenance/fuel-requests/can-approve', [FuelRequestController::class, 'canApprove']);
        Route::get('maintenance/fuel-requests/{fuelRequest}', [FuelRequestController::class, 'show']);
        Route::post('maintenance/fuel-requests/{fuelRequest}/decide', [FuelRequestController::class, 'decide']);
        Route::post('maintenance/fuel-requests/{fuelRequest}/invoice', [FuelRequestController::class, 'recordInvoice']);
        Route::match(['put', 'patch'], 'maintenance/fuel-requests/{fuelRequest}', [FuelRequestController::class, 'update']);
        Route::post('maintenance/fuel-requests/{fuelRequest}/cancel', [FuelRequestController::class, 'cancel']);
        Route::delete('maintenance/fuel-requests/{fuelRequest}', [FuelRequestController::class, 'destroy']);

        /* Finance: the ledger, the statements built from it, and the postings. */
        Route::get('finance/dashboard', [FinanceController::class, 'dashboard']);
        Route::get('finance/statements', [FinanceController::class, 'statements']);
        Route::get('finance/trial-balance', [FinanceController::class, 'trialBalance']);
        Route::post('finance/accounts/rebuild', [FinanceController::class, 'rebuildBalances']);
        Route::post('finance/journals/{journal}/post', [FinanceController::class, 'postJournal']);
        Route::post('finance/journals/{journal}/reverse', [FinanceController::class, 'reverseJournal']);
        Route::post('finance/receivables/{invoice}/post', [FinanceController::class, 'postInvoice']);
        Route::post('finance/receivables/payment', [FinanceController::class, 'receivePayment']);
        Route::post('finance/payables/{bill}/post', [FinanceController::class, 'postBill']);
        Route::post('finance/payables/payment', [FinanceController::class, 'payBills']);
        Route::post('finance/expenses/{expense}/approve', [FinanceController::class, 'approveExpense']);
        Route::post('finance/reimbursements/{claim}/approve', [ReimbursementClaimController::class, 'approve']);
        Route::post('finance/reimbursements/{claim}/reject', [ReimbursementClaimController::class, 'reject']);
        Route::post('finance/reimbursements/{claim}/mark-paid', [ReimbursementClaimController::class, 'markPaid']);
        Route::post(
            'maintenance/fuel-requests/{fuelRequest}/reimburse',
            [ReimbursementClaimController::class, 'createFromFuelRequest'],
        );
        Route::post('finance/fixed-assets/depreciation', [FinanceController::class, 'runDepreciation']);
        Route::post('finance/tax-filings/{taxFiling}/file', [FinanceController::class, 'fileTax']);
        Route::post('finance/budgets/refresh', [FinanceController::class, 'refreshBudgets']);
        Route::post('finance/bank-transactions/{bankTransaction}/reconcile', [FinanceController::class, 'reconcile']);

        /* The daily time record. Personal attendance data for somebody other
           than yourself, so it is restricted — employees see their own on the
           self-service page. */
        Route::middleware('super-admin')->group(function () {
            Route::get('hr/dtr', [HrController::class, 'dtr']);
            Route::get('hr/dtr/bulk', [HrController::class, 'dtrBulk']);
            Route::get('hr/dtr/periods', [HrController::class, 'dtrPeriods']);
        });

        /* Address lookup. Shared by every screen that captures a place, and
           throttled because the provider behind it bills per call. */
        Route::post('geo/geocode', [GeocodeController::class, '__invoke'])->middleware('throttle:60,1');
        /* Type-ahead place search. Throttled higher because it fires per
           keystroke behind a debounce, unlike the one-shot geocode above. */
        Route::get('geo/search', [GeocodeController::class, 'search'])->middleware('throttle:180,1');

        /* Settings. Administration — see the super-admin group below, which
           these are declared inside. */

        /* HR: the people record, the punch clock and infraction monitoring. */
        Route::get('hr/dashboard', [HrController::class, 'dashboard']);
        Route::get('hr/org-chart', [HrController::class, 'orgChart']);
        Route::post('hr/org-chart/{employee}/position', [HrController::class, 'saveOrgChartPosition']);
        Route::post('hr/org-chart/{employee}/manager', [HrController::class, 'reassignManager']);
        Route::get('hr/watchlist', [HrController::class, 'watchlist']);
        Route::get('hr/punch-integrity', [HrController::class, 'suspiciousPunches']);
        Route::post('hr/leaves/{leave}/decide', [HrController::class, 'decideLeave']);
        Route::post('hr/cases/scan', [HrController::class, 'scanInfractions']);
        Route::post('hr/cases/raise', [HrController::class, 'raiseCase']);
        Route::post('hr/employees/{employee}/reset-password', [HrController::class, 'resetPassword']);

        /* Due process on a disciplinary case — the twin-notice trail that
           decides whether a dismissal survives being questioned. */
        Route::get('hr/cases/{case}/due-process', [HrController::class, 'caseDueProcess']);
        Route::post('hr/cases/{case}/due-process', [HrController::class, 'recordDueProcess']);
        Route::get('hr/cases/{case}/nte', [HrController::class, 'caseNte']);
        Route::get('hr/cases/{case}/nod', [HrController::class, 'caseNod']);

        /* Self service. These never take an employee id — the signed-in
           account decides whose record is returned. */
        Route::get('me/hr', [HrController::class, 'me']);
        Route::get('me/attendance', [HrController::class, 'myAttendance']);
        Route::get('me/payroll-periods', [HrController::class, 'myPayrollPeriods']);
        Route::put('me/profile', [HrController::class, 'updateProfile']);

        /* Ends an impersonated session — called from inside it, on the
           impersonation token itself, so it needs no super-admin check of
           its own (see ImpersonationController::stop). */
        Route::post('admin/impersonation/stop', [ImpersonationController::class, 'stop']);
        Route::get('me/payslips/{payslip}', [HrController::class, 'myPayslip']);
        Route::get('me/clock', [HrController::class, 'clockState']);
        Route::post('me/clock/punch', [HrController::class, 'punch'])->middleware('throttle:30,1');
        Route::post('me/pin', [HrController::class, 'setPin'])->middleware('throttle:10,1');
        Route::post('me/leave', [HrController::class, 'fileLeave']);
        Route::post('me/cases/{case}/acknowledge', [HrController::class, 'acknowledgeCase']);
        Route::post('me/resignation', [ResignationController::class, 'submit']);
        Route::get('me/resignation', [ResignationController::class, 'mine']);
        Route::post('me/resignation/cancel', [ResignationController::class, 'cancel']);
        Route::post('me/coe', [CoeController::class, 'submit']);
        Route::get('me/coe', [CoeController::class, 'mine']);
        Route::get('me/coe/{coe}/document', [CoeController::class, 'myDocument']);
        Route::post('me/overtime', [OvertimeController::class, 'submit']);
        Route::get('me/overtime', [OvertimeController::class, 'mine']);
        Route::get('me/announcements', [HrEventsController::class, 'myAnnouncements']);

        /* Payroll. A run moves Draft → Computed → Approved → Released, and
           each step means something — the last one is money leaving. */
        Route::post('hr/payroll-periods/generate', [PayrollController::class, 'generatePeriods']);
        Route::get('hr/payroll-runs/{run}/register', [PayrollController::class, 'register']);
        Route::get('hr/payroll-runs/{run}/aub-template', [PayrollController::class, 'aubTemplate']);
        Route::get('hr/payroll-runs/{run}/aub-warnings', [PayrollController::class, 'aubWarnings']);
        Route::post('hr/payroll-runs/{run}/compute', [PayrollController::class, 'compute']);
        Route::post('hr/payroll-runs/{run}/approve', [PayrollController::class, 'approve']);
        Route::post('hr/payroll-runs/{run}/release', [PayrollController::class, 'release']);
        Route::get('hr/remittances', [PayrollController::class, 'remittances']);
        Route::get('hr/reports/agency/{agency}', [PayrollController::class, 'agencySchedule']);
        Route::get('hr/reports/thirteenth-month', [PayrollController::class, 'thirteenthMonth']);
        Route::get('hr/reports/bir2316', [PayrollController::class, 'bir2316']);

        /* Payslips.
         *
         * Editable only in the places the engine leaves blank — allowances,
         * holiday, rest day and leave pay, and itemised one-offs. Everything
         * derived is recomputed on the server from those, so a payslip cannot
         * be saved with figures that disagree with each other, and nothing at
         * all can be changed once the run is approved. */
        Route::post('hr/payroll-runs/{run}/payslips', [PayrollController::class, 'addPayslip']);
        Route::patch('hr/payslips/{payslip}', [PayrollController::class, 'adjustPayslip']);
        Route::delete('hr/payslips/{payslip}', [PayrollController::class, 'deletePayslip']);
        Route::post('hr/payslips/{payslip}/lines', [PayrollController::class, 'addPayslipLine']);
        Route::delete('hr/payslip-lines/{line}', [PayrollController::class, 'deletePayslipLine']);

        /*
         * The bell, and the 201 files behind most of what is in it.
         *
         * A record created by a hire is complete in everything the candidate
         * could tell us and empty in everything only HR can — the TIN, the
         * statutory numbers, the bank account. Left alone, that surfaces as a
         * failed payroll run a fortnight later, so it is said here instead.
         */
        Route::get('notifications', [OnboardingController::class, 'notifications']);
        Route::post('notifications/notices/{notice}', [OnboardingController::class, 'readNotice']);
        Route::get('hr/onboarding', [OnboardingController::class, 'outstanding']);
        Route::get('hr/employees/{employee}/onboarding', [OnboardingController::class, 'show']);
        Route::post('hr/employees/{employee}/onboarding/complete', [OnboardingController::class, 'complete']);
        Route::post('hr/employees/{employee}/onboarding/reopen', [OnboardingController::class, 'reopen']);

        /* The 201 file as paper: the standard checklist, what has been
           uploaded against it, and the verify/reject sign-off. */
        Route::get('hr/document-types', [EmployeeDocumentController::class, 'types']);
        Route::get('hr/documents/outstanding', [EmployeeDocumentController::class, 'outstanding']);

        /* The new-hire checklist, generated once at hire and ticked off from
           here — access provisioned, orientation attended, statutory
           registration confirmed. */
        Route::get('hr/onboarding-tasks/outstanding', [OnboardingTaskController::class, 'outstanding']);
        Route::get('hr/employees/{employee}/onboarding-tasks', [OnboardingTaskController::class, 'index']);
        Route::post('hr/onboarding-tasks/{task}/complete', [OnboardingTaskController::class, 'complete']);
        Route::post('hr/onboarding-tasks/{task}/reopen', [OnboardingTaskController::class, 'reopen']);

        /* Offboarding — the clearance process a separation starts. */
        Route::get('hr/offboarding', [OffboardingController::class, 'index']);
        // Ahead of {case} below — otherwise "history" is bound as a case id.
        Route::get('hr/offboarding/history', [OffboardingController::class, 'history']);
        Route::get('hr/employees/{employee}/offboarding', [OffboardingController::class, 'forEmployee']);
        Route::post('hr/employees/{employee}/offboarding/initiate', [OffboardingController::class, 'initiate']);
        Route::get('hr/offboarding/{case}', [OffboardingController::class, 'show']);
        Route::patch('hr/offboarding/{case}', [OffboardingController::class, 'update']);
        Route::post('hr/offboarding/{case}/close', [OffboardingController::class, 'close']);
        Route::post('hr/offboarding/{case}/cancel', [OffboardingController::class, 'cancel']);
        Route::post('hr/offboarding-tasks/{task}/complete', [OffboardingController::class, 'completeTask']);
        Route::post('hr/offboarding-tasks/{task}/reopen', [OffboardingController::class, 'reopenTask']);

        /* Resignation requests — HR's side. Approving is what actually opens
           an offboarding case; declining just closes the request. */
        Route::get('hr/resignations', [ResignationController::class, 'index']);
        Route::post('hr/resignations/{resignation}/decide', [ResignationController::class, 'decide']);

        /* Certificate of Employment requests — HR's side. Issuing is what
           makes the document itself downloadable. */
        Route::get('hr/coe', [CoeController::class, 'index']);
        Route::post('hr/coe/{coe}/decide', [CoeController::class, 'decide']);
        Route::get('hr/coe/{coe}/document', [CoeController::class, 'document']);

        /* Overtime pre-approval — filed before or during a shift; does not
           change how overtime_hours itself is computed (still read from
           punches), only records whether it was actually authorized. */
        Route::get('hr/overtime', [OvertimeController::class, 'index']);
        Route::post('hr/overtime/{overtime}/decide', [OvertimeController::class, 'decide']);

        /* Birthdays, hire anniversaries and holidays, merged into one
           read-only calendar — computed from the 201 file, not stored. */
        Route::get('hr/events/upcoming', [HrEventsController::class, 'upcoming']);

        /* Wage orders — a DOLE rate keyed in once, propagated to the
           minimum-wage earners it affects at the branches it names. */
        Route::get('hr/wage-orders', [WageOrderController::class, 'index']);
        Route::post('hr/wage-orders', [WageOrderController::class, 'store']);
        Route::get('hr/wage-orders/{wageOrder}/preview', [WageOrderController::class, 'preview']);
        Route::post('hr/wage-orders/{wageOrder}/apply', [WageOrderController::class, 'apply']);
        Route::get('hr/employees/{employee}/documents', [EmployeeDocumentController::class, 'index']);
        Route::post('hr/employees/{employee}/documents', [EmployeeDocumentController::class, 'store']);
        Route::get('hr/employees/{employee}/id-card', [EmployeeIdCardController::class, 'show']);
        Route::post('hr/employees/{employee}/id-card/photo', [EmployeeIdCardController::class, 'uploadPhoto']);
        Route::post('hr/employees/{employee}/id-card/regenerate-token', [EmployeeIdCardController::class, 'regenerateToken']);
        Route::post('hr/documents/{document}/verify', [EmployeeDocumentController::class, 'verify']);
        Route::post('hr/documents/{document}/reject', [EmployeeDocumentController::class, 'reject']);
        Route::get('hr/documents/{document}/download', [EmployeeDocumentController::class, 'download']);
        Route::delete('hr/documents/{document}', [EmployeeDocumentController::class, 'destroy']);

        /* Recruitment. The pipeline has rules about what may follow what, and
           hiring creates a person — neither survives being a status column. */
        Route::get('hr/recruitment/pipeline', [RecruitmentController::class, 'pipeline']);
        Route::get('hr/ocr/health', [RecruitmentController::class, 'ocrHealth']);
        Route::get('hr/applicants/{applicant}/detail', [RecruitmentController::class, 'applicant']);
        Route::post('hr/applicants/{applicant}/move', [RecruitmentController::class, 'moveApplicant']);
        Route::post('hr/applicants/{applicant}/hire', [RecruitmentController::class, 'hire']);

        /* The offer.
         *
         * Preview first, because this is the most consequential email the
         * system sends and the terms in it become the salary on the 201 file.
         * Sending is never automatic on reaching the Offer stage — the figure
         * is usually settled in a conversation, and firing one on a stage
         * change would email somebody the wrong number at least once. */
        Route::post('hr/applicants/{applicant}/offer/preview', [RecruitmentController::class, 'previewOffer']);
        Route::post('hr/applicants/{applicant}/offer', [RecruitmentController::class, 'sendOffer']);
        Route::post('hr/applicants/{applicant}/offer/response', [RecruitmentController::class, 'recordOfferResponse']);
        Route::get('hr/applicants/{applicant}/offer/document', [RecruitmentController::class, 'offerDocument']);

        /* The CV, and everything read out of it. Uploads are multipart and the
           download re-authorises on every request — a resume carries a home
           address and a date of birth, so it never gets a shareable link. */
        Route::post('hr/recruitment/parse-resume', [RecruitmentController::class, 'parseResume'])
            ->middleware('throttle:30,1');
        /* Its own path rather than POST hr/applicants, which the registry
           already serves — the quick two-field create still has its place. */
        Route::post('hr/recruitment/intake', [RecruitmentController::class, 'intake']);
        Route::patch('hr/applicants/{applicant}/details', [RecruitmentController::class, 'updateApplicant']);
        Route::post('hr/applicants/{applicant}/resume', [RecruitmentController::class, 'uploadResume']);
        Route::get('hr/applicants/{applicant}/resume', [RecruitmentController::class, 'resume']);

        /* Job postings: the advert a manpower request becomes. Publishing is
           the moment a vacancy becomes public, so it is an act with a date on
           it rather than a status somebody types. */
        /*
         * The archive.
         *
         * A vacancy is archived rather than deleted from the board: that takes
         * it off every working list and its advert off the careers site, and
         * keeps the record. Destroying one is a second, deliberate act from
         * inside the archive, and it still refuses where a hire or an
         * application points at the record.
         *
         * Declared before the registry catch-all so the generic DELETE never
         * reaches a manpower request.
         */
        Route::get('hr/vacancy-archive', [VacancyArchiveController::class, 'index']);
        Route::post('hr/requisitions/{requisition}/archive', [VacancyArchiveController::class, 'store']);
        Route::post('hr/vacancy-archive/{requisition}/restore', [VacancyArchiveController::class, 'restore']);
        Route::delete('hr/vacancy-archive/{requisition}', [VacancyArchiveController::class, 'destroy']);

        /* The advert, written from the role. A manpower request already knows
           the position, the department and the budget; typing the posting from
           nothing at the end of that form is what produces adverts with a
           title and an empty body. */
        Route::post('hr/job-postings/draft', [RecruitmentController::class, 'draftAdvert']);
        Route::post('hr/requisitions/{requisition}/posting', [RecruitmentController::class, 'postingFromRequisition']);
        Route::post('hr/job-postings/{posting}/publish', [RecruitmentController::class, 'publishPosting']);
        Route::post('hr/job-postings/{posting}/close', [RecruitmentController::class, 'closePosting']);
        Route::post('hr/job-postings/{posting}/reassess', [RecruitmentController::class, 'reassessPosting']);
        Route::post('hr/applicants/{applicant}/reassess', [RecruitmentController::class, 'reassessApplicant']);

        /* Performance. The rating is derived from the score when the cycle
           closes, so the two can never disagree. */
        Route::get('hr/performance/summary', [RecruitmentController::class, 'performanceSummary']);
        Route::post('hr/performance/cycles', [RecruitmentController::class, 'openCycle']);
        Route::get('hr/reviews/{review}/detail', [RecruitmentController::class, 'review']);
        Route::post('hr/reviews/{review}/score', [RecruitmentController::class, 'scoreReview']);
        Route::post('hr/reviews/{review}/move', [RecruitmentController::class, 'moveReview']);
        Route::get('hr/reviews/{review}/document', [RecruitmentController::class, 'reviewDocument']);

        /* Training. A session is scheduled, a room is marked, and completing
           it issues the certificates — none of which is a CRUD operation. */
        Route::get('hr/training-sessions', [TrainingController::class, 'index']);
        Route::post('hr/training-sessions', [TrainingController::class, 'store']);
        Route::get('hr/training-sessions/{session}', [TrainingController::class, 'show']);
        Route::patch('hr/training-sessions/{session}', [TrainingController::class, 'update']);
        Route::post('hr/training-sessions/{session}/enrol', [TrainingController::class, 'enrol']);
        Route::delete('hr/training-sessions/{session}/attendees/{employee}', [TrainingController::class, 'removeAttendee']);
        Route::post('hr/training-sessions/{session}/attendance', [TrainingController::class, 'markAttendance']);
        Route::post('hr/training-sessions/{session}/complete', [TrainingController::class, 'complete']);
        Route::post('hr/training-sessions/{session}/reopen', [TrainingController::class, 'reopen']);

        /* HR masterfile */
        Route::post('hr/employees/import', [EmployeeImportController::class, 'import']);
        Route::get('hr/employees/export', [EmployeeImportController::class, 'export']);

        /* Workspace messaging.

           `updates` is the poll every open thread runs, so it is deliberately
           the cheapest route here — one indexed range scan and a count. The
           send route is throttled: a runaway client retrying a failed post
           should not be able to fill the table. */
        Route::get('chat/conversations', [ChatController::class, 'index']);
        Route::post('chat/conversations', [ChatController::class, 'store']);
        Route::get('chat/directory', [ChatController::class, 'directory']);
        Route::get('chat/unread', [ChatController::class, 'unread']);
        Route::post('chat/direct', [ChatController::class, 'direct']);
        Route::post('chat/departments/sync', [ChatController::class, 'syncDepartments']);

        Route::get('chat/conversations/{conversation}/messages', [ChatController::class, 'messages']);
        Route::get('chat/conversations/{conversation}/updates', [ChatController::class, 'updates']);
        Route::get('chat/conversations/{conversation}/members', [ChatController::class, 'members']);
        Route::post('chat/conversations/{conversation}/messages', [ChatController::class, 'send'])->middleware('throttle:120,1');
        Route::post('chat/conversations/{conversation}/read', [ChatController::class, 'markRead']);
        Route::post('chat/conversations/{conversation}/members', [ChatController::class, 'addMembers']);
        Route::delete('chat/conversations/{conversation}/members/{user}', [ChatController::class, 'removeMember']);
        Route::patch('chat/conversations/{conversation}', [ChatController::class, 'update']);

        /* Polls. Attached to a conversation, answered per person. */
        Route::post('chat/conversations/{conversation}/polls', [ChatController::class, 'createPoll']);
        Route::get('chat/polls/{poll}', [ChatController::class, 'showPoll']);
        Route::post('chat/polls/{poll}/vote', [ChatController::class, 'vote']);
        Route::patch('chat/polls/{poll}', [ChatController::class, 'updatePoll']);

        Route::patch('chat/messages/{message}', [ChatController::class, 'editMessage']);
        Route::delete('chat/messages/{message}', [ChatController::class, 'destroyMessage']);
        Route::post('chat/messages/{message}/react', [ChatController::class, 'react']);
        Route::post('chat/messages/{message}/forward', [ChatController::class, 'forward']);

        /* Attachments. Multipart in, an authorised stream back out — the
           download re-checks membership so a copied link is useless outside
           the room. */
        Route::post('chat/conversations/{conversation}/attachments', [ChatAttachmentController::class, 'store'])
            ->middleware('throttle:60,1');

        /* Typing rides its own route rather than the updates poll: it fires on
           a keystroke and must not drag the message payload along with it. */
        Route::post('chat/conversations/{conversation}/typing', [ChatController::class, 'typing'])
            ->middleware('throttle:240,1');
        Route::post('chat/conversations/{conversation}/pin', [ChatController::class, 'pin']);

        /* Getting a conversation out of the way.
         *
         * Archiving is per person and always available — it takes a thread off
         * your list and leaves everybody else's alone. Leaving and deleting
         * are the two that affect other people, so both are restricted: only a
         * group can be left, and only a group's own admin can delete one. */
        Route::post('chat/conversations/{conversation}/archive', [ChatController::class, 'archive']);
        Route::post('chat/conversations/{conversation}/leave', [ChatController::class, 'leave']);
        Route::delete('chat/conversations/{conversation}', [ChatController::class, 'destroyConversation']);
        Route::get('chat/conversations/{conversation}/search', [ChatController::class, 'searchMessages']);

        /* ---------------------- Process & Performance -----------------------

           Two tiers, and the split is the point.

           The project management routes are open to every signed-in employee:
           this is the tool the whole company works in, and a task nobody can
           reach is a task nobody does.

           The compliance routes below them are not. They hold assessments of
           the same people who use the tool above, and are gated by the
           `process-office` middleware — which answers 404, so the existence of
           an assessment is not disclosed to the person it is about. Hiding the
           menu in React is a courtesy; this is the control.
        */

        /* Everyone: projects and the work in them. */
        Route::get('process/directory', [ProjectController::class, 'directory']);
        Route::get('process/projects', [ProjectController::class, 'index']);
        Route::get('process/search', [ProjectController::class, 'search']);
        Route::post('process/projects', [ProjectController::class, 'store']);
        Route::get('process/projects/{project}', [ProjectController::class, 'show']);
        Route::match(['put', 'patch'], 'process/projects/{project}', [ProjectController::class, 'update']);
        Route::delete('process/projects/{project}', [ProjectController::class, 'destroy']);

        Route::post('process/projects/{project}/sections', [ProjectController::class, 'storeSection']);
        Route::patch('process/projects/{project}/sections/{section}', [ProjectController::class, 'updateSection']);
        Route::delete('process/projects/{project}/sections/{section}', [ProjectController::class, 'destroySection']);
        Route::post('process/projects/{project}/members', [ProjectController::class, 'syncMembers']);
        Route::post('process/projects/{project}/labels', [ProjectController::class, 'storeLabel']);
        Route::delete('process/projects/{project}/labels/{label}', [ProjectController::class, 'destroyLabel']);

        Route::get('process/projects/{project}/board', [TaskController::class, 'board']);
        Route::post('process/projects/{project}/tasks', [TaskController::class, 'store']);

        /* One person's queue. Never takes a user id — the signed-in account
           decides whose work comes back, the same rule the HR self-service
           routes follow. */
        /* My own delivery reviews.

           Outside the process-office group on purpose: this is the one part of
           the compliance layer a subject can reach, and only for verdicts the
           office has deliberately disclosed to them. Never takes a user id —
           the signed-in account decides whose reviews come back. */
        Route::get('me/compliance', [MyComplianceController::class, 'index']);
        Route::post('me/compliance/{review}/respond', [MyComplianceController::class, 'respond']);

        /* Recurrence, templates, time and goals.

           Open to everybody who can reach the board, because all four are part
           of doing the work rather than assessing it. Capacity is the one
           borderline case: it reads leave, but only the count of days, and a
           lead who cannot see who is free cannot plan. */
        Route::get('process/projects/{project}/recurrences', [ProcessExtrasController::class, 'recurrences']);
        Route::post('process/projects/{project}/recurrences', [ProcessExtrasController::class, 'storeRecurrence']);
        Route::patch('process/recurrences/{recurrence}', [ProcessExtrasController::class, 'updateRecurrence']);
        Route::delete('process/recurrences/{recurrence}', [ProcessExtrasController::class, 'destroyRecurrence']);
        Route::post('process/recurrences/run', [ProcessExtrasController::class, 'runRecurrences'])->middleware('throttle:6,1');

        Route::get('process/templates', [ProcessExtrasController::class, 'templates']);
        Route::post('process/projects/{project}/template', [ProcessExtrasController::class, 'saveTemplate']);
        Route::post('process/templates/{template}/create', [ProcessExtrasController::class, 'createFromTemplate']);
        Route::delete('process/templates/{template}', [ProcessExtrasController::class, 'destroyTemplate']);

        Route::get('process/capacity', [ProcessExtrasController::class, 'capacity']);

        Route::get('process/goals', [ProcessExtrasController::class, 'goals']);
        Route::post('process/goals', [ProcessExtrasController::class, 'storeGoal']);
        Route::patch('process/goals/{goal}', [ProcessExtrasController::class, 'updateGoal']);
        Route::delete('process/goals/{goal}', [ProcessExtrasController::class, 'destroyGoal']);

        /* Time. The timer is per person, so stop and current take no id. */
        Route::get('tasks/timer/current', [ProcessExtrasController::class, 'currentTimer']);
        Route::post('tasks/timer/stop', [ProcessExtrasController::class, 'stopTimer']);
        Route::post('tasks/{task}/timer/start', [ProcessExtrasController::class, 'startTimer']);
        Route::get('tasks/{task}/time', [ProcessExtrasController::class, 'timeEntries']);
        Route::post('tasks/{task}/time', [ProcessExtrasController::class, 'logTime']);
        Route::delete('process/time-entries/{entry}', [ProcessExtrasController::class, 'destroyTimeEntry']);

        Route::get('tasks/mine', [TaskController::class, 'mine']);
        Route::get('tasks', [TaskController::class, 'index']);

        Route::get('tasks/{task}', [TaskController::class, 'show']);
        Route::match(['put', 'patch'], 'tasks/{task}', [TaskController::class, 'update']);
        Route::delete('tasks/{task}', [TaskController::class, 'destroy']);
        Route::post('tasks/{task}/move', [TaskController::class, 'move']);
        Route::post('tasks/{task}/complete', [TaskController::class, 'complete']);
        Route::post('tasks/{task}/reopen', [TaskController::class, 'reopen']);
        Route::post('tasks/{task}/comments', [TaskController::class, 'comment'])->middleware('throttle:120,1');
        Route::post('tasks/{task}/attachments', [TaskController::class, 'attach'])->middleware('throttle:60,1');
        Route::delete('tasks/{task}/attachments/{attachment}', [TaskController::class, 'detach']);
        Route::post('tasks/{task}/dependencies', [TaskController::class, 'addDependency']);
        Route::delete('tasks/{task}/dependencies/{dependency}', [TaskController::class, 'removeDependency']);
        Route::post('tasks/{task}/nudge', [TaskController::class, 'nudge'])->middleware('throttle:30,1');

        /* The office only. Invisible to everyone the register describes. */
        Route::middleware('process-office')->group(function () {
            Route::get('process/compliance/dashboard', [ComplianceController::class, 'dashboard']);
            Route::get('process/compliance/metrics', [ComplianceController::class, 'metrics']);
            Route::get('process/compliance/flags', [ComplianceController::class, 'flags']);
            Route::post('process/compliance/flags/{flag}/acknowledge', [ComplianceController::class, 'acknowledgeFlag']);
            Route::post('process/compliance/flags/{flag}/resolve', [ComplianceController::class, 'resolveFlag']);
            Route::post('process/compliance/scan', [ComplianceController::class, 'scan'])->middleware('throttle:12,1');
            Route::get('process/compliance/queue', [ComplianceController::class, 'queue']);
            Route::get('process/compliance/reviews', [ComplianceController::class, 'reviews']);
            Route::post('process/compliance/reviews', [ComplianceController::class, 'evaluate']);
            Route::post('process/compliance/reviews/{review}/disclose', [ComplianceController::class, 'disclose']);
            Route::post('process/compliance/reviews/{review}/reply', [ComplianceController::class, 'replyToResponse']);
            Route::post('process/compliance/reviews/{review}/escalate', [ComplianceController::class, 'escalateToCase']);
            Route::get('process/compliance/scores', [ComplianceController::class, 'scores']);
            Route::get('process/compliance/subjects/{user}', [ComplianceController::class, 'subject']);
        });

        /* -------------------------------- Support ---------------------------

           Tickets, reachable by every signed-in account.

           Not behind the super-admin group even though an administrator is the
           one who resolves them: the whole point is that an employee raises a
           concern from their own account. The controller decides what each
           side sees — an administrator's query is every ticket, everybody
           else's is their own — and internal notes are stripped for the person
           who raised it.
        */
        Route::get('support/tickets', [SupportController::class, 'index']);
        Route::post('support/tickets', [SupportController::class, 'store'])->middleware('throttle:20,1');
        Route::get('support/tickets/{ticket}', [SupportController::class, 'show']);
        Route::patch('support/tickets/{ticket}', [SupportController::class, 'update']);
        Route::post('support/tickets/{ticket}/replies', [SupportController::class, 'reply'])->middleware('throttle:60,1');
        Route::post('support/tickets/{ticket}/attachments', [SupportController::class, 'attach'])->middleware('throttle:30,1');
        Route::post('support/tickets/{ticket}/resolve', [SupportController::class, 'resolve']);
        Route::post('support/tickets/{ticket}/close', [SupportController::class, 'close']);
        Route::post('support/tickets/{ticket}/reopen', [SupportController::class, 'reopen']);

        /* ------------------------------ Administration ---------------------

           Everything that changes how the system behaves rather than what it
           records: accounts and roles, approval thresholds, the audit trail,
           Geo-IP, backups, and the settings every other module obeys.

           Restricted to super administrators. This is the enforcement — the
           client also hides the menu, but that is a courtesy, not the control.
        */
        Route::middleware('super-admin')->group(function () {

            /* Settings */
            Route::get('settings/{group}', [SettingsController::class, 'show']);
            Route::put('settings/{group}', [SettingsController::class, 'update']);
            Route::post('settings/company/logo', [SettingsController::class, 'uploadLogo']);
            Route::post('settings/email/test', [SettingsController::class, 'testEmail'])->middleware('throttle:6,1');

            /* Which nav department each org-chart department may see. The
               on/off switch and the bypass-role list live in settings
               ('department_access' group) above; this is the per-department
               mapping itself. */
            Route::get('admin/department-access', [DepartmentAccessController::class, 'index']);
            Route::put('admin/department-access/{hrDepartment}', [DepartmentAccessController::class, 'update']);

            /* Audit trail integrity — walks the hash chain, does not
               touch any row. See AuditIntegrity. */
            Route::get('admin/audit-log/verify', [AuditController::class, 'verify']);

            /* Backup & restore */
            Route::get('admin/backups', [BackupController::class, 'index']);
            Route::post('admin/backups', [BackupController::class, 'store']);
            Route::post('admin/backups/upload', [BackupController::class, 'upload']);
            Route::post('admin/backups/clear', [BackupController::class, 'clearTransactional']);
            Route::get('admin/backups/{backup}/download', [BackupController::class, 'download']);
            Route::post('admin/backups/{backup}/restore', [BackupController::class, 'restore']);
            Route::delete('admin/backups/{backup}', [BackupController::class, 'destroy']);

            /* Issuing sign-in details. */
            Route::get('admin/credentials/reach', [CredentialController::class, 'reach']);
            Route::post('admin/credentials/send', [CredentialController::class, 'sendMany'])->middleware('throttle:6,1');
            Route::post('admin/users/{user}/credentials', [CredentialController::class, 'send'])->middleware('throttle:30,1');

            /* Geo-IP */
            Route::get('admin/geo-rules/current', [GeoRuleController::class, 'current']);
            Route::get('admin/geo-rules/presets', [GeoRuleController::class, 'presets']);
            Route::get('admin/geo-rules', [GeoRuleController::class, 'index']);
            Route::post('admin/geo-rules', [GeoRuleController::class, 'store']);
            Route::patch('admin/geo-rules/{geoRule}', [GeoRuleController::class, 'update']);
            Route::delete('admin/geo-rules/{geoRule}', [GeoRuleController::class, 'destroy']);

            /* "Log in as" — seeing the app exactly as one real user sees it. */
            Route::get('admin/impersonation/users', [ImpersonationController::class, 'index']);
            Route::post('admin/impersonation/{user}/start', [ImpersonationController::class, 'start']);

            /* The registry-backed admin lists — users, roles, approval rules,
               the audit log, the email log. Declared here rather than left to
               the catch-all below, which would serve them to anybody. */
            Route::get('admin/{resource}', function (Request $request, string $resource, ResourceController $controller) {
                return $controller->index($request, "admin/{$resource}");
            })->where('resource', '[a-z-]+');

            Route::get('admin/{resource}/{id}', function (Request $request, string $resource, int $id, ResourceController $controller) {
                return $controller->show($request, "admin/{$resource}", $id);
            })->where(['resource' => '[a-z-]+', 'id' => '[0-9]+']);

            Route::post('admin/{resource}', function (Request $request, string $resource, ResourceController $controller) {
                return $controller->store($request, "admin/{$resource}");
            })->where('resource', '[a-z-]+');

            Route::match(['put', 'patch'], 'admin/{resource}/{id}', function (Request $request, string $resource, int $id, ResourceController $controller) {
                return $controller->update($request, "admin/{$resource}", $id);
            })->where(['resource' => '[a-z-]+', 'id' => '[0-9]+']);

            Route::delete('admin/{resource}/{id}', function (Request $request, string $resource, int $id, ResourceController $controller) {
                return $controller->destroy($request, "admin/{$resource}", $id);
            })->where(['resource' => '[a-z-]+', 'id' => '[0-9]+']);
        });

        /* Registry-backed lists — must stay last. */
        Route::get('{module}/{resource}', function (Request $request, string $module, string $resource, ResourceController $controller) {
            return $controller->index($request, "{$module}/{$resource}");
        })->where(['module' => '[a-z-]+', 'resource' => '[a-z-]+']);

        Route::get('{module}/{resource}/{id}', function (Request $request, string $module, string $resource, int $id, ResourceController $controller) {
            return $controller->show($request, "{$module}/{$resource}", $id);
        })->where(['module' => '[a-z-]+', 'resource' => '[a-z-]+', 'id' => '[0-9]+']);

        Route::post('{module}/{resource}', function (Request $request, string $module, string $resource, ResourceController $controller) {
            return $controller->store($request, "{$module}/{$resource}");
        })->where(['module' => '[a-z-]+', 'resource' => '[a-z-]+']);

        Route::match(['put', 'patch'], '{module}/{resource}/{id}', function (Request $request, string $module, string $resource, int $id, ResourceController $controller) {
            return $controller->update($request, "{$module}/{$resource}", $id);
        })->where(['module' => '[a-z-]+', 'resource' => '[a-z-]+', 'id' => '[0-9]+']);

        Route::delete('{module}/{resource}/{id}', function (Request $request, string $module, string $resource, int $id, ResourceController $controller) {
            return $controller->destroy($request, "{$module}/{$resource}", $id);
        })->where(['module' => '[a-z-]+', 'resource' => '[a-z-]+', 'id' => '[0-9]+']);
    });
});
