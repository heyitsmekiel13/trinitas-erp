<?php
/**
 * HR QA sweep.
 *
 * Exercises every HR endpoint through the real controllers, including the
 * moves that must be refused. Recruitment and performance start empty by
 * design, so the sweep creates its own work through the same write endpoints
 * the screens use — which makes the creation path part of the test rather
 * than a shortcut around it. Everything rolls back.
 */

use App\Http\Controllers\Api\{RecruitmentController, ResourceController};
use App\Models\{Applicant, BranchUnit, Employee, HrDepartment, PayrollGroup, PerformanceReview, Position, User};
use App\Services\PerformanceOperations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

$pass = 0; $fail = 0; $fails = [];
$check = function (string $what, bool $ok, string $detail = '') use (&$pass, &$fail, &$fails) {
    if ($ok) { $pass++; echo "  ok   $what\n"; }
    else { $fail++; $fails[] = $what . ($detail ? " — $detail" : ''); echo "  FAIL $what" . ($detail ? " — $detail" : '') . "\n"; }
};

$user = User::first();
if (!$user) { echo "no user seeded\n"; exit(1); }
auth()->login($user);

$body = function ($res) {
    $b = json_decode($res->getContent(), true);
    return $b['data'] ?? $b;
};

$asUser = function (Request $req) use ($user) {
    $req->setUserResolver(fn () => $user);
    return $req;
};

DB::beginTransaction();

$resource = app(ResourceController::class);
$rc = app(RecruitmentController::class);
$ops = app(PerformanceOperations::class);

/* ---------------------------------------------------------------- registry */
echo "\n== HR registry endpoints ==\n";
$hrEndpoints = array_values(array_filter(
    array_keys(config('erp.resources')),
    fn ($k) => str_starts_with($k, 'hr/'),
));
echo "  " . count($hrEndpoints) . " HR endpoints registered\n";

foreach ($hrEndpoints as $ep) {
    try {
        $res = $resource->index($asUser(Request::create('/api/' . $ep, 'GET')), $ep);
        $rows = $body($res);
        $ok = $res->getStatusCode() === 200 && is_array($rows);
        $check(sprintf('%-24s %4d rows', $ep, is_array($rows) ? count($rows) : -1), $ok,
            $ok ? '' : 'status ' . $res->getStatusCode());
    } catch (\Throwable $e) {
        $check(sprintf('%-24s', $ep), false, get_class($e) . ': ' . $e->getMessage());
    }
}

/* --------------------------------------------------------------- fixtures */
echo "\n== fixtures, built through the write endpoints ==\n";

$reqRow = null;
try {
    $res = $resource->store($asUser(Request::create('/api/hr/requisitions', 'POST', [
        'positionId' => Position::first()->id,
        'departmentId' => HrDepartment::first()->id,
        'branchId' => BranchUnit::first()->id,
        'headcount' => 3,
        'neededBy' => now()->addMonth()->toDateString(),
        'budgetRate' => 18000,
        'status' => 'Approved',
    ])), 'hr/requisitions');
    $reqRow = $body($res);
    $check('manpower request created', !empty($reqRow['id']), json_encode($reqRow));
    $check('requisition reports 3 open seats', (int) ($reqRow['openings'] ?? -1) === 3,
        var_export($reqRow['openings'] ?? null, true));
    $check('requisition numbered MRF-yyyy-nnnn', (bool) preg_match('/^MRF-\d{4}-\d{4}$/', (string) ($reqRow['no'] ?? '')),
        (string) ($reqRow['no'] ?? ''));
} catch (\Throwable $e) {
    $check('manpower request created', false, $e->getMessage());
}

if ($reqRow) {
    foreach (['Ana Reyes', 'Ben Cruz', 'Cora Diaz'] as $n) {
        try {
            $resource->store($asUser(Request::create('/api/hr/applicants', 'POST', [
                'name' => $n,
                'email' => strtolower(str_replace(' ', '.', $n)) . '@example.test',
                'positionId' => Position::first()->id,
                'requisitionId' => (int) $reqRow['id'],
                'source' => 'Referral',
                'applied' => now()->subDays(9)->toDateString(),
                'expectedSalary' => 17000,
            ])), 'hr/applicants');
        } catch (\Throwable $e) {
            $check("applicant $n created", false, $e->getMessage());
        }
    }
    $check('three applicants created',
        Applicant::whereNotIn('stage', ['Hired', 'Rejected'])->count() >= 3);
}

/* ------------------------------------------------------------- recruitment */
echo "\n== recruitment ==\n";

$pipeline = $body($rc->pipeline());
$check('pipeline returns stages', !empty($pipeline['stages']));
$check('pipeline has no Hired column', !in_array('Hired', array_column($pipeline['stages'] ?? [], 'stage'), true));
$check('oldestDays is a whole number',
    array_reduce($pipeline['stages'] ?? [], fn ($c, $s) => $c && is_int($s['oldestDays']), true));
$check('pipeline counts the new applicants', ($pipeline['active'] ?? 0) >= 3, (string) ($pipeline['active'] ?? 0));
$check('pipeline reports the open vacancy', ($pipeline['openRequisitions'] ?? 0) >= 1);
$check('pipeline reports seats to fill', ($pipeline['seatsToFill'] ?? 0) >= 3, (string) ($pipeline['seatsToFill'] ?? 0));
$check('oldest applicant aged in whole days',
    ($pipeline['stages'][0]['oldestDays'] ?? 0) === 9, (string) ($pipeline['stages'][0]['oldestDays'] ?? 0));

$applicant = Applicant::whereNotIn('stage', ['Hired', 'Rejected'])->first();
$detail = $body($rc->applicant($applicant));
$check('applicant detail loads', ($detail['id'] ?? null) === $applicant->id);
$check('applicant exposes allowedMoves', is_array($detail['allowedMoves'] ?? null));
$check('allowedMoves never offers Hired', !in_array('Hired', $detail['allowedMoves'] ?? [], true));

$target = $detail['allowedMoves'][0] ?? null;
$res = $rc->moveApplicant(Request::create('/x', 'POST', ['stage' => $target]), $applicant);
$check("legal move Applied -> $target accepted", $res->getStatusCode() === 200, 'status ' . $res->getStatusCode());
$check('stage actually changed', $applicant->fresh()->stage === $target);

$res = $rc->moveApplicant(Request::create('/x', 'POST', ['stage' => 'Hired']), $applicant->fresh());
$check('illegal jump to Hired refused with 422', $res->getStatusCode() === 422, 'status ' . $res->getStatusCode());

$res = $rc->moveApplicant(Request::create('/x', 'POST', ['stage' => 'Nonsense']), $applicant->fresh());
$check('unknown stage refused with 422', $res->getStatusCode() === 422, 'status ' . $res->getStatusCode());

// Walking the full pipeline, one legal step at a time.
$a = $applicant->fresh();
$walked = [$a->stage];
$guard = 0;
while ($a->stage !== 'Offer' && $guard++ < 10) {
    $moves = app(\App\Services\RecruitmentOperations::class)->allowedMoves($a);
    $forward = $moves[0] ?? null;
    if (!$forward || $forward === 'Rejected') break;
    $res = $rc->moveApplicant(Request::create('/x', 'POST', ['stage' => $forward]), $a);
    if ($res->getStatusCode() !== 200) break;
    $a = $a->fresh();
    $walked[] = $a->stage;
}
$check('pipeline walks Applied -> Offer', $a->stage === 'Offer', implode(' -> ', $walked));

// Rejection, and putting somebody back.
$rejectMe = Applicant::whereNotIn('stage', ['Hired', 'Rejected'])->where('id', '!=', $a->id)->first();
$res = $rc->moveApplicant(Request::create('/x', 'POST', ['stage' => 'Rejected']), $rejectMe);
$check('rejection accepted from any stage', $res->getStatusCode() === 200);
$res = $rc->moveApplicant(Request::create('/x', 'POST', ['stage' => 'Applied']), $rejectMe->fresh());
$check('a rejection can be undone', $res->getStatusCode() === 200 && $rejectMe->fresh()->stage === 'Applied');

// Hiring.
$before = Employee::count();
$filledBefore = $a->jobRequisition->filled;
$payload = ['firstName' => 'QA', 'lastName' => 'Hire' . random_int(1000, 9999), 'payrollGroupId' => PayrollGroup::first()?->id];
$res = $rc->hire(Request::create('/x', 'POST', $payload), $a);
$out = $body($res);
$check('hire returns 201', $res->getStatusCode() === 201,
    'status ' . $res->getStatusCode() . ' ' . ($out['message'] ?? ''));

if ($res->getStatusCode() === 201) {
    $check('a 201 file was created', Employee::count() === $before + 1);
    $check('employee number follows the existing pattern',
        (bool) preg_match('/^[A-Za-z\-]*\d+$/', $out['employee']['employeeNo'] ?? ''),
        $out['employee']['employeeNo'] ?? 'none');
    $check('sign-in credentials issued once', !empty($out['credentials']));
    $check('applicant moved to Hired', $a->fresh()->stage === 'Hired');
    $check('requisition seat counted', $a->jobRequisition->fresh()->filled === $filledBefore + 1);
    $check('requisition moved to Sourcing with seats left',
        $a->jobRequisition->fresh()->status === 'Sourcing', $a->jobRequisition->fresh()->status);

    $res2 = $rc->hire(Request::create('/x', 'POST', $payload), $a->fresh());
    $check('double hire refused with 422', $res2->getStatusCode() === 422, 'status ' . $res2->getStatusCode());
}

$other = Applicant::whereNotIn('stage', ['Hired', 'Rejected'])->whereHas('jobRequisition')->first();
if ($other) {
    $res3 = $rc->hire(Request::create('/x', 'POST', ['firstName' => 'QA', 'lastName' => 'NoGroup']), $other);
    $check('hire without a payroll group refused with 422', $res3->getStatusCode() === 422,
        'status ' . $res3->getStatusCode());

    $rc->moveApplicant(Request::create('/x', 'POST', ['stage' => 'Rejected']), $other);
    $res4 = $rc->hire(Request::create('/x', 'POST', $payload + ['lastName' => 'Rejected' . random_int(100, 999)]), $other->fresh());
    $check('hiring a rejected applicant refused with 422', $res4->getStatusCode() === 422,
        'status ' . $res4->getStatusCode());
}

/* ------------------------------------------------------------- performance */
echo "\n== performance ==\n";

$activeStaff = Employee::whereNull('date_separated')->count();
$period = 'QA-' . random_int(10000, 99999);

$res = $rc->openCycle(Request::create('/x', 'POST', [
    'period' => $period, 'dueDate' => now()->addMonth()->toDateString(),
]));
$cycle = $body($res);
$check('cycle opens with 201', $res->getStatusCode() === 201, 'status ' . $res->getStatusCode());
$check('one review per active employee', ($cycle['created'] ?? 0) === $activeStaff,
    ($cycle['created'] ?? 0) . ' created for ' . $activeStaff . ' active staff');
$check('reviewer taken from the reporting line',
    PerformanceReview::where('period', $period)->whereNotNull('reviewer_id')->count()
        === $activeStaff - ($cycle['noReviewer'] ?? 0));
$check('new reviews start unscored',
    PerformanceReview::where('period', $period)->whereNotNull('score')->count() === 0);
$check('separated staff are excluded',
    PerformanceReview::where('period', $period)
        ->whereHas('employee', fn ($q) => $q->whereNotNull('date_separated'))->count() === 0);

$again = $body($rc->openCycle(Request::create('/x', 'POST', ['period' => $period])));
$check('re-running the cycle creates nothing', ($again['created'] ?? -1) === 0, ($again['created'] ?? -1) . ' created');
$check('re-running reports everyone skipped', ($again['skipped'] ?? 0) === $activeStaff);

$dept = HrDepartment::first();
$deptPeriod = 'QA-DEPT-' . random_int(10000, 99999);
$deptResult = $body($rc->openCycle($asUser(Request::create('/x', 'POST', [
    'period' => $deptPeriod, 'departmentId' => $dept->id,
]))));
$deptStaff = Employee::whereNull('date_separated')->where('hr_department_id', $dept->id)->count();
$check('department scope opens only that department', ($deptResult['created'] ?? -1) === $deptStaff,
    ($deptResult['created'] ?? -1) . ' created for ' . $deptStaff . ' in ' . $dept->name);

$summary = $body($rc->performanceSummary());
foreach (['total', 'completed', 'inProgress', 'notStarted', 'overdue', 'byRating'] as $k) {
    $check("summary.$k present", array_key_exists($k, $summary));
}
$check('summary totals reconcile',
    ($summary['completed'] ?? 0) + ($summary['inProgress'] ?? 0) + ($summary['notStarted'] ?? 0) === ($summary['total'] ?? -1),
    sprintf('%d + %d + %d != %d', $summary['completed'] ?? 0, $summary['inProgress'] ?? 0,
        $summary['notStarted'] ?? 0, $summary['total'] ?? 0));
$check('average score ignores unscored reviews', ($summary['averageScore'] ?? null) === null,
    var_export($summary['averageScore'] ?? null, true));

$review = PerformanceReview::where('period', $period)->first();
$d = $body($rc->review($review));
$check('review detail loads', ($d['id'] ?? null) === $review->id);
$check('an unscored review projects no rating',
    array_key_exists('projectedRating', $d) && $d['projectedRating'] === null,
    var_export($d['projectedRating'] ?? 'missing', true));

$res = $rc->scoreReview(Request::create('/x', 'POST', ['score' => 4.7]), $review);
$scored = $body($res);
$check('score accepted', $res->getStatusCode() === 200);
$check('projected rating derived from score', ($scored['projectedRating'] ?? null) === 'Outstanding',
    (string) ($scored['projectedRating'] ?? 'null'));
$check('rating withheld until the cycle closes',
    array_key_exists('rating', $scored) && $scored['rating'] === null,
    var_export($scored['rating'] ?? null, true));

try {
    $rc->scoreReview(Request::create('/x', 'POST', ['score' => 9]), $review->fresh());
    $check('score above 5 refused', false, 'accepted');
} catch (ValidationException $e) {
    $check('score above 5 refused', true);
}

$r = $review->fresh();
$guard = 0;
while ($r->status !== 'Completed' && $guard++ < 8) {
    $moves = $ops->allowedMoves($r);
    $forward = $moves[0] ?? null;
    if (!$forward) break;
    $res = $rc->moveReview(Request::create('/x', 'POST', ['status' => $forward]), $r);
    if ($res->getStatusCode() !== 200) { $check("move to $forward accepted", false, 'status ' . $res->getStatusCode()); break; }
    $r = $r->fresh();
}
$check('review reached Completed through the cycle', $r->status === 'Completed', $r->status);
$check('band settled from the score on completion', $r->rating === 'Outstanding', (string) $r->rating);

$res = $rc->moveReview(Request::create('/x', 'POST', ['status' => 'Calibration']), $r);
$check('a completed review cannot be reopened', $res->getStatusCode() === 422, 'status ' . $res->getStatusCode());

// The defect this sweep was written for: an unassessed review must not be
// completable, and must never settle a band from an absent score.
$unscored = PerformanceReview::where('period', $period)->where('id', '!=', $review->id)->whereNull('score')->first();
$u = $unscored;
$guard = 0;
while ($u->status !== 'Calibration' && $guard++ < 8) {
    $moves = $ops->allowedMoves($u);
    if (!$moves || $moves[0] === 'Completed') break;
    $u = $ops->moveTo($u, $moves[0]);
}
$res = $rc->moveReview(Request::create('/x', 'POST', ['status' => 'Completed']), $u);
$check('completing an unscored review refused with 422', $res->getStatusCode() === 422, 'status ' . $res->getStatusCode());
$check('the refused review kept no rating', $u->fresh()->rating === null, (string) $u->fresh()->rating);

// A deliberate zero is a decision and must still be allowed through.
$ops->score($u->fresh(), 0.0, null, null);
$z = $ops->moveTo($u->fresh(), 'Completed');
$check('a deliberate score of zero still completes', $z->status === 'Completed' && $z->rating === 'Unsatisfactory',
    $z->status . '/' . $z->rating);

/* -------------------------------------------------------- rating band edges */
echo "\n== rating bands ==\n";
foreach ([[5.0,'Outstanding'],[4.5,'Outstanding'],[4.49,'Exceeds Expectations'],[3.5,'Exceeds Expectations'],
          [3.49,'Meets Expectations'],[2.5,'Meets Expectations'],[2.49,'Needs Improvement'],[1.5,'Needs Improvement'],
          [1.49,'Unsatisfactory'],[0.0,'Unsatisfactory']] as [$score, $expect]) {
    $check("score $score => $expect", $ops->ratingFor($score) === $expect, (string) $ops->ratingFor($score));
}
$check('an unscored review has no rating', $ops->ratingFor(null) === null);

DB::rollBack();

echo "\n== result ==\n";
echo "  $pass passed, $fail failed\n";
foreach ($fails as $f) echo "  - $f\n";
