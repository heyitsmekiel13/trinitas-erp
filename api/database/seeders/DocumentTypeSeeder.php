<?php

namespace Database\Seeders;

use App\Models\DocumentType;
use Illuminate\Database\Seeder;

/**
 * The standard Philippine 201-file checklist.
 *
 * Matches what DOLE-registered employers actually keep on file, grouped the
 * way an HR audit groups them: what a candidate must produce before day one,
 * what government IDs prove statutory registration, the paperwork that makes
 * the employment itself official, and the records that only start once
 * somebody is separating. `firstOrCreate` on `key` so re-running the seeder
 * never duplicates a row an administrator may have since edited.
 */
class DocumentTypeSeeder extends Seeder
{
    public function run(): void
    {
        $types = [
            // key, name, category, required, expires, validity_months, sort_order
            ['psa_birth_cert', 'PSA Birth Certificate', 'Pre-Employment', true, false, null, 10],
            ['valid_id', "Valid Government ID (Employee's Copy)", 'Pre-Employment', true, false, null, 20],
            ['nbi_clearance', 'NBI Clearance', 'Pre-Employment', true, true, 6, 30],
            ['police_clearance', 'Police / Barangay Clearance', 'Pre-Employment', false, true, 6, 40],
            ['medical_certificate', 'Pre-Employment Medical Certificate', 'Pre-Employment', true, true, 12, 50],
            ['diploma_tor', 'Diploma / Transcript of Records', 'Pre-Employment', true, false, null, 60],
            ['prc_license', 'PRC License (if applicable)', 'Pre-Employment', false, true, 36, 70],
            ['coe_previous', 'Certificate of Employment (Previous Employer)', 'Pre-Employment', false, false, null, 80],
            ['id_photo_2x2', '2x2 ID Photo', 'Pre-Employment', true, false, null, 90],

            ['tin_id', 'TIN ID / BIR Registration', 'Government-Mandated', true, false, null, 110],
            ['sss_id', 'SSS ID / E-1 Form', 'Government-Mandated', true, false, null, 120],
            ['philhealth_id', 'PhilHealth MDR', 'Government-Mandated', true, false, null, 130],
            ['pagibig_id', 'Pag-IBIG MID Number', 'Government-Mandated', true, false, null, 140],

            ['employment_contract', 'Signed Employment Contract', 'Contract', true, false, null, 210],
            ['job_offer_acceptance', 'Signed Job Offer / Acceptance', 'Contract', true, false, null, 220],
            ['nda', 'Non-Disclosure Agreement', 'Contract', false, false, null, 230],
            ['company_policy_ack', 'Company Policy Acknowledgement', 'Contract', true, false, null, 240],
            ['data_privacy_consent', 'Data Privacy Consent Form', 'Contract', true, false, null, 250],

            ['performance_review_doc', 'Performance Review Record', 'Performance', false, false, null, 310],
            ['disciplinary_record', 'Disciplinary / Due Process Record', 'Performance', false, false, null, 320],

            ['resignation_letter', 'Resignation Letter / Notice', 'Separation', false, false, null, 410],
            ['clearance_form', 'Clearance Form', 'Separation', false, false, null, 420],
            ['coe_final', 'Certificate of Employment (Issued)', 'Separation', false, false, null, 430],
            ['final_pay_ack', 'Final Pay / Quitclaim Acknowledgement', 'Separation', false, false, null, 440],
        ];

        foreach ($types as [$key, $name, $category, $required, $expires, $validity, $sort]) {
            DocumentType::firstOrCreate(
                ['key' => $key],
                [
                    'name' => $name,
                    'category' => $category,
                    'required' => $required,
                    'expires' => $expires,
                    'validity_months' => $validity,
                    'sort_order' => $sort,
                ],
            );
        }
    }
}
