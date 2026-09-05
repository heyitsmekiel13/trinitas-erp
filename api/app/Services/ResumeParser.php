<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;

/**
 * Reading a CV into fields.
 *
 * The rule this whole class is built around: nothing it produces is saved as
 * fact. Every value comes back as a suggestion with a confidence beside it,
 * gets shown to the person it describes — the candidate on the careers site,
 * the recruiter in the intake form — and only becomes an applicant record when
 * a human has looked at it. A parser that quietly writes the wrong middle name
 * into a 201 file is worse than no parser, because nobody goes back and checks
 * a field that was already filled in.
 *
 * The heuristics are Philippine-shaped on purpose. Mobile numbers here are
 * 09xx or +639xx; addresses end in a province and a four-digit postal code;
 * degrees are written "BS Accountancy" as often as "Bachelor of Science in
 * Accountancy"; and half of CVs still carry date of birth and civil status
 * because that is what local application forms have always asked for.
 */
class ResumeParser
{
    public function __construct(private readonly ResumeReader $reader) {}

    /** Headings that end the section above them. */
    private const SECTION_WORDS = [
        'objective', 'summary', 'profile', 'about', 'experience', 'employment',
        'work history', 'professional experience', 'education', 'educational background',
        'academic', 'skills', 'technical skills', 'competencies', 'certifications',
        'training', 'seminars', 'affiliations', 'references', 'achievements',
        'awards', 'projects', 'personal information', 'personal background',
        'character references', 'eligibility', 'qualifications', 'languages',
    ];

    private const DEGREE_LEVELS = [
        'Doctorate' => ['doctor of philosophy', 'ph.d', 'phd', 'doctorate', 'doctor of'],
        'Master' => ['master of', 'masters', "master's", 'm.a.', 'm.s.', 'mba', 'ms in', 'ma in'],
        'Bachelor' => ['bachelor', 'b.s.', 'bs ', 'b.a.', 'ba ', 'bsba', 'bsit', 'bscs', 'bsa ', 'undergraduate degree'],
        'Associate' => ['associate degree', 'associate in', 'two-year course'],
        'Vocational' => ['vocational', 'tesda', 'nc ii', 'nc iii', 'technical course', 'certificate course'],
        'High School' => ['high school', 'secondary school', 'senior high', 'k-12'],
    ];

    /** Enough of the 81 to catch the ones that appear on a CV. */
    private const PROVINCES = [
        'Metro Manila', 'National Capital Region', 'Abra', 'Agusan del Norte', 'Agusan del Sur',
        'Aklan', 'Albay', 'Antique', 'Apayao', 'Aurora', 'Basilan', 'Bataan', 'Batanes',
        'Batangas', 'Benguet', 'Biliran', 'Bohol', 'Bukidnon', 'Bulacan', 'Cagayan',
        'Camarines Norte', 'Camarines Sur', 'Camiguin', 'Capiz', 'Catanduanes', 'Cavite',
        'Cebu', 'Cotabato', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental',
        'Davao Oriental', 'Dinagat Islands', 'Eastern Samar', 'Guimaras', 'Ifugao',
        'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela', 'Kalinga', 'La Union', 'Laguna',
        'Lanao del Norte', 'Lanao del Sur', 'Leyte', 'Maguindanao', 'Marinduque', 'Masbate',
        'Misamis Occidental', 'Misamis Oriental', 'Mountain Province', 'Negros Occidental',
        'Negros Oriental', 'Northern Samar', 'Nueva Ecija', 'Nueva Vizcaya',
        'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Pampanga', 'Pangasinan',
        'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Samar', 'Sarangani', 'Siquijor',
        'Sorsogon', 'South Cotabato', 'Southern Leyte', 'Sultan Kudarat', 'Sulu',
        'Surigao del Norte', 'Surigao del Sur', 'Tarlac', 'Tawi-Tawi', 'Zambales',
        'Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay',
    ];

    /**
     * Skills worth recognising when they are mentioned anywhere.
     *
     * A dictionary rather than free extraction, because "team player" and
     * "hardworking" are on every CV in the country and filtering for them
     * returns everybody. These are the ones a hiring manager would actually
     * search on.
     */
    private const SKILL_DICTIONARY = [
        'Accounting', 'Bookkeeping', 'Payroll', 'QuickBooks', 'Xero', 'SAP', 'Oracle',
        'Financial Reporting', 'Accounts Payable', 'Accounts Receivable', 'Auditing',
        'Taxation', 'BIR Filing', 'Budgeting', 'Forecasting',
        'Microsoft Excel', 'Excel', 'Microsoft Word', 'PowerPoint', 'Google Sheets',
        'Data Entry', 'Data Analysis', 'Power BI', 'Tableau', 'SQL', 'MySQL', 'PostgreSQL',
        'PHP', 'Laravel', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Node.js', 'Python',
        'Java', 'C#', '.NET', 'HTML', 'CSS', 'Git', 'Docker', 'AWS', 'Azure', 'Linux',
        'Customer Service', 'Sales', 'Telemarketing', 'Cold Calling', 'CRM', 'Salesforce',
        'Account Management', 'Business Development', 'Merchandising', 'Retail',
        'Inventory Management', 'Warehouse Management', 'Logistics', 'Supply Chain',
        'Procurement', 'Purchasing', 'Forklift', 'Dispatch', 'Fleet Management',
        'Recruitment', 'Onboarding', 'Employee Relations', 'Labor Law', 'Timekeeping',
        'Training', 'Performance Management', 'Compensation and Benefits',
        'Project Management', 'Agile', 'Scrum', 'Six Sigma', '5S', 'Kaizen', 'ISO 9001',
        'Preventive Maintenance', 'Troubleshooting', 'Welding', 'Electrical', 'HVAC',
        'Refrigeration', 'Plumbing', 'Machining', 'Calibration', 'Food Safety', 'HACCP',
        'Occupational Safety', 'First Aid', 'Driving', 'Graphic Design', 'Photoshop',
        'Illustrator', 'Canva', 'Figma', 'Video Editing', 'Social Media Management',
        'Content Writing', 'SEO', 'Copywriting', 'Email Marketing',

        /* Kitchen equipment and food-service distribution — this company's own
           trade, and under-represented in a generic dictionary built for
           office and warehouse roles alone. */
        'Sheet Metal Fabrication', 'Stainless Steel Fabrication', 'Fabrication',
        'Commercial Kitchen Equipment', 'Kitchen Equipment Installation', 'Gas Fitting',
        'Boiler Operations', 'Blueprint Reading', 'AutoCAD', 'SketchUp', 'CAD',
        'Field Service', 'After-Sales Service', 'Warranty Service', 'Technical Sales',
        'Key Account Management', 'B2B Sales', 'Equipment Sourcing', 'Import and Export',
        'Cookery', 'Culinary Arts', 'Baking and Pastry', 'Food and Beverage Services',
        'ServSafe', 'Kitchen Operations', 'Menu Costing', 'Catering', 'Bartending',
        'Professional Driver\'s License',
    ];

    /* ====================================================================== */

    /**
     * Reads an uploaded CV and returns what it found.
     *
     * @return array{
     *     status: string, method: string, confidence: int,
     *     fields: array<string, mixed>, skills: list<string>,
     *     detail: array<string, mixed>, text: string, notes: list<string>
     * }
     */
    public function parseUpload(UploadedFile $file): array
    {
        ['text' => $text, 'method' => $method] = $this->reader->read($file);

        if ($this->reader->tooThin($text)) {
            return [
                'status' => 'Unreadable',
                'method' => $method,
                'confidence' => 0,
                'fields' => [],
                'skills' => [],
                'detail' => [],
                'text' => '',
                'notes' => [$this->unreadableReason($file, $method)],
            ];
        }

        $parsed = $this->parseText($text, $file->getClientOriginalName());

        return [
            'status' => 'Parsed',
            'method' => $method,
            'confidence' => $parsed['confidence'],
            'fields' => $parsed['fields'],
            'skills' => $parsed['skills'],
            'detail' => $parsed['detail'],
            'text' => $text,
            'notes' => $parsed['notes'],
        ];
    }

    /**
     * The heuristics, over already-extracted text.
     *
     * Split from `parseUpload` so it can be exercised directly against a
     * string in a test, without needing a real PDF on disk.
     *
     * @return array{fields: array<string, mixed>, skills: list<string>, confidence: int, notes: list<string>}
     */
    public function parseText(string $text, ?string $filename = null): array
    {
        $lines = $this->lines($text);
        $lower = mb_strtolower($text);

        $fields = [];
        $notes = [];

        $email = $this->email($text);
        if ($email) {
            $fields['email'] = $email;
        }

        $phone = $this->phone($text);
        if ($phone) {
            $fields['phone'] = $phone;
        }

        $name = $this->name($lines, $email, $filename);
        if ($name) {
            $fields = array_merge($fields, $name);
        }

        $address = $this->address($lines);
        if ($address) {
            $fields = array_merge($fields, $address);
        }

        foreach ($this->personalDetails($text) as $key => $value) {
            $fields[$key] = $value;
        }

        foreach ($this->education($text, $lines) as $key => $value) {
            $fields[$key] = $value;
        }

        foreach ($this->experience($text, $lines) as $key => $value) {
            $fields[$key] = $value;
        }

        foreach ($this->links($text) as $key => $value) {
            $fields[$key] = $value;
        }

        if ($salary = $this->expectedSalary($text)) {
            $fields['expectedSalary'] = $salary;
        }

        $skills = $this->skills($text, $lower);

        /*
         * The structured findings, kept out of `fields`.
         *
         * `fields` exists to pre-fill form inputs, so everything in it has to
         * be a scalar somebody can see and edit in a text box. A work history
         * is not that — it is a list, it is shown as a list, and dropping it
         * into an input would render "[object Object]" into an application.
         */
        $detail = array_filter([
            'positions' => $fields['positions'] ?? [],
            'education' => $this->educationEntries($text),
            'certifications' => $this->certifications($text),
            'languages' => $this->languages($text),
        ], fn ($v) => $v !== []);

        unset($fields['positions'], $fields['yearsExperienceClaimed']);

        /* Confidence is the share of the fields that matter most which were
           found at all — the ones an application is useless without weigh
           more than the ones that are nice to have. */
        $weights = [
            'email' => 22, 'phone' => 18, 'lastName' => 18,
            'school' => 7, 'course' => 6, 'educationLevel' => 4,
            'currentTitle' => 5, 'currentEmployer' => 5, 'city' => 5,
            'yearsExperience' => 5,
        ];

        $confidence = 0;
        foreach ($weights as $field => $weight) {
            if (! empty($fields[$field])) {
                $confidence += $weight;
            }
        }

        if ($skills) {
            $confidence += 3;
        }

        // Dated positions are the strongest single signal that the document
        // was read structurally rather than scraped.
        if (count($detail['positions'] ?? []) > 0) {
            $confidence += 2;
        }

        if (empty($fields['email'])) {
            $notes[] = 'No email address was found in the document — please type it in.';
        }

        if (empty($fields['phone'])) {
            $notes[] = 'No mobile number was found in the document — please type it in.';
        }

        if (! empty($fields['yearsExperience']) && ($detail['positions'] ?? []) === []) {
            $notes[] = 'Length of experience was taken from a sentence in the CV rather than from dated positions — worth confirming.';
        }

        return [
            'fields' => array_filter($fields, fn ($v) => $v !== null && $v !== '' && $v !== []),
            'skills' => $skills,
            'detail' => $detail,
            'confidence' => min(100, $confidence),
            'notes' => $notes,
        ];
    }

    /* ====================================================================== */
    /* Field heuristics */
    /* ====================================================================== */

    /** @return list<string> */
    private function lines(string $text): array
    {
        return collect(explode("\n", $text))
            ->map(fn ($l) => trim($l))
            ->filter(fn ($l) => $l !== '')
            ->values()
            ->all();
    }

    private function email(string $text): ?string
    {
        if (! preg_match('/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/', $text, $m)) {
            return null;
        }

        $email = rtrim($m[0], '.');

        return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
    }

    /**
     * A Philippine contact number, normalised to 09xxxxxxxxx.
     *
     * Mobile is preferred over landline because it is the number recruiters
     * actually use, and because a CV that shows both shows the mobile second
     * about as often as it shows it first.
     */
    private function phone(string $text): ?string
    {
        $candidates = [];

        // +63 917 123 4567 / 0917-123-4567 / 09171234567
        if (preg_match_all('/(?:\+?63|0)[\s\-.]?9\d{2}[\s\-.]?\d{3}[\s\-.]?\d{4}/', $text, $m)) {
            foreach ($m[0] as $hit) {
                $digits = preg_replace('/\D/', '', $hit) ?? '';

                if (str_starts_with($digits, '63')) {
                    $digits = '0'.substr($digits, 2);
                }

                if (strlen($digits) === 11 && str_starts_with($digits, '09')) {
                    $candidates[] = $digits;
                }
            }
        }

        if ($candidates) {
            return $candidates[0];
        }

        // A landline, as a fallback: (02) 8123 4567 or 8123-4567.
        if (preg_match('/\(?0?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{4}/', $text, $m)) {
            $digits = preg_replace('/\D/', '', $m[0]) ?? '';

            if (strlen($digits) >= 7 && strlen($digits) <= 12) {
                return trim($m[0]);
            }
        }

        return null;
    }

    /**
     * The candidate's name.
     *
     * Almost every CV puts it on the first line, in a larger font that the
     * extraction has thrown away. So the first line that is not an address, a
     * contact detail or a section heading, and reads like two to four
     * capitalised words, is taken as the name.
     *
     * "LASTNAME, Firstname M." is handled separately because that comma is the
     * one reliable signal of which part is the surname — everywhere else the
     * order has to be assumed, and the assumption is stated in the UI rather
     * than hidden.
     *
     * @return array<string, string>|null
     */
    private function name(array $lines, ?string $email, ?string $filename): ?array
    {
        foreach (array_slice($lines, 0, 8) as $line) {
            $candidate = trim($line, " \t.-—|");

            if ($this->isSectionHeading($candidate) || mb_strlen($candidate) < 4 || mb_strlen($candidate) > 60) {
                continue;
            }

            if (preg_match('/[@\d]|https?:|www\./i', $candidate)) {
                continue;
            }

            // "DELA CRUZ, Juan Miguel"
            if (str_contains($candidate, ',')) {
                [$surname, $rest] = array_map('trim', explode(',', $candidate, 2));

                $commaSuffix = null;
                if (preg_match('/^(.*?)[\s,]+(Jr\.?|Sr\.?|II|III|IV|V)$/iu', $rest, $sm)) {
                    $rest = trim($sm[1]);
                    $commaSuffix = $this->normalizeSuffix($sm[2]);
                }

                if ($this->wordCount($surname) <= 3 && $this->wordCount($rest) >= 1 && $this->wordCount($rest) <= 3) {
                    $given = preg_split('/\s+/', $rest) ?: [];

                    return array_filter([
                        'lastName' => $this->titleCase($surname),
                        'firstName' => $this->titleCase($given[0] ?? ''),
                        'middleName' => $this->titleCase(implode(' ', array_slice($given, 1))),
                        'suffix' => $commaSuffix,
                        'fullName' => $this->titleCase(trim($rest.' '.$surname)).($commaSuffix ? " {$commaSuffix}" : ''),
                    ]);
                }
            }

            // A generational suffix is part of the name but not part of the
            // word-count judged below, and it is the surname's neighbour
            // regardless of where the name itself came from — pulled off
            // first so "Juan Dela Cruz Jr." still reads as a four-word line
            // that should be allowed.
            $suffix = null;
            if (preg_match('/^(.*?)[\s,]+(Jr\.?|Sr\.?|II|III|IV|V)$/iu', $candidate, $sm)) {
                $candidate = trim($sm[1]);
                $suffix = $this->normalizeSuffix($sm[2]);
            }

            $words = preg_split('/\s+/', $candidate) ?: [];

            if (count($words) < 2 || count($words) > 4) {
                continue;
            }

            // Every word starts with a capital, or the whole line is shouted.
            $capitalised = collect($words)->every(
                fn ($w) => (bool) preg_match('/^[A-ZÑ][A-Za-zÑñ\'\-.]*$/u', $w) || $w === mb_strtoupper($w),
            );

            if (! $capitalised) {
                continue;
            }

            // Western order — first name first — which is how it is written
            // here when there is no comma to say otherwise.
            $last = array_pop($words);

            // "Juan Miguel Dela Cruz" is Dela Cruz, not Cruz. Surname
            // particles are common enough in the Philippines that taking the
            // last word alone gets a large minority of names wrong, and a
            // wrong surname on a 201 file is a payroll problem later.
            while ($words !== [] && $this->isSurnameParticle(end($words))) {
                $last = array_pop($words).' '.$last;
            }

            $first = array_shift($words) ?? '';
            $middle = implode(' ', $words);

            return array_filter([
                'firstName' => $this->titleCase($first),
                'middleName' => $this->titleCase($middle),
                'lastName' => $this->titleCase($last),
                'suffix' => $suffix,
                'fullName' => $this->titleCase($candidate).($suffix ? " {$suffix}" : ''),
            ]);
        }

        // Nothing usable in the document. The filename is a weak last resort —
        // "juan-dela-cruz-resume.pdf" is a real convention — and the email
        // local part is weaker still, so neither fills the name outright.
        if ($filename) {
            $stem = preg_replace('/\.[a-z0-9]+$/i', '', $filename) ?? $filename;
            $stem = preg_replace('/[_\-.]+/', ' ', $stem) ?? $stem;
            $stem = trim(preg_replace('/\b(cv|resume|curriculum vitae|final|updated|copy|\d+)\b/i', '', $stem) ?? $stem);

            $words = array_values(array_filter(preg_split('/\s+/', $stem) ?: []));

            if (count($words) >= 2 && count($words) <= 4) {
                $last = array_pop($words);

                return array_filter([
                    'firstName' => $this->titleCase($words[0] ?? ''),
                    'middleName' => $this->titleCase(implode(' ', array_slice($words, 1))),
                    'lastName' => $this->titleCase($last),
                    'fullName' => $this->titleCase($stem),
                ]);
            }
        }

        unset($email);

        return null;
    }

    /**
     * Address, city, province and postal code.
     *
     * Anchored on the province list rather than on a label, because most CVs
     * write the address as a bare line under the name with nothing marking it.
     *
     * @return array<string, string>|null
     */
    private function address(array $lines): ?array
    {
        foreach (array_slice($lines, 0, 14) as $line) {
            if ($this->isSectionHeading($line) || mb_strlen($line) > 140) {
                continue;
            }

            foreach (self::PROVINCES as $province) {
                if (stripos($line, $province) === false) {
                    continue;
                }

                // "Cebu" also appears inside "Cebu City", and a line naming a
                // school in Cebu is not an address. Require it to look like
                // one: separated parts, or a postal code.
                $hasParts = substr_count($line, ',') >= 1;
                $postal = preg_match('/\b(\d{4})\b/', $line, $pm) ? $pm[1] : null;

                if (! $hasParts && ! $postal) {
                    continue;
                }

                $parts = array_values(array_filter(array_map('trim', explode(',', $line))));

                // The city is normally the part immediately before the
                // province, and the street address everything before that.
                $provinceIndex = null;
                foreach ($parts as $i => $part) {
                    if (stripos($part, $province) !== false) {
                        $provinceIndex = $i;
                        break;
                    }
                }

                $city = $provinceIndex !== null && $provinceIndex > 0 ? $parts[$provinceIndex - 1] : null;
                $street = $provinceIndex !== null && $provinceIndex > 1
                    ? implode(', ', array_slice($parts, 0, $provinceIndex - 1))
                    : null;

                return array_filter([
                    'addressLine' => $street ? $this->stripPostal($street) : null,
                    'city' => $city ? $this->stripPostal($city) : null,
                    'province' => $province,
                    'postalCode' => $postal,
                ]);
            }
        }

        return null;
    }

    private function stripPostal(string $value): string
    {
        return trim(preg_replace('/\b\d{4}\b/', '', $value) ?? $value, " ,\t");
    }

    /**
     * Date of birth, civil status, gender, nationality.
     *
     * These are asked for on Philippine application forms and so they are on
     * Philippine CVs. Read only when explicitly labelled — guessing a gender
     * from a first name is exactly the kind of inference that has no place in
     * a hiring record.
     *
     * @return array<string, string>
     */
    private function personalDetails(string $text): array
    {
        $found = [];

        // Anchored to one date shape rather than "the rest of the line",
        // which on a CV that lists date of birth above civil status swallows
        // the next label and parses as nothing.
        $shapes = '[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}|\d{4}-\d{2}-\d{2}';

        if (preg_match('/(?:date of birth|birth\s*date|birthday|born)\s*[:\-]?\s*('.$shapes.')/i', $text, $m)) {
            $date = $this->date(trim($m[1]));
            if ($date) {
                $found['birthdate'] = $date;
            }
        }

        if (preg_match('/(?:civil\s*status|marital\s*status)\s*[:\-]?\s*(single|married|widow(?:ed|er)?|separated)/i', $text, $m)) {
            $status = ucfirst(strtolower($m[1]));
            $found['civilStatus'] = str_starts_with($status, 'Widow') ? 'Widowed' : $status;
        }

        if (preg_match('/(?:sex|gender)\s*[:\-]?\s*(male|female)/i', $text, $m)) {
            $found['gender'] = ucfirst(strtolower($m[1]));
        }

        if (preg_match('/(?:nationality|citizenship)\s*[:\-]?\s*([A-Za-z]{4,20})/i', $text, $m)) {
            $found['nationality'] = ucfirst(strtolower(trim($m[1])));
        }

        return $found;
    }

    /** A written date in any of the shapes a CV uses, as yyyy-mm-dd. */
    private function date(string $value): ?string
    {
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? $value);

        foreach (['F j, Y', 'F j Y', 'j F Y', 'm/d/Y', 'n/j/Y', 'd-m-Y', 'Y-m-d', 'M j, Y', 'M j Y'] as $format) {
            try {
                $parsed = CarbonImmutable::createFromFormat($format, $value);

                if ($parsed && $parsed->year > 1920 && $parsed->year <= (int) date('Y')) {
                    return $parsed->toDateString();
                }
            } catch (\Throwable) {
                // Not this format; try the next.
            }
        }

        return null;
    }

    /**
     * Highest qualification, where it was taken, and when it finished.
     *
     * Walks the education section from the bottom up on the assumption CVs are
     * written most-recent-first, but decides the *level* from the whole
     * section, because somebody who lists high school last has not
     * un-graduated from their degree.
     *
     * @return array<string, mixed>
     */
    private function education(string $text, array $lines): array
    {
        $section = $this->section($text, ['education', 'educational background', 'academic']);
        $haystack = mb_strtolower($section ?: $text);

        $found = [];

        foreach (self::DEGREE_LEVELS as $level => $needles) {
            foreach ($needles as $needle) {
                if (str_contains($haystack, $needle)) {
                    $found['educationLevel'] = $level;
                    break 2;
                }
            }
        }

        $searchLines = $section ? $this->lines($section) : $lines;

        foreach ($searchLines as $line) {
            if (empty($found['school']) && preg_match('/\b(university|college|institute|polytechnic|academy|school of|state u)\b/i', $line)) {
                $school = trim(preg_split('/\s{2,}|\s[–—|]\s/u', $line)[0] ?? $line);
                $school = trim(preg_replace('/\b(19|20)\d{2}\s*(?:\-|–|to)?\s*((19|20)\d{2}|present)?\b/i', '', $school) ?? $school, ' ,-–—');

                if (mb_strlen($school) >= 6 && mb_strlen($school) <= 120) {
                    $found['school'] = $school;
                }
            }

            if (empty($found['course']) && preg_match('/\b(bachelor|master|doctor|associate|bs|ba|ab|bsba|bsit|bscs|bsa|mba)\b[^,\n]{0,90}/i', $line, $m)) {
                $course = trim($m[0], ' -–—,.');
                $course = trim(preg_replace('/\b(19|20)\d{2}\b/', '', $course) ?? $course);

                if (mb_strlen($course) >= 4 && mb_strlen($course) <= 120) {
                    $found['course'] = $course;
                }
            }
        }

        // The most recent four-digit year in the education section, which for
        // a CV written most-recent-first is the graduation year.
        if (preg_match_all('/\b(19[7-9]\d|20[0-4]\d)\b/', $section ?: '', $years)) {
            $best = max(array_map('intval', $years[0]));

            if ($best <= (int) date('Y') + 6) {
                $found['yearGraduated'] = $best;
            }
        }

        return $found;
    }

    /**
     * The work history, as entries rather than as a guess at the top job.
     *
     * The first version read one title and one employer off whichever line
     * matched first, and derived length of service from the earliest and
     * latest four-digit years anywhere in the section. Both were wrong in ways
     * that mattered:
     *
     *   The span overcounted. Somebody who worked 2015–2016, took five years
     *   out, and came back in 2021 was credited with ten years. So was anybody
     *   whose CV happened to mention a certificate from 2012 in the same
     *   block. A hiring manager filtering on "at least three years" was
     *   filtering on noise.
     *
     *   One title is not a work history. Whether a candidate has *done this
     *   job before* — as opposed to doing it now — cannot be answered from the
     *   top entry alone, and it is the question a screener actually asks.
     *
     * So each position is parsed with its own dates, and total experience is
     * the union of those intervals in months: overlapping jobs are counted
     * once, and gaps are not counted at all.
     *
     * @return array<string, mixed>
     */
    private function experience(string $text, array $lines): array
    {
        $section = $this->section($text, [
            'experience', 'work experience', 'employment', 'employment history',
            'work history', 'professional experience', 'career history',
        ]);

        $found = [];
        $searchLines = $section ? $this->lines($section) : $lines;

        $entries = [];
        $pending = null;

        foreach ($searchLines as $line) {
            if ($this->isSectionHeading($line) || $this->isBullet($line)) {
                continue;
            }

            $range = $this->dateRange($line);

            if ($range === null) {
                // No dates: remember it, in case the dates are on the line
                // below — "Accounting Supervisor" / "2019 – Present" is as
                // common a layout as putting both on one line.
                if (mb_strlen($line) <= 90 && ! $this->isSentence($line)) {
                    $pending = $line;
                }

                continue;
            }

            // The header is whatever is left of this line once the dates come
            // off, or the line above when nothing readable is left.
            $header = trim($this->withoutDates($line), " \t-–—,.|()");

            if (mb_strlen($header) < 4 && $pending !== null) {
                $header = trim($this->withoutDates($pending), " \t-–—,.|()");
            }

            [$title, $employer] = $this->splitTitleAndEmployer($header);

            if ($title === null && $employer === null) {
                $pending = null;

                continue;
            }

            $entries[] = array_filter([
                'title' => $title,
                'employer' => $employer,
                'from' => $range['from'],
                'to' => $range['current'] ? null : $range['to'],
                'current' => $range['current'],
                'months' => $range['months'],
            ], fn ($v) => $v !== null && $v !== '');

            $pending = null;
        }

        /* No dated entries at all — a CV that lists positions without years.
           Fall back to the old behaviour for the title, which is still better
           than nothing, but claim no tenure from it. */
        if ($entries === []) {
            foreach ($searchLines as $line) {
                if ($this->isSectionHeading($line) || $this->isBullet($line)) {
                    continue;
                }

                [$title, $employer] = $this->splitTitleAndEmployer($line);

                if ($title !== null) {
                    $entries[] = array_filter(['title' => $title, 'employer' => $employer]);
                    break;
                }
            }
        }

        if ($entries !== []) {
            $found['positions'] = array_slice($entries, 0, 12);

            // The current job is the one still running, or the most recent.
            $current = null;
            foreach ($entries as $entry) {
                if (! empty($entry['current'])) {
                    $current = $entry;
                    break;
                }
            }

            $current ??= $entries[0];

            if (! empty($current['title'])) {
                $found['currentTitle'] = $current['title'];
            }
            if (! empty($current['employer'])) {
                $found['currentEmployer'] = $current['employer'];
            }
        }

        $months = $this->totalMonths($entries);

        if ($months > 0) {
            $found['yearsExperience'] = round($months / 12, 1);
        }

        // A stated figure only when the dates gave nothing — a career changer
        // with one undated job and a sentence about ten years is not unusual,
        // but a claim never overrides an arithmetic answer.
        if (empty($found['yearsExperience'])
            && preg_match('/(\d{1,2})(?:\+|\s*plus)?\s*(?:years?|yrs?)\b[^.\n]{0,40}?\bexperience\b/i', $text, $m)) {
            $found['yearsExperience'] = (float) $m[1];
            $found['yearsExperienceClaimed'] = true;
        }

        return $found;
    }

    /**
     * The months covered by a set of positions, counting overlaps once.
     *
     * Two jobs held at the same time are one span of experience, not two, and
     * a two-year gap between jobs is not experience at all.
     *
     * @param  list<array<string, mixed>>  $entries
     */
    private function totalMonths(array $entries): int
    {
        $spans = [];

        foreach ($entries as $entry) {
            if (empty($entry['from'])) {
                continue;
            }

            $from = $this->monthIndex($entry['from']);
            $to = ! empty($entry['current'])
                ? $this->monthIndex(date('Y-m'))
                : $this->monthIndex($entry['to'] ?? $entry['from']);

            if ($from === null || $to === null || $to < $from) {
                continue;
            }

            $spans[] = [$from, $to];
        }

        if ($spans === []) {
            return 0;
        }

        usort($spans, fn ($a, $b) => $a[0] <=> $b[0]);

        $months = 0;
        [$start, $end] = $spans[0];

        foreach (array_slice($spans, 1) as [$nextStart, $nextEnd]) {
            if ($nextStart <= $end + 1) {
                $end = max($end, $nextEnd);

                continue;
            }

            $months += $end - $start + 1;
            [$start, $end] = [$nextStart, $nextEnd];
        }

        $months += $end - $start + 1;

        // Half a century of work is a parsing accident, not a career.
        return $months > 660 ? 0 : $months;
    }

    /** "2019-03" as a count of months, for interval arithmetic. */
    private function monthIndex(string $ym): ?int
    {
        if (! preg_match('/^(\d{4})-(\d{2})$/', $ym, $m)) {
            return null;
        }

        return ((int) $m[1]) * 12 + ((int) $m[2]) - 1;
    }

    /**
     * A date range on one line, in the shapes CVs use.
     *
     * Accepts "2019 - Present", "Jan 2019 – Mar 2021", "January 2019 to
     * date", "03/2019 - 05/2021". Returns months as yyyy-mm so the interval
     * maths above never has to think about how it was written.
     *
     * @return array{from: string, to: string, current: bool, months: int}|null
     */
    private function dateRange(string $line): ?array
    {
        $month = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
        $point = "(?:{$month}\\.?\\s+)?(?:\\d{1,2}[\\/\\-])?((?:19|20)\\d{2})";
        $now = '(?:present|current|to\s*date|now|ongoing)';

        $pattern = "/(?<from>{$point})\\s*(?:-|–|—|to|until|through|\\bhanggang\\b)\\s*(?<to>{$now}|{$point})/i";

        if (! preg_match($pattern, $line, $m)) {
            return null;
        }

        $from = $this->monthOf($m['from']);

        if ($from === null) {
            return null;
        }

        $current = (bool) preg_match("/^{$now}$/i", trim($m['to']));
        $to = $current ? date('Y-m') : $this->monthOf($m['to']);

        if ($to === null) {
            return null;
        }

        $fromIndex = $this->monthIndex($from);
        $toIndex = $this->monthIndex($to);

        if ($fromIndex === null || $toIndex === null || $toIndex < $fromIndex) {
            return null;
        }

        return [
            'from' => $from,
            'to' => $to,
            'current' => $current,
            'months' => $toIndex - $fromIndex + 1,
        ];
    }

    /** One end of a range as yyyy-mm. A bare year is taken as January. */
    private function monthOf(string $value): ?string
    {
        if (! preg_match('/((?:19|20)\d{2})/', $value, $y)) {
            return null;
        }

        $months = [
            'jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6,
            'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12,
        ];

        $month = 1;

        if (preg_match('/([a-z]{3})[a-z]*/i', $value, $name)) {
            $month = $months[strtolower($name[1])] ?? 1;
        } elseif (preg_match('/\b(\d{1,2})[\/\-](?:19|20)\d{2}/', $value, $numeric)) {
            $month = max(1, min(12, (int) $numeric[1]));
        }

        return sprintf('%04d-%02d', (int) $y[1], $month);
    }

    /**
     * The line with any date range taken out of it.
     *
     * The month names are spelled out rather than matched as "some short
     * word before a year", which is what this did first — and which ate the
     * "Corp." out of "Northline Trading Corp. 2016 - 2019", because Corp is a
     * short word before a year. Employers ending in Inc., Corp. and Co. are
     * most of them.
     */
    private function withoutDates(string $line): string
    {
        $month = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+';
        $point = "(?:{$month})?(?:\\d{1,2}[\\/\\-])?(?:19|20)\\d{2}";
        $now = '(?:present|current|to\s*date|now|ongoing)';

        $cleaned = preg_replace(
            "/\\(?\\s*{$point}\\s*(?:-|–|—|to|until|through)\\s*(?:{$now}|{$point})\\s*\\)?/i",
            '',
            $line,
        ) ?? $line;

        return trim($cleaned);
    }

    /**
     * Splits a header line into a job title and an employer.
     *
     * @return array{0: ?string, 1: ?string}
     */
    private function splitTitleAndEmployer(string $header): array
    {
        $header = trim($header, " \t-–—,.|");

        if ($header === '' || mb_strlen($header) > 120) {
            return [null, null];
        }

        // "Sales Supervisor — Trinitas Foods Inc." and the "Title at Company"
        // and "Title, Company" variants. The separator has to be surrounded by
        // space for the hyphen form, or "Accounts-Payable Clerk" splits itself
        // in half.
        if (preg_match('/^(.{3,70}?)\s*(?:\s[-–—|]\s|\s+at\s+|,)\s*(.{2,70})$/iu', $header, $m)) {
            $left = trim($m[1], ' -–—,.');
            $right = trim($m[2], ' -–—,.');

            if ($this->looksLikeJobTitle($left) && mb_strlen($right) >= 3) {
                return [$left, $right];
            }

            // The other way round — "Trinitas Foods Inc. — Sales Supervisor".
            if ($this->looksLikeJobTitle($right) && mb_strlen($left) >= 3) {
                return [$right, $left];
            }
        }

        if ($this->looksLikeJobTitle($header) && mb_strlen($header) <= 70) {
            return [$header, null];
        }

        return [null, null];
    }

    /**
     * Education as entries, so more than the highest one survives.
     *
     * The scalar fields already carry the highest qualification, which is what
     * a form needs. This is what a screener reads: somebody with a vocational
     * certificate *and* a degree is a different candidate from somebody with
     * only one of them, and a single "educationLevel" cannot say so.
     *
     * @return list<array<string, mixed>>
     */
    private function educationEntries(string $text): array
    {
        $section = $this->section($text, ['education', 'educational background', 'academic', 'academic background']);

        if ($section === null) {
            return [];
        }

        $entries = [];
        $pending = null;

        foreach ($this->lines($section) as $line) {
            if ($this->isSectionHeading($line) || $this->isBullet($line)) {
                continue;
            }

            $isSchool = (bool) preg_match(
                '/\b(university|college|institute|polytechnic|academy|school|seminary|state u)\b/i',
                $line,
            );

            $course = null;

            if (preg_match('/\b(bachelor|master|doctor|associate|bs|ba|ab|bsba|bsit|bscs|bsa|mba|diploma|certificate)\b[^,\n]{0,90}/i', $line, $m)) {
                $course = trim($this->withoutDates($m[0]), ' -–—,.');
            }

            $year = preg_match('/\b(19[6-9]\d|20[0-5]\d)\b/', $line, $y) ? (int) $y[1] : null;

            if (! $isSchool && $course === null) {
                continue;
            }

            $school = $isSchool
                ? trim($this->withoutDates(preg_split('/\s{2,}|\s[–—|]\s|,/u', $line)[0] ?? $line), ' -–—,.')
                : null;

            /* A school on one line and the course on the next is the standard
               layout, so an entry that only has one half absorbs the other
               rather than being filed as two half-entries. */
            if ($pending !== null && (($school === null) !== ($pending['school'] === null))) {
                $entry = [
                    'school' => $school ?? $pending['school'],
                    'course' => $course ?? $pending['course'],
                    'year' => $year ?? $pending['year'],
                ];

                $entries[] = array_filter($entry, fn ($v) => $v !== null && $v !== '');
                $pending = null;

                continue;
            }

            if ($pending !== null) {
                $entries[] = array_filter($pending, fn ($v) => $v !== null && $v !== '');
            }

            $pending = ['school' => $school, 'course' => $course, 'year' => $year];
        }

        if ($pending !== null) {
            $entries[] = array_filter($pending, fn ($v) => $v !== null && $v !== '');
        }

        return array_values(array_slice(array_filter($entries), 0, 8));
    }

    /**
     * Licences and certificates.
     *
     * Worth a field of its own in the Philippines specifically: a PRC licence,
     * a TESDA National Certificate, and a professional driver's licence are
     * each a hard requirement for whole categories of role, and "does this
     * applicant hold one" is otherwise a question somebody answers by opening
     * the PDF and reading it.
     *
     * @return list<string>
     */
    private function certifications(string $text): array
    {
        $found = [];

        $patterns = [
            '/\bPRC\b[^.\n]{0,60}(?:licen[cs]e|licensed|registration|no\.?\s*\d+)/i',
            '/\bLicensed\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/',
            '/\b(?:CPA|CPM|CFA|CIA|CMA|PMP|LPT|RN|RMT|REE|RME|ECE|CE|ME)\b(?=[\s,.;)]|$)/',
            '/\bNC\s?(?:I{1,3}|IV)\b[^.\n]{0,40}/i',
            '/\bTESDA\b[^.\n]{0,50}/i',
            '/\b(?:driver\'?s?\s+licen[cs]e)[^.\n]{0,30}/i',
            '/\bISO\s?\d{4,5}(?::\d{4})?[^.\n]{0,30}/i',
            '/\b(?:Six Sigma|Lean|HACCP|OSHA|BOSH|COSH|First Aid|Food Safety)[^.\n]{0,30}/i',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match_all($pattern, $text, $matches)) {
                foreach ($matches[0] as $hit) {
                    $clean = trim(preg_replace('/\s+/', ' ', $hit) ?? $hit, ' -–—,.;:');

                    if (mb_strlen($clean) >= 2 && mb_strlen($clean) <= 80) {
                        $found[$this->fold($clean)] = $clean;
                    }
                }
            }
        }

        /* Overlapping patterns produce near-duplicates — "TESDA NC II
           Bookkeeping" and "NC II Bookkeeping" are one certificate found
           twice. The longer phrase is the more informative one, so anything
           wholly contained in another entry is dropped. */
        $kept = [];

        foreach ($found as $candidate) {
            $swallowed = false;

            foreach ($found as $other) {
                if ($other !== $candidate && str_contains(mb_strtolower($other), mb_strtolower($candidate))) {
                    $swallowed = true;
                    break;
                }
            }

            if (! $swallowed) {
                $kept[] = $candidate;
            }
        }

        return array_values(array_slice($kept, 0, 12));
    }

    /** @return list<string> */
    private function languages(string $text): array
    {
        $known = [
            'English', 'Filipino', 'Tagalog', 'Cebuano', 'Bisaya', 'Visayan', 'Ilocano',
            'Hiligaynon', 'Ilonggo', 'Bicolano', 'Waray', 'Kapampangan', 'Pangasinense',
            'Maranao', 'Maguindanaon', 'Tausug', 'Chavacano',
            'Mandarin', 'Hokkien', 'Japanese', 'Korean', 'Spanish', 'Arabic', 'German', 'French',
        ];

        $section = $this->section($text, ['languages', 'language proficiency']);
        $haystack = $section ?? $text;

        // Outside a Languages section, only count it when the CV says so —
        // "Cebu" is a place and "Spanish" is half the surnames in the country.
        if ($section === null && ! preg_match('/\b(?:languages?|fluent|proficient|conversational)\b/i', $haystack)) {
            return [];
        }

        $found = [];

        foreach ($known as $language) {
            if (preg_match('/\b'.preg_quote($language, '/').'\b/i', $haystack)) {
                $found[] = $language;
            }
        }

        return array_values(array_unique($found));
    }

    /**
     * What the CV asks to be paid, when it says.
     *
     * Only inside an explicit statement — a bare "45,000" somewhere in a CV is
     * as likely to be a budget they managed as a wage they want.
     */
    private function expectedSalary(string $text): ?float
    {
        $pattern = '/(?:expected|desired|asking)\s+(?:monthly\s+)?(?:salary|rate|pay|compensation)'
            .'\s*[:\-]?\s*(?:php|p|₱)?\s*([\d,]{3,12})(?:\s*(k))?/i';

        if (! preg_match($pattern, $text, $m)) {
            return null;
        }

        $amount = (float) str_replace(',', '', $m[1]);

        if (! empty($m[2])) {
            $amount *= 1000;
        }

        // A plausible Philippine monthly wage. Anything outside this is a
        // misread, and a wrong expected salary is a candidate screened out
        // for a number they never wrote.
        return $amount >= 5_000 && $amount <= 2_000_000 ? $amount : null;
    }

    /** A bulleted duty, not a header. */
    private function isBullet(string $line): bool
    {
        return (bool) preg_match('/^\s*[-•*·▪o]\s+/u', $line);
    }

    /** Prose rather than a heading — too long, or ends in a full stop. */
    private function isSentence(string $line): bool
    {
        return mb_strlen($line) > 90 || (bool) preg_match('/[.;]\s*$/', $line);
    }

    private function looksLikeJobTitle(string $line): bool
    {
        return (bool) preg_match(
            '/\b(officer|manager|supervisor|assistant|associate|specialist|analyst|engineer|technician|clerk|staff|coordinator|head|lead|director|encoder|representative|agent|operator|driver|cashier|accountant|bookkeeper|developer|designer|consultant|administrator|secretary|receptionist|helper|crew|attendant|nurse|teacher|intern)\b/i',
            $line,
        );
    }

    /** @return array<string, string> */
    private function links(string $text): array
    {
        $found = [];

        if (preg_match('#(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9\-_%]+#i', $text, $m)) {
            $found['linkedinUrl'] = $this->absolute($m[0]);
        }

        if (preg_match('#(?:https?://)?(?:github\.com|behance\.net|dribbble\.com|gitlab\.com)/[A-Za-z0-9\-_.]+#i', $text, $m)) {
            $found['portfolioUrl'] = $this->absolute($m[0]);
        } elseif (preg_match('#https?://(?!(?:www\.)?linkedin\.com)[A-Za-z0-9\-.]+\.[a-z]{2,}(?:/[^\s]*)?#i', $text, $m)) {
            $found['portfolioUrl'] = rtrim($m[0], '.,);');
        }

        return $found;
    }

    private function absolute(string $url): string
    {
        return str_starts_with(strtolower($url), 'http') ? $url : 'https://'.ltrim($url, '/');
    }

    /** @return list<string> */
    private function skills(string $text, string $lower): array
    {
        $found = [];

        foreach (self::SKILL_DICTIONARY as $skill) {
            $needle = mb_strtolower($skill);

            // Word-boundary match, so "Java" does not fire on "JavaScript" and
            // "C#" survives having a character regex would treat as an anchor.
            if (preg_match('/(?<![a-z0-9+#.])'.preg_quote($needle, '/').'(?![a-z0-9+#])/i', $lower)) {
                $found[] = $skill;
            }
        }

        // Whatever the CV itself lists under Skills, kept as written — the
        // dictionary cannot know the trade-specific ones.
        $section = $this->section($text, ['skills', 'technical skills', 'core competencies', 'competencies']);

        if ($section) {
            foreach (preg_split('/[,;•\n\|]+/', $section) ?: [] as $piece) {
                $piece = trim($piece, " \t-–—•*.:");

                if (mb_strlen($piece) >= 3 && mb_strlen($piece) <= 40 && ! $this->isSectionHeading($piece)
                    && ! preg_match('/[@\d]{4,}/', $piece)) {
                    $found[] = $this->titleCase($piece);
                }
            }
        }

        /*
         * De-duplicated on the canonical name rather than the spelling.
         *
         * "MS Excel", "Excel" and "Microsoft Excel" are one skill written
         * three ways, and a CV that says two of them was producing two chips,
         * two matches against a posting, and a candidate who looked broader
         * than they are. Folding them first is what makes a skill count once.
         */
        $unique = [];

        foreach ($found as $skill) {
            $canonical = $this->canonicalSkill($skill);
            $unique[$this->fold($canonical)] ??= $canonical;
        }

        return array_values(array_slice($unique, 0, 30));
    }

    /**
     * The one name a skill is filed under.
     *
     * Public because the assessment matches a posting's requirements against
     * these, and both sides have to be folded the same way or "MS Excel" in an
     * advert never matches "Microsoft Excel" on a CV.
     */
    public function canonicalSkill(string $skill): string
    {
        static $aliases = [
            'excel' => 'Microsoft Excel', 'ms excel' => 'Microsoft Excel',
            'msexcel' => 'Microsoft Excel', 'spreadsheets' => 'Microsoft Excel',
            'word' => 'Microsoft Word', 'ms word' => 'Microsoft Word',
            'ms office' => 'Microsoft Office', 'microsoft office' => 'Microsoft Office',
            'powerpoint' => 'PowerPoint', 'ms powerpoint' => 'PowerPoint',
            'ap' => 'Accounts Payable', 'a/p' => 'Accounts Payable',
            'ar' => 'Accounts Receivable', 'a/r' => 'Accounts Receivable',
            'bookeeping' => 'Bookkeeping',
            'bir' => 'BIR Filing', 'bir filing' => 'BIR Filing',
            'quickbook' => 'QuickBooks', 'quick books' => 'QuickBooks',
            'inventory' => 'Inventory Management',
            'warehousing' => 'Warehouse Management',
            'customer support' => 'Customer Service', 'csr' => 'Customer Service',
            'js' => 'JavaScript', 'node' => 'Node.js', 'nodejs' => 'Node.js',
            'reactjs' => 'React', 'react.js' => 'React', 'vuejs' => 'Vue',
            'postgres' => 'PostgreSQL', 'ms sql' => 'SQL',
            'photoshop' => 'Photoshop', 'adobe photoshop' => 'Photoshop',
            'illustrator' => 'Illustrator', 'adobe illustrator' => 'Illustrator',
            'forklift operation' => 'Forklift', 'forklift driving' => 'Forklift',
            'pms' => 'Preventive Maintenance', 'pm' => 'Preventive Maintenance',
            'social media' => 'Social Media Management',
        ];

        return $aliases[$this->fold($skill)] ?? $skill;
    }

    /** A comparable form of a label: lower case, no punctuation, one space. */
    public function fold(string $value): string
    {
        $folded = mb_strtolower(trim($value));
        $folded = preg_replace('/[^a-z0-9+#\s]/u', ' ', $folded) ?? $folded;

        return trim(preg_replace('/\s+/', ' ', $folded) ?? $folded);
    }

    /**
     * The body of a named section, up to the next heading.
     *
     * Sections are what make the difference between "2015" being a graduation
     * year and a job start date, so most of the heuristics above run inside
     * one rather than over the whole document.
     */
    private function section(string $text, array $headings): ?string
    {
        $lines = explode("\n", $text);
        $start = null;

        foreach ($lines as $i => $line) {
            $clean = mb_strtolower(trim($line, " \t:•-–—*"));

            if (in_array($clean, $headings, true) || (mb_strlen($clean) <= 40 && in_array($clean, $headings, true))) {
                $start = $i + 1;
                break;
            }
        }

        if ($start === null) {
            return null;
        }

        $body = [];

        for ($i = $start; $i < count($lines); $i++) {
            if ($this->isSectionHeading($lines[$i]) && trim($lines[$i]) !== '') {
                break;
            }

            $body[] = $lines[$i];
        }

        $section = trim(implode("\n", $body));

        return $section !== '' ? $section : null;
    }

    private function isSectionHeading(string $line): bool
    {
        $clean = mb_strtolower(trim($line, " \t:•-–—*"));

        if ($clean === '' || mb_strlen($clean) > 45) {
            return false;
        }

        return in_array($clean, self::SECTION_WORDS, true);
    }

    /** "jr" / "Jr." / "SR" all become the one form the 201 file uses. */
    private function normalizeSuffix(string $value): string
    {
        $clean = rtrim(mb_strtoupper(trim($value)), '.');

        return match ($clean) {
            'JR' => 'Jr.',
            'SR' => 'Sr.',
            default => $clean, // II, III, IV, V need no punctuation of their own.
        };
    }

    /** Words that belong to the surname that follows them, not to the middle name. */
    private function isSurnameParticle(string $word): bool
    {
        return in_array(mb_strtolower(trim($word)), [
            'dela', 'de', 'del', 'delos', 'delas', 'los', 'las', 'san', 'santa', 'sta', 'sto',
            'da', 'di', 'van', 'von', 'der', 'la', 'le', 'mac', 'mc', 'bin', 'al',
        ], true);
    }

    private function wordCount(string $value): int
    {
        return count(array_filter(preg_split('/\s+/', trim($value)) ?: []));
    }

    /** Title case that leaves an already mixed-case name alone. */
    private function titleCase(string $value): string
    {
        $value = trim($value);

        if ($value === '') {
            return '';
        }

        if ($value !== mb_strtoupper($value) && $value !== mb_strtolower($value)) {
            return $value;
        }

        return mb_convert_case(mb_strtolower($value), MB_CASE_TITLE, 'UTF-8');
    }

    private function unreadableReason(UploadedFile $file, string $method): string
    {
        if ($method === 'ocr') {
            return 'That looks like a scan or a photo, and this server has no text recognition installed. '
                .'The file has been kept — please fill the form in by hand.';
        }

        if ($method === 'none') {
            return "This server cannot read {$file->getClientOriginalName()}. PDF, DOCX and TXT are read reliably; "
                .'the file has been kept either way.';
        }

        return 'The document was uploaded, but no readable text could be pulled out of it — '
            .'it may be a scan. Please fill the form in by hand.';
    }
}
