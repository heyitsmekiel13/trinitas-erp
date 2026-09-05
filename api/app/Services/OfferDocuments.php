<?php

namespace App\Services;

use App\Models\Applicant;
use Carbon\CarbonImmutable;

/**
 * The two documents that go out with an offer.
 *
 * An employment offer in the Philippines is a letter, not a message. It states
 * the term, the compensation and the pre-employment requirements, and it is
 * signed and brought back — so the candidate needs a file they can print and
 * sign, and HR needs the list of requirements to be the same list every time.
 * Typing it per candidate is how a start date ends up in one paragraph and a
 * different one in the next.
 *
 * Both documents are composed from the offer that was actually recorded, so
 * the salary in the letter is the salary on the applicant, is the salary the
 * 201 file starts on at hire. There is no second place to keep it.
 *
 * The referral slip is separate on purpose. It is handed to a clinic by
 * somebody who is not yet an employee, so it carries the company's name, the
 * examinations required and nothing else about their employment — a clinic
 * receptionist has no business reading a salary.
 */
class OfferDocuments
{
    /**
     * The pre-employment requirements.
     *
     * One list, in one place, so the letter and the checklist HR works from
     * cannot drift apart. The medical is deliberately a fit-to-work
     * certificate and nothing more: a panel of named tests on an offer letter
     * commits the company to requiring them, and most roles here do not need
     * them.
     *
     * @return list<string>
     */
    public function requirements(): array
    {
        return [
            'ID picture (2 pcs, passport size)',
            'Transcript of Records and/or Diploma',
            'Medical Certificate (Fit to Work)',
            'NBI Clearance (original)',
            'BIR Form 2316 from previous employment (current year)',
            'TIN Verification Slip (arranged by the Company if you have no TIN yet)',
            'SSS E-1 Form',
            "PhilHealth Member's Data Record / PMRF with number "
                .'(arranged by the Company if you have no PhilHealth number yet)',
            "Pag-IBIG Member's Data Form (MDF) with number",
            "Birth Certificate, and where applicable Marriage Certificate and children's Birth Certificates "
                .'(3 copies each)',
            'Certificate of Employment from previous employer/s',
            'Occupational Permit',
            'Valid ID with 3 specimen signatures (3 copies)',
        ];
    }

    /**
     * The employment offer letter.
     *
     * A PDF now, not a .docx — the two-column compensation table only ever
     * rendered correctly in Word itself; every other reader (Google Docs
     * included) collapsed its label column to one character per line,
     * because the generated markup had no `<w:tblGrid>` telling it the real
     * column widths. PDF places every run at an absolute point computed
     * from real font metrics, so there is no second renderer left with its
     * own opinion to get it wrong. See `PdfWriter` for the rest of that
     * reasoning, and `DocxWriter` for why neither writer takes on a
     * third-party dependency to do this.
     *
     * @return array{filename: string, bytes: string}
     */
    public function offerLetter(Applicant $applicant): array
    {
        $c = $this->context($applicant);
        $doc = new PdfWriter;

        $doc->letterhead($c['company'], $c['companyAddress'], $c['companyLogoPath'])
            ->title('Employment Offer')
            ->meta($c['today'].($c['reference'] ? '  ·  Ref. '.$c['reference'] : ''));

        $doc->paragraph($c['name'], ['bold' => true, 'after' => 2]);

        if ($c['address']) {
            $doc->paragraph($c['address'], ['after' => 16]);
        } else {
            $doc->spacer(10);
        }

        $doc->runs([['Dear '.$c['firstName'].',', true]], ['after' => 12]);

        $doc->runs([
            ['We are delighted to extend this offer of employment for the position of ', false],
            [$c['position'], true],
            [' here at ', false],
            [$c['company'], true],
            ['. You will be reporting to our '.$c['site'].($c['siteAddress'] ? " located at {$c['siteAddress']}" : '').'.', false],
        ]);

        $doc->runs($c['startDate']
            ? [['Your start date is ', false], [$c['startDate'], true], [', under the following terms and conditions:', false]]
            : [['Your start date will be confirmed with you, under the following terms and conditions:', false]]);

        /* ---------------------------------------------------------------- */
        $doc->heading('1.  Term of Employment Contract')
            ->runs([
                ['You will be under a Probationary Employment Contract for ', false],
                ['180 days (6 months)', true],
                [' from your starting '.($c['startDate'] ? "date of {$c['startDate']}" : 'date')
                    .'. Your contract may progress without any need for verbal or written notice unless you '
                    .'decide to cease your employment with the Company, or unless poor performance would '
                    .'necessitate the non-progression of your employment.', false],
            ])
            ->paragraph(
                "We also have the Company's Code of Conduct and Work Rules Policy, and other policies that apply "
                ."to all employees of the Company. Violation of the Company's Code of Conduct and Work Rules "
                .'Policy could lead to termination of the employment contract.'
            );

        /* ---------------------------------------------------------------- */
        $doc->heading('2.  Compensation and Other Benefits')
            ->paragraph(
                'For and in consideration of the services that you will render, you will be entitled to the '
                .'following compensation:'
            );

        $rows = [];

        if ($c['dailyRate'] > 0) {
            $rows[] = ['Basic Daily Rate', $this->peso($c['dailyRate'])];

            if ($c['deMinimis'] > 0) {
                $rows[] = ['Daily De Minimis', $this->peso($c['deMinimis'])];
                $rows[] = ['Total', $this->peso($c['dailyRate'] + $c['deMinimis']), true];
            }
        }

        if ($c['salary'] > 0) {
            $rows[] = ['Monthly Salary', $this->peso($c['salary']), $c['dailyRate'] <= 0];
        }

        if ($rows !== []) {
            $doc->amounts($rows);
        }

        $doc->paragraph("Upon regularisation, you will be eligible for the Company's Health Plan Benefit.");

        if ($c['notes']) {
            $doc->paragraph($c['notes']);
        }

        /* ---------------------------------------------------------------- */
        $doc->heading('3.  Pre-employment Requirements')
            ->paragraph(
                'A list of pre-employment requirements is set out below. Please ensure complete submission before '
                ."the date of the New Hire's Orientation, which will be communicated to you at a later date. "
                .'The pre-employment requirements are as follows:'
            )
            ->list($this->requirements(), 'letter')
            ->spacer()
            ->paragraph(
                'The complete submission of all listed pre-employment requirements is necessary for a new hire to '
                ."be able to attend the New Hire's Orientation (NHO). Failure to comply with the submission of "
                .'all the pre-employment requirements may result in the new hire being unable to join the NHO '
                .'and unable to start on their assigned start date. Furthermore, in the event that a new hire is '
                .'allowed to start work without completing the submission of all the pre-employment '
                .'requirements, the Company may withhold the release of their salary until such time that the '
                .'requirements are all complied with and submitted.'
            );

        /* ---------------------------------------------------------------- */
        $doc->spacer()
            ->paragraph(
                'Please signify your acceptance of this Employment Offer by signing in the space provided below. '
                .'We look forward to a fruitful and harmonious working relationship with you.'
            )
            ->spacer(30)
            ->paragraph('Very truly yours,', ['after' => 4])
            ->paragraph($c['company'], ['bold' => true, 'after' => 32]);

        $doc->paragraph($c['signatory'], ['bold' => true, 'after' => 0])
            ->paragraph($c['signatoryTitle'], ['after' => 20]);

        $doc->heading('Acceptance')
            ->paragraph(
                'I hereby certify that I have read and understood the foregoing Employment Offer, and I hereby '
                .'accept this employment, subject to the execution of the employment contract.'
            )
            ->signatureLine('Signature over Printed Name')
            ->spacer(24)
            ->paragraph('Date signed: ______________________');

        return [
            'filename' => 'Employment Offer - '.$this->slug($c['name']).'.pdf',
            'bytes' => $doc->render(),
        ];
    }

    /**
     * The clinic referral slip.
     *
     * Carries who they are, who sent them and what is required — and nothing
     * about their pay, because it is handed across a reception desk.
     *
     * @return array{filename: string, bytes: string}
     */
    public function referralSlip(Applicant $applicant): array
    {
        $c = $this->context($applicant);
        $doc = new PdfWriter;

        $doc->letterhead($c['company'], $c['companyAddress'], $c['companyLogoPath'])
            ->title('Referral Slip')
            ->meta($c['today']);

        $doc->paragraph('To the attending clinic or physician,', ['after' => 12])
            ->runs([
                ['The bearer of this slip, ', false],
                [$c['name'], true],
                [', is an applicant of '.$c['company'].' and has been referred for pre-employment medical '
                    .'examination.', false],
            ]);

        $doc->amounts([
            ['Name', $c['name'], true],
            ['Position applied for', $c['position']],
            ['Referred by', $c['company']],
            ['Reference', (string) ($applicant->reference_code ?: '—')],
        ]);

        $doc->heading('Examination required')
            ->paragraph(
                'A pre-employment medical examination sufficient for the issuance of a '
                .'Fit to Work certification.'
            )
            ->paragraph(
                'Please issue the Medical Certificate (Fit to Work) to the applicant. Any additional examination '
                .'is at the discretion of the attending physician.'
            );

        $doc->spacer(6)
            ->paragraph(
                'Note to the applicant: please present this slip on arrival and inform the staff that you are '
                .'there for your pre-employment requirements. There is a fee for this examination, payable '
                .'during your visit.'
            );

        $doc->spacer(30)
            ->paragraph('Issued by,', ['after' => 4])
            ->paragraph($c['company'], ['bold' => true, 'after' => 2]);

        if ($c['companyAddress']) {
            $doc->paragraph($c['companyAddress']);
        }

        return [
            'filename' => 'Referral Slip - '.$this->slug($c['name']).'.pdf',
            'bytes' => $doc->render(),
        ];
    }

    /* ====================================================================== */

    /**
     * Everything both documents and the covering email need.
     *
     * One method, so the letter, the slip and the email body cannot disagree
     * about a start date.
     *
     * @return array<string, mixed>
     */
    public function context(Applicant $applicant): array
    {
        $applicant->loadMissing(['position', 'jobPosting.hrDepartment', 'jobRequisition.branchUnit']);

        $settings = app(Settings::class);
        $company = $settings->group('company');

        $legal = $company['legal_name'] ?? config('app.name');

        $salary = (float) ($applicant->offer_salary ?? 0);

        /* The letter states a daily rate because that is how a Philippine
           offer is written, and payroll's own working-days factor is what
           converts one to the other — using anything else here would put a
           figure in writing that the first payslip contradicts. */
        $factor = (int) $settings->get('payroll', 'working_days_factor', 313);
        $daily = (float) ($applicant->offer_daily_rate ?? 0);

        if ($daily <= 0 && $salary > 0 && $factor > 0) {
            $daily = round($salary * 12 / $factor, 2);
        }

        $branch = $applicant->jobRequisition->branchUnit ?? null;

        return [
            'today' => CarbonImmutable::now()->format('F j, Y'),
            'name' => $applicant->composedName(),
            'firstName' => $applicant->first_name ?: strtok((string) $applicant->full_name, ' '),
            'address' => trim(implode(', ', array_filter([
                $applicant->address_line, $applicant->city, $applicant->province,
            ]))) ?: null,
            'position' => $applicant->offer_position
                ?: ($applicant->jobPosting->title ?? $applicant->position->title ?? 'the role'),
            'company' => $legal,
            'companyAddress' => $company['address'] ?? null,
            // Same file Admin → System Settings → Company uploads, and the
            // same resolution `Mailer::embeddableLogo()` uses for the
            // email letterhead — one logo, read from one place.
            'companyLogoPath' => ! empty($company['logo_path'])
                ? storage_path('app/public/'.$company['logo_path'])
                : null,
            /* Where they will actually report. The branch on the manpower
               request when there is one, because "our Davao Site" is what the
               candidate needs to find on their first morning. */
            /* "Davao Site site" is what naive concatenation produces when the
               branch is already named one, and it is the first thing a reader
               notices. */
            'site' => $branch?->name
                ? (preg_match('/(site|office|branch|plant|warehouse)/i', $branch->name)
                    ? $branch->name
                    : "{$branch->name} site")
                : 'office',
            'siteAddress' => $branch?->address ?: ($company['address'] ?? null),
            'startDate' => $applicant->offer_start_date
                ? CarbonImmutable::parse($applicant->offer_start_date)->format('F j, Y')
                : null,
            'salary' => $salary,
            'dailyRate' => $daily,
            'deMinimis' => (float) ($applicant->offer_de_minimis ?? 0),
            'notes' => $applicant->offer_notes,
            'reference' => $applicant->reference_code,
            'signatory' => $company['signatory_name'] ?? '',
            'signatoryTitle' => $company['signatory_title'] ?? 'Chief Executive Officer',
            'orientationAt' => $applicant->offer_orientation_at
                ? CarbonImmutable::parse($applicant->offer_orientation_at)
                : null,
            'orientationVenue' => $applicant->offer_orientation_venue
                ?: ($branch?->address ?: ($company['address'] ?? null)),
        ];
    }

    /**
     * "PHP", not "₱" — the PDF's base-14 Helvetica has no glyph for the
     * peso sign, so drawing it would leave a missing-character box where a
     * real character belongs. See `PdfWriter`'s own docblock.
     */
    private function peso(float $amount): string
    {
        return 'PHP '.number_format($amount, 2);
    }

    private function slug(string $name): string
    {
        return trim(preg_replace('/[^A-Za-z0-9 ]/', '', $name) ?? $name) ?: 'Applicant';
    }
}
