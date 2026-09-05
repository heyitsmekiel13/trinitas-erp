<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;

/**
 * Getting the words out of whatever somebody uploaded.
 *
 * This is the unglamorous half of resume parsing and the half that decides
 * whether the rest works at all: a PDF is a drawing instruction set, a DOCX is
 * a zip of XML, a scanned CV is a photograph, and none of them hands over a
 * paragraph of text for the asking.
 *
 * Everything here is deliberately dependency-free. The alternative was pulling
 * a PDF library and an OCR binding into composer, which on a shared Hostinger
 * plan is a deployment problem rather than a feature — the vendor directory is
 * shipped as-is and `composer install` is not something this project runs on
 * the server. So:
 *
 *   PDF    The content streams are inflated with zlib (bundled with PHP) and
 *          the text-showing operators are read out of them. This handles the
 *          PDFs people actually send — anything exported from Word, Google
 *          Docs, Canva or a CV builder. It does not handle a PDF that is a
 *          scan; that has no text in it to find, and falls through to OCR.
 *
 *   DOCX   A zip. `word/document.xml` is the document; paragraphs become
 *          newlines and the tags come off.
 *
 *   images Handed to `tesseract` when the host has it. When it does not, the
 *          upload is still kept and the applicant simply fills the form in by
 *          hand — an unreadable CV is a smaller problem than a lost one.
 *
 * The parser never throws for a document it cannot read. It returns an empty
 * string, and the caller records the upload as Unreadable.
 */
class ResumeReader
{
    /** Anything past this is a book, not a CV, and is truncated. */
    private const MAX_CHARACTERS = 120_000;

    /**
     * Plain text for an uploaded file, or an empty string.
     *
     * @return array{text: string, method: string}
     */
    public function read(UploadedFile $file): array
    {
        $path = $file->getRealPath();

        if (! $path || ! is_readable($path)) {
            return ['text' => '', 'method' => 'none'];
        }

        $extension = strtolower($file->getClientOriginalExtension() ?: '');
        $mime = strtolower((string) $file->getMimeType());

        $text = '';
        $method = 'none';

        try {
            if ($extension === 'pdf' || str_contains($mime, 'pdf')) {
                $text = $this->fromPdf($path);
                $method = 'pdf';

                // A scanned CV exported as a PDF has no text layer. If the
                // extraction came back with nothing worth reading, it is a
                // picture of a document — send it the same way as one.
                //
                // A PDF page has to become an image first: Tesseract reads
                // rasters, not PDF drawing instructions, so handing it the
                // .pdf path directly (what this did before) fails silently on
                // every normal install — the OCR fallback for a scanned PDF
                // was dead code in practice. `rasterizePdf` tries every
                // renderer this host might have and gives up cleanly if none
                // do, same as the rest of this class.
                if ($this->tooThin($text)) {
                    $ocr = $this->fromScannedPdf($path);
                    if (! $this->tooThin($ocr)) {
                        $text = $ocr;
                        $method = 'ocr';
                    }
                }
            } elseif ($extension === 'docx' || str_contains($mime, 'wordprocessingml')) {
                $text = $this->fromDocx($path);
                $method = 'docx';
            } elseif ($extension === 'doc' || $mime === 'application/msword') {
                $text = $this->fromLegacyDoc($path);
                $method = 'doc';
            } elseif ($extension === 'rtf' || str_contains($mime, 'rtf')) {
                $text = $this->fromRtf($path);
                $method = 'rtf';
            } elseif (str_starts_with($mime, 'image/') || in_array($extension, ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff'], true)) {
                $text = $this->fromImage($path);
                $method = 'ocr';
            } elseif (str_starts_with($mime, 'text/') || in_array($extension, ['txt', 'md'], true)) {
                $text = (string) file_get_contents($path);
                $method = 'text';
            }
        } catch (\Throwable $e) {
            // A malformed upload is a fact about the file, not an error worth
            // failing the application over.
            Log::warning('Resume extraction failed', ['file' => $file->getClientOriginalName(), 'error' => $e->getMessage()]);

            return ['text' => '', 'method' => 'none'];
        }

        return ['text' => $this->tidy($text), 'method' => $method];
    }

    /** True when what came back is too little to be a document. */
    public function tooThin(string $text): bool
    {
        return strlen(preg_replace('/\s+/', '', $text) ?? '') < 60;
    }

    /**
     * Whether a scanned CV can actually be read on this host, and what to do
     * about it if not.
     *
     * Before this, a scanned resume just came back "Unreadable" with no way
     * for anybody to tell whether that meant "bad scan" or "nobody has
     * installed Tesseract here" — two problems with completely different
     * fixes, one of them a five-minute `apt install` and the other a
     * conversation with the candidate.
     *
     * @return array{available: bool, binary: string, version: string|null, note: string}
     */
    public function ocrHealth(): array
    {
        $binary = (string) config('erp.ocr.tesseract', env('TESSERACT_PATH', 'tesseract'));

        if ($binary === '' || ! function_exists('proc_open')) {
            return [
                'available' => false,
                'binary' => $binary,
                'version' => null,
                'note' => 'proc_open is disabled on this host, so OCR cannot run regardless of whether Tesseract is installed.',
            ];
        }

        $process = @proc_open(
            sprintf('%s --version', escapeshellarg($binary)),
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );

        if (! is_resource($process)) {
            return [
                'available' => false,
                'binary' => $binary,
                'version' => null,
                'note' => "Could not run \"{$binary}\". Scanned resumes and image uploads will be recorded but not read.",
            ];
        }

        $out = stream_get_contents($pipes[1]) ?: '';
        $err = stream_get_contents($pipes[2]) ?: '';
        foreach ($pipes as $pipe) {
            if (is_resource($pipe)) {
                fclose($pipe);
            }
        }
        $exit = proc_close($process);

        $version = preg_match('/tesseract\s+([\d.]+)/i', $out.$err, $m) ? $m[1] : null;

        $rasterizer = $this->rasterizerAvailable();

        return [
            'available' => $exit === 0,
            'binary' => $binary,
            'version' => $version,
            'note' => $exit === 0
                ? ($rasterizer
                    ? "Tesseract {$version} is available, with {$rasterizer} to render scans — photographed CVs and scanned PDFs are both read automatically."
                    : "Tesseract {$version} is available for photographed CVs. Scanned PDFs specifically will not be read: that needs the Imagick PHP extension, or the pdftoppm or ImageMagick command, to turn a page into an image first, and none of those were found.")
                : "\"{$binary}\" did not respond as Tesseract. Scanned resumes and image uploads will be recorded but not read.",
        ];
    }

    /** Which of the three page-rasterizers `fromScannedPdf` can use is actually present, if any. */
    private function rasterizerAvailable(): ?string
    {
        if (extension_loaded('imagick')) {
            return 'Imagick';
        }

        if (! function_exists('proc_open')) {
            return null;
        }

        foreach (['pdftoppm', 'magick', 'convert'] as $binary) {
            $process = @proc_open(
                sprintf('%s -version', escapeshellarg($binary)),
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes,
            );

            if (! is_resource($process)) {
                continue;
            }

            foreach ($pipes as $pipe) {
                if (is_resource($pipe)) {
                    stream_get_contents($pipe);
                    fclose($pipe);
                }
            }

            if (proc_close($process) === 0) {
                return $binary;
            }
        }

        return null;
    }

    /* ====================================================================== */
    /* PDF */
    /* ====================================================================== */

    /**
     * Text out of a PDF, without a PDF library.
     *
     * A PDF page is a sequence of drawing operators inside a content stream,
     * usually Flate-compressed. Two of those operators put glyphs on the page:
     * `(text) Tj` and `[(a) -20 (b)] TJ`. Finding every stream, inflating the
     * ones that inflate, and pulling the strings out of the operators gets the
     * words back in reading order for any normally-generated document.
     *
     * What this does not do is map a custom font encoding back to Unicode. A
     * PDF that subsets its fonts with a non-standard encoding comes out as
     * mojibake — which `tooThin` will not catch, so `looksLikeProse` below is
     * what rejects it before it reaches the field parser.
     */
    private function fromPdf(string $path): string
    {
        $raw = (string) file_get_contents($path);

        if ($raw === '') {
            return '';
        }

        $out = [];

        // Every stream in the file. The `s` modifier matters: stream bodies
        // are binary and contain newlines.
        if (! preg_match_all('/stream\r?\n?(.*?)endstream/s', $raw, $matches)) {
            return '';
        }

        foreach ($matches[1] as $stream) {
            $decoded = @gzuncompress($stream);

            if ($decoded === false) {
                // Raw deflate, no zlib header — what most writers emit.
                $decoded = @gzinflate($stream);
            }

            if ($decoded === false) {
                // Some streams are stored uncompressed. Only worth reading if
                // they look like content rather than an embedded font or image.
                $decoded = str_contains($stream, 'Tj') || str_contains($stream, 'TJ') ? $stream : false;
            }

            if ($decoded === false || ! is_string($decoded)) {
                continue;
            }

            $page = $this->textFromContentStream($decoded);

            if ($page !== '') {
                $out[] = $page;
            }
        }

        $text = implode("\n", $out);

        return $this->looksLikeProse($text) ? $text : '';
    }

    /**
     * Pulls the shown strings out of one decoded content stream, in lines.
     *
     * The lines are the hard part, and getting them wrong quietly ruins
     * everything downstream. A PDF has no concept of a line of text: it has
     * glyphs placed at coordinates. Whether two runs belong on the same line
     * is a question about their *y* positions, and nothing else.
     *
     * The first version of this only broke a line at `T*` and `ET`, which is
     * what a hand-rolled PDF happens to emit. Real exporters do not: Word and
     * most CV builders set an absolute matrix per line with `Tm`, and Google
     * Docs moves relatively with `Td`. Against those, the whole CV came back
     * as one enormous line — and a parser that works on "the first line is the
     * name, the address is a line with a province in it" then has exactly one
     * line to work with and finds nothing.
     *
     * So this walks the operators properly, tracking the text position:
     *
     *   Tm/Td/TD   a move down the page ends the line; a move right on the
     *              same line is a column gap and becomes a space, which is
     *              what holds "Dates | Employer" tables together
     *   T-star     an explicit new line, as do the quote operators
     *   TJ         kerning numbers below the threshold are spaces the
     *              document never encoded
     *   <hex>      the other way of writing a string, including UTF-16
     */
    private function textFromContentStream(string $stream): string
    {
        $lines = [];
        $current = '';
        $y = null;
        $x = null;

        $break = function () use (&$lines, &$current) {
            if (trim($current) !== '') {
                $lines[] = rtrim($current);
            }
            $current = '';
        };

        /*
         * One pass over the operands and operators that matter. Strings allow
         * one level of nested parentheses, which is legal and does appear —
         * "(BS Accountancy (Cum Laude))" would otherwise terminate early and
         * throw the rest of the stream out of step.
         */
        $token = '/
              \( (?: \\\\. | [^\\\\()] | \( (?: \\\\. | [^\\\\()] )* \) )* \)   # (string)
            | < [0-9A-Fa-f\s]* >                                                # <hex string>
            | \[ (?: [^\[\]\\\\] | \\\\. )* \]                                  # [array]
            | [+-]? (?: \d+\.?\d* | \.\d+ )                                     # number
            | \/ [^\s\/\[\]<>()]*                                               # \/Name
            | T[jJdDmLcwzsf*]                                                   # text operators
            | BT | ET | \x27 | "
        /x';

        preg_match_all($token, $stream, $matches);

        $operands = [];

        foreach ($matches[0] as $piece) {
            switch ($piece) {
                case 'BT':
                    /* A new text object, and deliberately not a reset of the
                       tracked position. `Tm` coordinates are absolute on the
                       page, and the exporters that wrap every line — or every
                       *column* — in its own BT/ET are exactly the ones whose
                       lines have to be reassembled from those coordinates.
                       Clearing x here lost the gap between "Dates" and
                       "Employer" and ran the two columns together. */
                    $operands = [];
                    break;

                case 'ET':
                    /* Deliberately not a line break. "Dates | Employer" is two
                       text objects at the same height, and ending the line at
                       ET would split every such row in half — which is most
                       CV templates. The y position decides, and only it. */
                    $operands = [];
                    break;

                case 'T*':
                    $break();
                    $operands = [];
                    break;

                case 'Tm':
                    // a b c d e f — e and f are the translation.
                    if (count($operands) >= 6) {
                        [$nx, $ny] = [(float) $operands[4], (float) $operands[5]];
                        $this->positioned($nx, $ny, $x, $y, $current, $break);
                    }
                    $operands = [];
                    break;

                case 'Td':
                case 'TD':
                    // Relative move from the start of the current line.
                    if (count($operands) >= 2) {
                        $dx = (float) $operands[0];
                        $dy = (float) $operands[1];

                        if (abs($dy) > 1.5) {
                            $break();
                            $x = null;
                        } elseif ($dx > 8 && $current !== '' && ! str_ends_with($current, ' ')) {
                            // Same line, moved right: a column gap.
                            $current .= ' ';
                        }
                    }
                    $operands = [];
                    break;

                case 'Tj':
                    $current .= $this->stringOperand(end($operands) ?: '');
                    $operands = [];
                    break;

                case "'":
                case '"':
                    // Both move to the next line before showing the string.
                    $break();
                    $current .= $this->stringOperand(end($operands) ?: '');
                    $operands = [];
                    break;

                case 'TJ':
                    $array = end($operands);

                    if (is_string($array) && str_starts_with($array, '[')) {
                        preg_match_all(
                            '/\((?:\\\\.|[^\\\\()])*\)|<[0-9A-Fa-f\s]*>|[+-]?\d*\.?\d+/s',
                            $array,
                            $pieces,
                        );

                        foreach ($pieces[0] as $item) {
                            if ($item !== '' && ($item[0] === '(' || $item[0] === '<')) {
                                $current .= $this->stringOperand($item);
                            } elseif ((float) $item < -180 && ! str_ends_with($current, ' ')) {
                                $current .= ' ';
                            }
                        }
                    }
                    $operands = [];
                    break;

                default:
                    // Any other text operator (Tf, TL, Tc, Tw, Tz, Ts)
                    // consumes its operands without producing output.
                    if (strlen($piece) === 2 && $piece[0] === 'T') {
                        $operands = [];
                    } else {
                        $operands[] = $piece;
                    }
            }
        }

        $break();

        return implode("\n", $lines);
    }

    /**
     * Applies an absolute text-matrix move.
     *
     * Split out only because `Tm` needs to update two tracked values and
     * conditionally break, which is unreadable inline in the switch above.
     */
    private function positioned(float $nx, float $ny, ?float &$x, ?float &$y, string &$current, callable $break): void
    {
        if ($y !== null && abs($ny - $y) > 1.5) {
            $break();
        } elseif ($y !== null && $x !== null && $nx - $x > 8 && $current !== '' && ! str_ends_with($current, ' ')) {
            $current .= ' ';
        }

        $x = $nx;
        $y = $ny;
    }

    /**
     * One string operand, in either of the two forms a PDF may write it.
     *
     * `<0041...>` is the hex form, and when it opens with a byte-order mark it
     * is UTF-16 — which is how anything outside ASCII reaches a PDF, and
     * therefore how "Peñaflor" reaches this parser.
     */
    private function stringOperand(string $operand): string
    {
        if ($operand === '') {
            return '';
        }

        if ($operand[0] === '(') {
            return $this->unescapePdfString(substr($operand, 1, -1));
        }

        if ($operand[0] !== '<') {
            return '';
        }

        $hex = preg_replace('/[^0-9A-Fa-f]/', '', $operand) ?? '';

        if ($hex === '') {
            return '';
        }

        // An odd number of digits is padded with a trailing zero, per the spec.
        if (strlen($hex) % 2 === 1) {
            $hex .= '0';
        }

        $bytes = (string) hex2bin($hex);

        if (str_starts_with($bytes, "\xFE\xFF")) {
            return (string) mb_convert_encoding(substr($bytes, 2), 'UTF-8', 'UTF-16BE');
        }

        return $bytes;
    }

    /** PDF string escapes: `\n`, `\(`, and three-digit octal for the rest. */
    private function unescapePdfString(string $value): string
    {
        $replacements = [
            '\\n' => "\n", '\\r' => "\r", '\\t' => "\t", '\\b' => '', '\\f' => '',
            '\\(' => '(', '\\)' => ')', '\\\\' => '\\',
        ];

        $value = strtr($value, $replacements);

        return preg_replace_callback(
            '/\\\\([0-7]{1,3})/',
            fn (array $m) => chr(octdec($m[1]) & 0xFF),
            $value,
        ) ?? $value;
    }

    /**
     * Whether extracted text is words rather than the debris of a font that
     * could not be decoded.
     *
     * A CV in any Latin-script language is overwhelmingly letters, spaces and
     * punctuation. A failed decode is overwhelmingly not.
     */
    private function looksLikeProse(string $text): bool
    {
        $sample = substr($text, 0, 4000);

        if (strlen(trim($sample)) < 60) {
            return false;
        }

        $letters = preg_match_all('/[a-zA-Z]/', $sample);
        $total = strlen(preg_replace('/\s/', '', $sample) ?? '');

        return $total > 0 && ($letters / $total) > 0.55;
    }

    /* ====================================================================== */
    /* Office formats */
    /* ====================================================================== */

    private function fromDocx(string $path): string
    {
        if (! class_exists(\ZipArchive::class)) {
            return '';
        }

        $zip = new \ZipArchive;

        if ($zip->open($path) !== true) {
            return '';
        }

        $xml = $zip->getFromName('word/document.xml') ?: '';
        $zip->close();

        if ($xml === '') {
            return '';
        }

        // Paragraph and line breaks become newlines before the tags come off,
        // or the whole CV arrives as one line and every section heading fuses
        // to the paragraph under it.
        $xml = preg_replace('/<w:(p|br)\b[^>]*\/>/', "\n", $xml) ?? $xml;
        $xml = str_replace(['</w:p>', '<w:tab/>', '<w:br/>'], ["\n", "\t", "\n"], $xml);

        return html_entity_decode(strip_tags($xml), ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    /**
     * Legacy `.doc`, which is a compound binary file.
     *
     * There is no honest way to parse OLE2 in a few lines, so this does the
     * one thing that reliably helps: keeps the runs of printable characters
     * and drops the rest. It is enough to find an email address and a phone
     * number, which is most of what the parser needs, and the applicant
     * confirms everything anyway.
     */
    private function fromLegacyDoc(string $path): string
    {
        $raw = (string) file_get_contents($path);

        // Word stores much of the body as UTF-16LE; drop the interleaved nulls
        // before looking for readable runs.
        $raw = str_replace("\0", '', $raw);

        preg_match_all('/[\x20-\x7E\r\n\t]{6,}/', $raw, $runs);

        return implode("\n", $runs[0] ?? []);
    }

    private function fromRtf(string $path): string
    {
        $raw = (string) file_get_contents($path);

        $raw = preg_replace('/\\\\par[d]?/', "\n", $raw) ?? $raw;
        $raw = preg_replace('/\{\\\\\*.*?\}/s', '', $raw) ?? $raw;
        $raw = preg_replace('/\\\\[a-z]+-?\d*\s?/i', '', $raw) ?? $raw;

        return str_replace(['{', '}'], '', $raw);
    }

    /* ====================================================================== */
    /* OCR */
    /* ====================================================================== */

    /**
     * A scanned CV, page by page.
     *
     * Renders each page to an image first — see the note at the call site for
     * why that step cannot be skipped — then OCRs each page and joins them
     * with a blank line, so a two-page scan does not run page one's footer
     * into page two's header.
     *
     * Rendering tries three routes, in the order a host is likely to have
     * them: the `Imagick` PHP extension (a system extension, not a Composer
     * package — present on plenty of shared hosts without a deploy change),
     * then the `pdftoppm` and `magick`/`convert` CLI binaries. The first that
     * works wins; if none do, this returns nothing and the upload is
     * recorded as unreadable exactly as it always was.
     */
    private function fromScannedPdf(string $path): string
    {
        $images = $this->rasterizePdf($path);

        if ($images === []) {
            return '';
        }

        $pages = [];

        foreach ($images as $image) {
            $text = $this->fromImage($image);

            if (trim($text) !== '') {
                $pages[] = trim($text);
            }

            @unlink($image);
        }

        return implode("\n\n", $pages);
    }

    /**
     * Renders a PDF's pages to PNG files and returns their paths.
     *
     * Capped at 6 pages — a CV that runs longer than that is not going to be
     * read any more thoroughly by OCR-ing its appendix, and every extra page
     * is another few seconds an applicant is waiting on a form to respond.
     *
     * @return list<string>
     */
    private function rasterizePdf(string $path): array
    {
        $maxPages = 6;

        if (extension_loaded('imagick')) {
            try {
                $out = [];
                $imagick = new \Imagick;
                // 300 DPI: low enough to render quickly, high enough that
                // Tesseract stops mistaking a "5" for a "S" on a phone-camera
                // scan of a printed CV.
                $imagick->setResolution(300, 300);
                $imagick->readImage($path);
                $count = min($imagick->getNumberImages(), $maxPages);

                for ($i = 0; $i < $count; $i++) {
                    $imagick->setIteratorIndex($i);
                    $page = clone $imagick;
                    $page->setImageFormat('png');
                    $file = tempnam(sys_get_temp_dir(), 'ocrpg').'.png';
                    $page->writeImage($file);
                    $page->clear();
                    $out[] = $file;
                }

                $imagick->clear();

                if ($out !== []) {
                    return $out;
                }
            } catch (\Throwable $e) {
                Log::warning('Imagick could not rasterize the PDF for OCR.', ['error' => $e->getMessage()]);
            }
        }

        if (! function_exists('proc_open')) {
            return [];
        }

        $prefix = tempnam(sys_get_temp_dir(), 'ocrpg');

        if ($prefix === false) {
            return [];
        }
        @unlink($prefix);

        // `pdftoppm` (poppler-utils) first — it is purpose-built for exactly
        // this and on most Linux hosts is already installed for other things.
        // `magick`/`convert` (ImageMagick's own CLI) is the fallback for a
        // host that has the program but not the PHP extension.
        $attempts = [
            sprintf('pdftoppm -png -r 300 -l %d %s %s', $maxPages, escapeshellarg($path), escapeshellarg($prefix)),
            sprintf('magick -density 300 %s -scene 0 %s', escapeshellarg($path.'[0-'.($maxPages - 1).']'), escapeshellarg($prefix.'-%d.png')),
            sprintf('convert -density 300 %s -scene 0 %s', escapeshellarg($path.'[0-'.($maxPages - 1).']'), escapeshellarg($prefix.'-%d.png')),
        ];

        foreach ($attempts as $command) {
            $process = @proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);

            if (! is_resource($process)) {
                continue;
            }

            foreach ($pipes as $pipe) {
                if (is_resource($pipe)) {
                    stream_get_contents($pipe);
                    fclose($pipe);
                }
            }

            $exit = proc_close($process);

            $produced = glob($prefix.'*.png') ?: [];
            sort($produced, SORT_NATURAL);

            if ($exit === 0 && $produced !== []) {
                return array_slice($produced, 0, $maxPages);
            }

            foreach ($produced as $stray) {
                @unlink($stray);
            }
        }

        return [];
    }

    /**
     * Optical character recognition, when the host can do it.
     *
     * Tesseract is the only OCR worth shelling out to and it is not present on
     * a default shared host, so its absence is expected rather than an error.
     * The binary is configurable because on Windows it installs somewhere with
     * a space in the path and is not on `PATH`.
     *
     * Preprocessed with Imagick when available — a phone photo of a printed
     * CV is exactly the case Tesseract does worst on by default, and
     * grayscale plus a contrast stretch and a deskew is most of the
     * difference between "read cleanly" and "read as noise" for that case.
     * Skipped for a file this method already produced (a rasterized PDF page
     * is already a clean, upright render) — reprocessing it risks making a
     * good image worse for no benefit.
     */
    private function fromImage(string $path): string
    {
        $binary = (string) config('erp.ocr.tesseract', env('TESSERACT_PATH', 'tesseract'));

        if ($binary === '' || ! function_exists('proc_open')) {
            return '';
        }

        $source = $this->preprocessForOcr($path);
        $language = (string) config('erp.ocr.language', env('TESSERACT_LANG', 'eng'));

        // `--psm 3` (fully automatic) first, since most CVs are a single
        // uniform column and it also finds tables. `--psm 6` (one uniform
        // block) is tried as a fallback when the first pass reads
        // suspiciously little — the shape a scan of a tabular DTR-style
        // layout or a heavily-boxed CV template tends to confuse psm 3 into
        // under-reading.
        $best = '';

        foreach (['3', '6'] as $psm) {
            $attempt = $this->runTesseract($binary, $source, $language, $psm);

            if (mb_strlen(trim($attempt)) > mb_strlen(trim($best))) {
                $best = $attempt;
            }

            if (! $this->tooThin($best)) {
                break;
            }
        }

        if ($source !== $path) {
            @unlink($source);
        }

        return $this->cleanOcrNoise($best);
    }

    private function runTesseract(string $binary, string $path, string $language, string $psm): string
    {
        $output = tempnam(sys_get_temp_dir(), 'ocr');

        if ($output === false) {
            return '';
        }

        $command = sprintf(
            '%s %s %s -l %s --psm %s --oem 1 -c preserve_interword_spaces=1',
            escapeshellarg($binary),
            escapeshellarg($path),
            escapeshellarg($output),
            escapeshellarg($language),
            escapeshellarg($psm),
        );

        $process = @proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);

        if (! is_resource($process)) {
            @unlink($output);

            return '';
        }

        foreach ($pipes as $pipe) {
            if (is_resource($pipe)) {
                stream_get_contents($pipe);
                fclose($pipe);
            }
        }

        proc_close($process);

        // Tesseract writes to <output>.txt, not <output>.
        $produced = $output.'.txt';
        $text = is_readable($produced) ? (string) file_get_contents($produced) : '';

        @unlink($output);
        @unlink($produced);

        return $text;
    }

    /**
     * Grayscale, contrast-stretched and deskewed — the three adjustments that
     * make the most difference to Tesseract's accuracy on a phone-camera scan
     * with no fixed exposure or angle. Returns the original path unchanged
     * when Imagick is not available, or when anything about the source image
     * makes preprocessing fail; OCR-ing the original is always better than
     * not OCR-ing at all.
     */
    private function preprocessForOcr(string $path): string
    {
        if (! extension_loaded('imagick')) {
            return $path;
        }

        try {
            $image = new \Imagick($path);
            $image->setImageColorspace(\Imagick::COLORSPACE_GRAY);
            $image->contrastStretchImage(0.02, 0.02);
            $image->deskewImage(40);
            $image->setImageFormat('png');

            $out = tempnam(sys_get_temp_dir(), 'ocrprep').'.png';
            $image->writeImage($out);
            $image->clear();

            return $out;
        } catch (\Throwable $e) {
            Log::warning('OCR preprocessing failed; reading the original image instead.', ['error' => $e->getMessage()]);

            return $path;
        }
    }

    /**
     * Fixes for the mistakes Tesseract makes in predictable, correctable
     * ways — not a spelling checker, just the handful of substitutions that
     * are near-certain rather than guesses.
     */
    private function cleanOcrNoise(string $text): string
    {
        if ($text === '') {
            return '';
        }

        // A word wrapped across a line with a hyphen — "Account-\ning" — is
        // one word split by the page width, not two. Only joined when both
        // halves are lower-case letters, so "2019-\n2021" and "Trinitas-\nFoods"
        // (a real hyphenated name) are left alone.
        $text = preg_replace('/([a-z])-\n([a-z])/', '$1$2', $text) ?? $text;

        // Table borders and scan artefacts OCR as pipes, underscores or
        // stray boxes down the margin of a line.
        $text = preg_replace('/[|_]{2,}/', ' ', $text) ?? $text;
        $text = preg_replace('/^[|\x{00A6}\x{2502}]\s*/mu', '', $text) ?? $text;

        return $text;
    }

    /* ====================================================================== */

    /** Normalises whitespace without collapsing the line structure. */
    private function tidy(string $text): string
    {
        if ($text === '') {
            return '';
        }

        if (! mb_check_encoding($text, 'UTF-8')) {
            $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8, ISO-8859-1, Windows-1252');
        }

        $text = str_replace(["\r\n", "\r", "\xC2\xA0"], ["\n", "\n", ' '], $text);
        $text = preg_replace('/[^\P{C}\n\t]+/u', '', $text) ?? $text;
        $text = preg_replace('/[ \t]{2,}/', ' ', $text) ?? $text;
        $text = preg_replace('/\n{3,}/', "\n\n", $text) ?? $text;

        return trim(mb_substr($text, 0, self::MAX_CHARACTERS));
    }
}
