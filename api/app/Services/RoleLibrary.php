<?php

namespace App\Services;

use App\Models\JobRequisition;
use App\Models\Position;

/**
 * Writing the advert, so that nobody has to start from a blank box.
 *
 * A manpower request already knows the role, the department, the branch, the
 * headcount and the budget. An advert for that role is then typed from
 * nothing, by whoever raised it, at the end of a form. In practice that
 * produces one of two things: an empty posting with a title and no body, or
 * three lines copied off the last one. Both are why a vacancy sits unfilled.
 *
 * So this drafts it. Each role family carries the shape a competent advert for
 * that job has — what the person actually does, what is genuinely required
 * versus what is nice to have, and what the package is — and the level is read
 * from the job title so a Supervisor's advert asks for supervisory experience
 * and a Clerk's does not.
 *
 * Three things it is careful about.
 *
 * The qualifications are written the way the assessment reads them. "At least
 * three years in a supervisory role" and "Graduate of a four-year course" are
 * both phrasings `CandidateAssessment` parses into a number and an ordinal, so
 * an advert drafted here is one the screening can actually score against.
 * Free prose looks the same to a person and is invisible to the matcher.
 *
 * The benefits are the statutory floor plus what a Philippine employer of this
 * size actually offers — SSS, PhilHealth, Pag-IBIG, 13th month and the five
 * days of service incentive leave are legal minimums, not perks, and an advert
 * that lists them as selling points reads as though the company thinks
 * complying is generous. They are stated plainly and the real extras are
 * listed separately.
 *
 * The salary band is **indicative and labelled as such**. Where the requisition
 * carries an approved budget rate, that figure wins outright — it is this
 * company's own number for this seat. The library's range is only a starting
 * point for when there is none, and the caller is told which of the two it
 * got, because publishing a made-up band is worse than publishing none.
 */
class RoleLibrary
{
    /**
     * What a Philippine employer is legally obliged to provide.
     *
     * Kept apart from the perks deliberately. These are not benefits, they are
     * the law, and mixing them in with an HMO makes an advert sound like it is
     * boasting about paying SSS.
     */
    private const STATUTORY = [
        'SSS, PhilHealth and Pag-IBIG from day one',
        '13th month pay',
        'Five days of service incentive leave a year',
    ];

    /**
     * The role families, and what a good advert for each one says.
     *
     * `match` is checked against the lower-cased job title in order, so the
     * more specific families are listed first — "quality assurance" has to be
     * tested before "assurance" would ever reach the production family.
     *
     * `rate` is an indicative monthly band for the entry level of that family
     * in a Philippine provincial city, widened by the level multiplier below.
     * It is a starting point for a conversation, never a published figure on
     * its own.
     */
    private function families(): array
    {
        return [
            'accounting' => [
                'match' => ['account', 'bookkeep', 'audit', 'finance', 'treasur', 'payable', 'receivable', 'cpa', 'comptroller'],
                'noun' => 'accounting',
                'summary' => 'Keeping the books right and the filings on time — the day-to-day posting, the reconciliations, and the returns that have to be correct before they are due.',
                'does' => [
                    'Post and reconcile daily transactions, and keep the subsidiary ledgers agreeing with the general ledger',
                    'Prepare the monthly financial statements and the supporting schedules',
                    'File BIR returns on time and keep the supporting documents together',
                    'Reconcile bank accounts and settle the differences rather than carrying them forward',
                    'Prepare and check the accounts payable and receivable ageing',
                ],
                'wants' => [
                    'Graduate of BS Accountancy, Accounting Technology, or a related four-year course',
                    'Working knowledge of BIR filing and Philippine statutory reporting',
                    'Proficient in Microsoft Excel, and comfortable in an accounting system',
                ],
                'nice' => ['CPA licence', 'Experience in a food or manufacturing business'],
                'rate' => [18000, 26000],
            ],

            'quality' => [
                'match' => ['quality', 'qa ', 'qc ', 'food safety', 'haccp', 'sanitat', 'laborator'],
                'noun' => 'quality assurance',
                'summary' => 'Making sure what leaves the plant is safe and consistent — inspection, documentation, and the corrective action when something is not right.',
                'does' => [
                    'Inspect incoming materials, work in process and finished goods against specification',
                    'Maintain HACCP and GMP records, and keep them audit-ready rather than reconstructing them',
                    'Raise, investigate and close non-conformances, and verify the corrective action held',
                    'Run and document sanitation verification and product hold or release decisions',
                    'Support regulatory and customer audits',
                ],
                'wants' => [
                    'Graduate of BS Food Technology, Chemistry, Biology, Nutrition or a related four-year course',
                    'Working knowledge of GMP, HACCP and food safety documentation',
                    'Comfortable writing up an inspection clearly enough for somebody else to act on it',
                ],
                'nice' => ['Food safety or HACCP certification', 'Internal auditor training'],
                'rate' => [16000, 24000],
            ],

            'warehouse' => [
                'match' => ['warehouse', 'inventor', 'stock', 'storekeep', 'checker', 'picker', 'forklift', 'material'],
                'noun' => 'warehouse',
                'summary' => 'Keeping the stock record and the physical stock the same thing — receiving, put-away, picking, and counts that actually reconcile.',
                'does' => [
                    'Receive deliveries against the purchase order and the delivery receipt, and report the differences',
                    'Put away, pick and stage goods so that what the system says is on the shelf is on the shelf',
                    'Run cycle counts and investigate variances rather than adjusting them away',
                    'Keep first-expiry-first-out discipline and flag anything approaching its date',
                    'Keep the storage area clean, safe and passable',
                ],
                'wants' => [
                    'At least a senior high school graduate; a four-year course is an advantage',
                    'Physically able to work on a warehouse floor for a full shift',
                    'Careful with numbers and with paperwork under time pressure',
                ],
                'nice' => ['Forklift certification', 'Experience with a warehouse or inventory system'],
                'rate' => [14000, 19000],
            ],

            'logistics' => [
                'match' => ['driver', 'delivery', 'logistic', 'dispatch', 'fleet', 'trucking', 'rider'],
                'noun' => 'logistics',
                'summary' => 'Getting the goods there — on the route, on time, and with the paperwork that proves it.',
                'does' => [
                    'Run the assigned route and complete deliveries within the committed window',
                    'Check the load against the delivery receipt before leaving and on arrival',
                    'Secure the customer signature and return the documents complete',
                    'Carry out the daily vehicle checks and report defects before they become breakdowns',
                    'Keep fuel and trip records accurate',
                ],
                'wants' => [
                    'At least a senior high school graduate',
                    'Valid professional driver\'s licence with the restriction codes the role needs',
                    'Clean driving record and familiar with the routes in the service area',
                ],
                'nice' => ['Experience delivering chilled or frozen goods', 'Basic vehicle troubleshooting'],
                'rate' => [14000, 20000],
            ],

            'sales' => [
                'match' => ['sales', 'account executive', 'business development', 'merchandis', 'territory', 'key account'],
                'noun' => 'sales',
                'summary' => 'Growing the territory — opening accounts, keeping the ones we have, and hitting a number that is agreed rather than hoped for.',
                'does' => [
                    'Hit the agreed monthly sales and collection targets for the assigned territory',
                    'Call on existing accounts regularly and open new ones',
                    'Take orders accurately and follow them through to delivery and payment',
                    'Keep the customer records and the call reports current',
                    'Report on competitor activity and pricing in the field',
                ],
                'wants' => [
                    'Graduate of a four-year course, preferably in Business, Marketing or a related field',
                    'Willing to do fieldwork across the assigned territory',
                    'Comfortable with targets, and able to explain a shortfall rather than hide it',
                ],
                'nice' => ['Own motorcycle and a valid licence', 'Existing trade relationships in the area'],
                'rate' => [16000, 24000],
            ],

            'it' => [
                'match' => ['it ', 'i.t.', 'information technology', 'developer', 'programmer', 'software', 'system', 'network', 'data analyst', 'help desk', 'technical support', 'it support'],
                'noun' => 'IT',
                'summary' => 'Keeping the systems people depend on working, and improving them without breaking them.',
                'does' => [
                    'Support users and resolve incidents within the agreed response times',
                    'Maintain and monitor systems, networks and backups',
                    'Implement changes with a tested rollback, not with hope',
                    'Document configurations and procedures so somebody else can pick them up',
                    'Support the rollout of new systems and the training that goes with it',
                ],
                'wants' => [
                    'Graduate of BS Information Technology, Computer Science or a related four-year course',
                    'Sound troubleshooting, and able to explain a technical problem in plain terms',
                    'Comfortable with Windows, networking basics and databases',
                ],
                'nice' => ['Experience with an ERP', 'Relevant vendor certification'],
                'rate' => [18000, 30000],
            ],

            'customer-service' => [
                'match' => ['customer service', 'customer support', 'csr', 'help desk', 'call center', 'call centre', 'reception', 'front desk', 'telemarket'],
                'noun' => 'customer service',
                'summary' => 'Being the person customers reach — answering properly the first time, and chasing what you cannot answer yourself.',
                'does' => [
                    'Handle customer enquiries, orders and complaints across phone, email and chat',
                    'Resolve what can be resolved, and escalate the rest with the full context attached',
                    'Keep every interaction logged so the next person is not starting from nothing',
                    'Follow up on open cases until they are actually closed',
                    'Flag recurring complaints rather than handling each one as new',
                ],
                'wants' => [
                    'Graduate of a four-year course, or an equivalent mix of study and experience',
                    'Clear written and spoken English and Filipino',
                    'Patient under pressure, and accurate when busy',
                ],
                'nice' => ['Experience with a CRM or ticketing system', 'Cebuano or another local language'],
                'rate' => [15000, 22000],
            ],

            'hr' => [
                'match' => ['human resource', 'hr ', 'recruit', 'talent', 'payroll', 'timekeep', 'people'],
                'noun' => 'human resources',
                'summary' => 'Looking after the people record and the processes around it — hiring, timekeeping, payroll input, and the parts of employment that have to be done exactly right.',
                'does' => [
                    'Run the end-to-end hiring process for assigned vacancies, from sourcing to offer',
                    'Keep 201 files complete and current, including statutory registrations',
                    'Process timekeeping and payroll inputs accurately and to the cut-off',
                    'Administer leave, benefits and employee movements',
                    'Support employee relations cases and keep the due-process record straight',
                ],
                'wants' => [
                    'Graduate of BS Psychology, Human Resource Management, Business or a related four-year course',
                    'Working knowledge of Philippine labour law and statutory requirements',
                    'Discreet with confidential information, and precise with records',
                ],
                'nice' => ['Experience with an HRIS or payroll system', 'CHRP or equivalent training'],
                'rate' => [16000, 24000],
            ],

            'production' => [
                'match' => ['production', 'manufactur', 'operator', 'machine', 'packag', 'process', 'plant', 'line lead'],
                'noun' => 'production',
                'summary' => 'Running the line — output to plan, to specification, and safely.',
                'does' => [
                    'Run the assigned line or process to the daily production plan',
                    'Follow the standard operating procedure and the batch record without shortcuts',
                    'Record output, downtime and yield accurately as it happens',
                    'Carry out line clearance, changeover and basic equipment checks',
                    'Report deviations, defects and safety hazards immediately',
                ],
                'wants' => [
                    'At least a senior high school or vocational graduate',
                    'Able to work shifts, including overtime when the plan requires it',
                    'Careful with procedure and with recording what was actually done',
                ],
                'nice' => ['Food manufacturing experience', 'TESDA National Certificate in a relevant trade'],
                'rate' => [14000, 19000],
            ],

            'maintenance' => [
                'match' => ['maintenance', 'technician', 'mechanic', 'electric', 'refrigerat', 'hvac', 'welder', 'utility', 'engineer'],
                'noun' => 'maintenance',
                'summary' => 'Keeping the equipment running — planned maintenance done properly, and breakdowns fixed at the cause rather than the symptom.',
                'does' => [
                    'Carry out the preventive maintenance schedule and record what was actually done',
                    'Respond to breakdowns, diagnose the cause and repair it',
                    'Keep critical spares identified and requested before they are needed',
                    'Support installation, commissioning and relocation of equipment',
                    'Work to lock-out/tag-out and the site safety rules, every time',
                ],
                'wants' => [
                    'Vocational or engineering graduate in a relevant trade',
                    'Able to read equipment manuals, schematics and parts diagrams',
                    'Willing to be called for urgent breakdowns',
                ],
                'nice' => ['TESDA National Certificate in the relevant trade', 'Refrigeration or food-plant equipment experience'],
                'rate' => [15000, 23000],
            ],

            'procurement' => [
                'match' => ['procure', 'purchas', 'buyer', 'sourcing', 'supplier', 'vendor'],
                'noun' => 'procurement',
                'summary' => 'Buying what the business needs at a defensible price, from suppliers who actually deliver.',
                'does' => [
                    'Turn approved requisitions into orders, at the agreed terms',
                    'Canvass and compare suppliers, and keep the basis of the award on file',
                    'Follow up deliveries and hold suppliers to their commitments',
                    'Maintain supplier records, price lists and contracts',
                    'Match invoices against orders and receipts before they are passed for payment',
                ],
                'wants' => [
                    'Graduate of a four-year course in Business, Supply Chain, Engineering or a related field',
                    'Comfortable negotiating, and able to document why a supplier was chosen',
                    'Proficient in Microsoft Excel',
                ],
                'nice' => ['Experience buying food ingredients or packaging', 'Familiar with an ERP purchasing module'],
                'rate' => [16000, 24000],
            ],

            'admin' => [
                'match' => ['admin', 'clerk', 'encoder', 'secretar', 'assistant', 'staff', 'coordinator', 'liaison'],
                'noun' => 'administrative',
                'summary' => 'Keeping the office running — the records, the paperwork and the follow-through that everything else depends on.',
                'does' => [
                    'Maintain records and filing so that anything can be found when it is asked for',
                    'Encode and check data accurately and to the deadline',
                    'Prepare routine reports, correspondence and documentation',
                    'Coordinate with other departments and follow items through to closure',
                    'Handle office supplies, schedules and general administrative support',
                ],
                'wants' => [
                    'Graduate of a four-year course, or an equivalent mix of study and experience',
                    'Proficient in Microsoft Excel and Word',
                    'Accurate, organised, and able to keep several things moving at once',
                ],
                'nice' => ['Experience in a similar role', 'Familiar with an ERP or document system'],
                'rate' => [14000, 19000],
            ],
        ];
    }

    /**
     * How the job title changes what the advert asks for.
     *
     * Years and the education floor both move with seniority, and the salary
     * band moves with them. A Supervisor advert that asks for no supervisory
     * experience is the single most common fault in a hastily written posting.
     */
    private const LEVELS = [
        'Director' => [
            'match' => ['director', 'vp', 'vice president', 'chief', 'president', 'general manager'],
            'years' => 8, 'multiplier' => 3.2, 'education' => 'Bachelor',
            'lead' => 'Set the direction for the function and be accountable for its results',
        ],
        'Manager' => [
            'match' => ['manager', 'head', 'superintendent', 'principal'],
            'years' => 5, 'multiplier' => 2.2, 'education' => 'Bachelor',
            'lead' => 'Manage the team, the budget and the performance of the function',
        ],
        'Mid-Senior' => [
            'match' => ['supervisor', 'lead', 'senior', 'sr.', 'foreman', 'chief '],
            'years' => 3, 'multiplier' => 1.5, 'education' => 'Bachelor',
            'lead' => 'Supervise the team day to day, and answer for its output',
        ],
        'Associate' => [
            'match' => ['specialist', 'analyst', 'officer', 'associate', 'executive', 'engineer', 'technician'],
            'years' => 2, 'multiplier' => 1.2, 'education' => 'Bachelor',
            'lead' => null,
        ],
        'Entry level' => [
            'match' => [],
            'years' => 0, 'multiplier' => 1.0, 'education' => null,
            'lead' => null,
        ],
    ];

    /**
     * Drafts an advert for a role.
     *
     * @return array<string, mixed>
     */
    public function draft(?Position $position, ?JobRequisition $requisition = null, ?string $title = null): array
    {
        $title = trim($title ?: ($position->title ?? $requisition?->position->title ?? 'Vacancy'));
        $lower = mb_strtolower($title);

        $level = $this->levelFor($lower);
        $family = $this->familyFor($lower);

        $spec = $this->families()[$family];
        $levelSpec = self::LEVELS[$level];

        $responsibilities = $spec['does'];

        // A supervisory title gets a supervisory duty, at the top where it
        // belongs. Without it the advert describes the job below the one being
        // advertised.
        if ($levelSpec['lead']) {
            array_unshift($responsibilities, $levelSpec['lead']);
        }

        $qualifications = $this->qualifications($spec, $levelSpec, $title);

        [$min, $max, $basis] = $this->band($spec, $levelSpec, $requisition);

        return [
            'title' => $title,
            'family' => $family,
            'experienceLevel' => $level,
            'employmentType' => 'Full-time',
            'workSetup' => 'On-site',
            'summary' => $this->summary($spec, $levelSpec, $level, $requisition),
            'responsibilities' => implode("\n", $responsibilities),
            'qualifications' => implode("\n", $qualifications),
            'benefits' => implode("\n", $this->benefits($level)),
            'salaryMin' => $min,
            'salaryMax' => $max,
            /* Which of the two the figures came from. The screen says so out
               loud, because an indicative band presented as the company's own
               is how a made-up number ends up on the internet. */
            'salaryBasis' => $basis,
            'note' => $basis === 'budget'
                ? 'The band is built around the approved budget rate on this manpower request.'
                : 'The band is an indicative market range for this role and level — check it against '
                    .'what you actually pay before publishing, or leave it unpublished.',
        ];
    }

    /** @return list<string> */
    private function qualifications(array $spec, array $levelSpec, string $title): array
    {
        $out = [];

        /*
         * Phrased so the screening can read them.
         *
         * "At least three years in a supervisory role" and "Graduate of a
         * four-year course" are both shapes `CandidateAssessment` turns into a
         * number and an ordinal. Written any other way they still read fine to
         * a person and are invisible to the matcher — so an advert drafted
         * here is one the assessment can actually score against.
         */
        if ($levelSpec['years'] > 0) {
            $words = [1 => 'one', 2 => 'two', 3 => 'three', 4 => 'four', 5 => 'five', 8 => 'eight'];
            $count = $words[$levelSpec['years']] ?? $levelSpec['years'];

            $out[] = $levelSpec['lead']
                ? "At least {$count} years of experience, including time in a supervisory role"
                : "At least {$count} years of relevant experience";
        } else {
            $out[] = 'Fresh graduates are welcome to apply';
        }

        foreach ($spec['wants'] as $want) {
            $out[] = $want;
        }

        foreach ($spec['nice'] as $nice) {
            $out[] = "{$nice} — an advantage";
        }

        unset($title);

        return $out;
    }

    /**
     * The package, with the law and the perks kept apart.
     *
     * @return list<string>
     */
    private function benefits(string $level): array
    {
        $extras = [
            'HMO coverage on regularisation',
            'Paid leave above the statutory minimum',
            'Performance-based increases and a clear path to regularisation',
            'Training and the equipment to do the job properly',
        ];

        if (in_array($level, ['Manager', 'Director'], true)) {
            $extras[] = 'Communication and transport allowance appropriate to the role';
        }

        /*
         * The statutory entitlements are named as such, on one line.
         *
         * The first version separated them with a line containing only an em
         * dash, which was both a poor way to say it and — because every line
         * of this ends up in `JobPosting::lines()` — a line that reduces to
         * nothing once the bullet is stripped. Saying it in words costs the
         * same and reads like a person wrote it.
         */
        // Not lower-cased: SSS, PhilHealth and Pag-IBIG are names, and
        // "sss, philhealth and pag-ibig" reads like a typo on a job advert.
        $extras[] = 'Plus the statutory entitlements — '
            .implode('; ', self::STATUTORY);

        return $extras;
    }

    private function summary(array $spec, array $levelSpec, string $level, ?JobRequisition $requisition): string
    {
        $where = $requisition?->branchUnit->name ?? null;
        $department = $requisition?->hrDepartment->name ?? null;

        $opening = $spec['summary'];

        $context = match (true) {
            $where !== null && $department !== null => " You will be based at {$where}, working in {$department}.",
            $where !== null => " You will be based at {$where}.",
            $department !== null => " You will be working in {$department}.",
            default => '',
        };

        $seniority = $levelSpec['lead']
            ? ' This is a '.mb_strtolower($level).' role with people reporting to it.'
            : ($level === 'Entry level' ? ' Suitable for somebody starting out.' : '');

        return $opening.$context.$seniority;
    }

    /**
     * The band, and where it came from.
     *
     * An approved budget rate wins outright — it is this company's own number
     * for this seat, agreed by whoever approved the headcount. The library's
     * range is the fallback, and it is handed back labelled so nothing
     * publishes it by accident.
     *
     * @return array{0: float, 1: float, 2: string}
     */
    private function band(array $spec, array $levelSpec, ?JobRequisition $requisition): array
    {
        $budget = (float) ($requisition?->budget_rate ?? 0);

        if ($budget > 0) {
            // A band around the approved figure rather than the figure itself:
            // publishing a single number invites every applicant to ask for
            // exactly it, and leaves no room to pay a strong one more.
            return [round($budget * 0.9, -2), round($budget * 1.15, -2), 'budget'];
        }

        [$min, $max] = $spec['rate'];
        $m = $levelSpec['multiplier'];

        return [round($min * $m, -2), round($max * $m, -2), 'indicative'];
    }

    private function levelFor(string $lower): string
    {
        foreach (self::LEVELS as $level => $spec) {
            foreach ($spec['match'] as $needle) {
                if (str_contains($lower, $needle)) {
                    return $level;
                }
            }
        }

        return 'Entry level';
    }

    private function familyFor(string $lower): string
    {
        // Padded so a `str_contains` for "it " matches a title that ends in it.
        $haystack = " {$lower} ";

        foreach ($this->families() as $key => $spec) {
            foreach ($spec['match'] as $needle) {
                if (str_contains($haystack, $needle)) {
                    return $key;
                }
            }
        }

        // Nothing recognised. Administrative is the least wrong default — it
        // describes office work generically, and the recruiter edits it.
        return 'admin';
    }
}
