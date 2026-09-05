<?php

namespace App\Services;

/**
 * Writing a PDF, without a PDF library.
 *
 * `DocxWriter` explains why a hand-rolled writer exists at all here: the
 * vendor directory ships as-is to a shared host, and `composer install` is
 * not something this project runs on the server — so a PDF dependency
 * (dompdf, mpdf) is off the table the same way a Word one was.
 *
 * PDF turns out to be the friendlier format to hand-write than OOXML was.
 * Word's table-width units (`w:type="pct"`, in fiftieths of a percent) only
 * mean anything once a `<w:tblGrid>` sets the columns' real widths in
 * twips — omit it and Word tolerates the gap, but Google Docs does not:
 * every column collapses to its content's natural width, which is why a
 * label like "Basic Daily Rate" arrived one character per line. PDF has no
 * such indirection. Every piece of text here is placed at an absolute
 * point in absolute units (1/72 inch) computed from real character widths,
 * so what this writes is what every reader shows — there is no second
 * renderer with its own opinion about layout to disagree with the first.
 *
 * The base-14 fonts (Helvetica, Helvetica-Bold) are built into every PDF
 * reader — no font file to embed, and their widths
 * are the fixed metrics Adobe published in 1985, reproduced in `WIDTHS`
 * below. Their encoding does not include the peso sign, so amounts are
 * written as "PHP 1,234.56" here rather than "₱1,234.56" — a real
 * character never renders as a missing-glyph box.
 */
class PdfWriter
{
    private const PAGE_W = 595.28;

    private const PAGE_H = 841.89;

    private const MARGIN_TOP = 60.0;

    private const MARGIN_BOTTOM = 56.0;

    private const MARGIN_LEFT = 58.0;

    private const MARGIN_RIGHT = 58.0;

    private const CONTENT_W = self::PAGE_W - self::MARGIN_LEFT - self::MARGIN_RIGHT;

    /** Standard Helvetica metrics, 1/1000 em, ASCII 32-126. Oblique shares Regular's widths — it is a sheared transform of the same glyphs. */
    private const WIDTHS_REGULAR = [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    ];

    private const WIDTHS_BOLD = [
        278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
        975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
        333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
        611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
    ];

    /** Trinitas red, the same gradient stop the email letterhead uses. */
    private const BRAND = [0.882, 0.114, 0.204];

    private const INK = [0.05, 0.06, 0.08];

    private const INK_MUTED = [0.47, 0.5, 0.56];

    private const RULE = [0.816, 0.835, 0.867];

    /** @var list<string> Finished pages' content streams. */
    private array $pages = [];

    /** Current page's content stream, being built. */
    private string $stream = '';

    /** Distance from the top margin to where the next line starts. */
    private float $cursorY = 0;

    private bool $pageStarted = false;

    /** @var list<array{bytes: string, w: float, h: float}> Embedded images, in `/ImN` order. */
    private array $images = [];

    /* ====================================================================== */
    /* Blocks                                                                  */
    /* ====================================================================== */

    /**
     * A letterhead: company name, address and a brand-colour rule under it
     * — with the company's own logo alongside them when one is on file
     * (Admin → System Settings → Company). `$logoPath` is a filesystem
     * path, not bytes, so a caller with no logo to offer can simply pass
     * null rather than having to know GD exists to check.
     */
    public function letterhead(string $company, ?string $address, ?string $logoPath = null): self
    {
        $this->ensurePage();

        $logo = $logoPath ? $this->loadLogo($logoPath, 40, 40) : null;
        $textIndent = 0.0;

        if ($logo) {
            $textIndent = $logo['w'] + 12;
            // The logo's own top sits level with the company name's cap
            // height, not with the text block's baseline — nudge it up
            // slightly so it reads as aligned rather than merely nearby.
            $this->image($logo, self::MARGIN_LEFT, $this->cursorY, offsetFromTop: -3);
        }

        $this->text($company, 15, true, self::INK, spacing: 0.4, indent: $textIndent);
        $this->cursorY += 15 * 1.3;

        if ($address) {
            $this->text($address, 9, false, self::INK_MUTED, indent: $textIndent);
            $this->cursorY += 9 * 1.6;
        } else {
            $this->cursorY += 2;
        }

        if ($logo) {
            // Never let the rule sit under a logo taller than the text
            // block — it would cut straight through the artwork.
            $this->cursorY = max($this->cursorY, $logo['h'] + 6);
        }

        $this->rule(1.6, self::BRAND);
        $this->cursorY += 18;

        return $this;
    }

    /** A document title — centred, bold, letter-spaced, in the brand colour. */
    public function title(string $text): self
    {
        $this->ensurePage();
        $this->line($this->toUpper($text), 15, true, self::BRAND, align: 'center', spacing: 1.2);
        $this->cursorY += 18;

        return $this;
    }

    /** A right-aligned line — a date, a reference code. */
    public function meta(string $text): self
    {
        $this->ensurePage();
        $this->line($text, 9.5, false, self::INK_MUTED, align: 'right');
        $this->cursorY += 8;

        return $this;
    }

    /** A numbered clause heading, e.g. "1.  Term of Employment Contract". */
    public function heading(string $text): self
    {
        $this->ensurePage();
        $this->cursorY += 8;
        $this->wrap($text, 11.5, true, self::INK);
        $this->cursorY += 4;

        return $this;
    }

    /** A plain paragraph. */
    public function paragraph(string $text, array $options = []): self
    {
        $this->ensurePage();
        $this->wrap($text, 10.5, ! empty($options['bold']), self::INK, align: $options['align'] ?? 'left');
        $this->cursorY += ($options['after'] ?? 8);

        return $this;
    }

    /**
     * A paragraph built from mixed emphasis: `[['Position: ', false], ['Baker', true]]`.
     * The one place personalising a letter — a name, a position, a figure —
     * actually happens: everything else here is boilerplate, so the reader's
     * eye should land on the parts that are about them specifically.
     */
    public function runs(array $parts, array $options = []): self
    {
        $this->ensurePage();
        $this->wrapRuns($parts, 10.5, self::INK, align: $options['align'] ?? 'left');
        $this->cursorY += ($options['after'] ?? 8);

        return $this;
    }

    /** A lettered, numbered or bulleted list. */
    public function list(array $items, string $style = 'letter'): self
    {
        $this->ensurePage();

        foreach ($items as $i => $item) {
            $marker = match ($style) {
                'letter' => chr(97 + $i).'.',
                'number' => ($i + 1).'.',
                default => '•',
            };

            $this->wrap($item, 10, false, self::INK, indent: 20, marker: $marker);
            $this->cursorY += 3;
        }

        $this->cursorY += 6;

        return $this;
    }

    /**
     * A ruled two-column amounts table — label left, amount right, a bold
     * total row visually set apart. The ruled top/bottom edge is what a
     * "compensation schedule" is expected to look like on a real offer
     * letter; the docx version's borders were the one part of that document
     * that reliably survived every renderer, so the redesign keeps the idea
     * and drops only the markup that broke.
     *
     * @param  list<array{0: string, 1: string, 2?: bool}>  $rows
     */
    public function amounts(array $rows): self
    {
        $this->ensurePage();
        $this->cursorY += 4;
        $this->rule(1, self::RULE);
        $this->cursorY += 10;

        foreach ($rows as $row) {
            [$label, $amount] = $row;
            $bold = $row[2] ?? false;

            $this->ensureSpace(16);
            $this->text($label, 10.5, $bold, self::INK);
            $this->text($amount, 10.5, $bold, self::INK, align: 'right');
            $this->cursorY += 16;
        }

        $this->rule(1, self::RULE);
        $this->cursorY += 16;

        return $this;
    }

    /** A blank line. */
    public function spacer(float $height = 10): self
    {
        $this->cursorY += $height;

        return $this;
    }

    /** A rule to sign over, with a caption underneath. */
    public function signatureLine(string $caption): self
    {
        $this->ensureSpace(50);
        $this->cursorY += 26;
        $this->rule(0.8, self::INK, 220);
        $this->cursorY += 4;
        $this->text($caption, 8.5, false, self::INK_MUTED);
        $this->cursorY += 18;

        return $this;
    }

    /** Starts a new page. */
    public function pageBreak(): self
    {
        $this->flushPage();

        return $this;
    }

    /* ====================================================================== */
    /* Layout                                                                  */
    /* ====================================================================== */

    private function ensurePage(): void
    {
        if (! $this->pageStarted) {
            $this->pageStarted = true;
            $this->cursorY = 0;
        }
    }

    private function ensureSpace(float $needed): void
    {
        $this->ensurePage();

        if (self::MARGIN_TOP + $this->cursorY + $needed > self::PAGE_H - self::MARGIN_BOTTOM) {
            $this->flushPage();
        }
    }

    private function flushPage(): void
    {
        $this->pages[] = $this->stream;
        $this->stream = '';
        $this->cursorY = 0;
        $this->pageStarted = true;
    }

    /** One already-fitted line, drawn at the current cursor and advanced past. */
    private function line(string $text, float $size, bool $bold, array $color, string $align = 'left', float $spacing = 0): void
    {
        $lineHeight = $size * 1.5;
        $this->ensureSpace($lineHeight);
        $this->text($text, $size, $bold, $color, align: $align, spacing: $spacing);
        $this->cursorY += $lineHeight;
    }

    /**
     * Word-wraps plain text to the content width and draws every resulting
     * line, breaking to a new page mid-paragraph when needed.
     */
    private function wrap(string $text, float $size, bool $bold, array $color, string $align = 'left', float $indent = 0, ?string $marker = null): void
    {
        $this->wrapRuns([[$text, $bold]], $size, $color, $align, $indent, $marker);
    }

    /**
     * @param  list<array{0: string, 1: bool}>  $parts
     */
    private function wrapRuns(array $parts, float $size, array $color, string $align = 'left', float $indent = 0, ?string $marker = null): void
    {
        $tokens = [];
        // Whether the text so far ended in whitespace — false right after a
        // run like "Consulting" is what tells the next run's leading "."
        // (from ". You will…") to glue onto it instead of opening with a
        // rendered space, the way a real sentence's punctuation always
        // sits flush against the word before it regardless of which bold
        // run that word happened to be written in.
        $prevHadTrailingSpace = true;

        foreach ($parts as [$text, $bold]) {
            if ($text === '') {
                continue;
            }

            $leadingSpace = (bool) preg_match('/^\s/', $text);
            $trailingSpace = (bool) preg_match('/\s$/', $text);
            $firstWordOfRun = true;

            foreach (preg_split('/(\n)/', $text, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [$text] as $chunk) {
                if ($chunk === "\n") {
                    $tokens[] = ['break' => true];
                    $prevHadTrailingSpace = true;
                    $firstWordOfRun = true;

                    continue;
                }

                foreach (preg_split('/\s+/', trim($chunk)) ?: [] as $word) {
                    if ($word === '') {
                        continue;
                    }

                    $glue = $firstWordOfRun && ! $leadingSpace && ! $prevHadTrailingSpace && $tokens !== [];

                    if ($glue) {
                        $tokens[count($tokens) - 1]['text'] .= $word;
                    } else {
                        $tokens[] = ['text' => $word, 'bold' => $bold];
                    }

                    $firstWordOfRun = false;
                }
            }

            $prevHadTrailingSpace = $trailingSpace;
        }

        $availWidth = self::CONTENT_W - $indent - ($marker ? 20 : 0);
        $spaceW = $this->width(' ', $size, false);
        $lineHeight = $size * 1.45;

        $lines = [[]];
        $widths = [0.0];

        foreach ($tokens as $token) {
            if (isset($token['break'])) {
                $lines[] = [];
                $widths[] = 0.0;

                continue;
            }

            $cur = count($lines) - 1;
            $w = $this->width($token['text'], $size, $token['bold']);
            $needed = $lines[$cur] === [] ? $w : $spaceW + $w;

            if ($lines[$cur] !== [] && $widths[$cur] + $needed > $availWidth) {
                $lines[] = [];
                $widths[] = 0.0;
                $cur++;
                $needed = $w;
            }

            $lines[$cur][] = $token;
            $widths[$cur] += $needed;
        }

        foreach ($lines as $i => $lineTokens) {
            $this->ensureSpace($lineHeight);

            $x = self::MARGIN_LEFT + $indent;
            $y = self::PAGE_H - self::MARGIN_TOP - $this->cursorY - ($size * 0.82);

            if ($marker !== null && $i === 0) {
                $this->emitText($marker, $x - 20, $y, $size, false, $color);
            }

            if ($lineTokens === []) {
                $this->cursorY += $lineHeight;

                continue;
            }

            if ($align === 'right' || $align === 'center') {
                $total = 0.0;
                foreach ($lineTokens as $j => $t) {
                    $total += $this->width($t['text'], $size, $t['bold']) + ($j > 0 ? $spaceW : 0);
                }
                $x = $align === 'right'
                    ? self::MARGIN_LEFT + self::CONTENT_W - $total
                    : self::MARGIN_LEFT + ($indent + self::CONTENT_W - $indent - $total) / 2;
            }

            $cursor = $x;
            foreach ($lineTokens as $j => $t) {
                if ($j > 0) {
                    $cursor += $spaceW;
                }
                $this->emitText($t['text'], $cursor, $y, $size, $t['bold'], $color);
                $cursor += $this->width($t['text'], $size, $t['bold']);
            }

            $this->cursorY += $lineHeight;
        }
    }

    /**
     * A single already-short string, positioned by alignment at the current
     * cursor — used for titles and table cells. Two calls at the same
     * cursor position (a table row's label then its amount) land on the
     * same baseline for free, since neither call advances the cursor.
     */
    private function text(string $text, float $size, bool $bold, array $color, string $align = 'left', float $spacing = 0, float $indent = 0): void
    {
        $y = self::PAGE_H - self::MARGIN_TOP - $this->cursorY - ($size * 0.82);
        $w = $this->width($text, $size, $bold) + ($spacing > 0 ? $spacing * max(0, mb_strlen($text) - 1) : 0);

        $x = match ($align) {
            'right' => self::MARGIN_LEFT + self::CONTENT_W - $w,
            'center' => self::MARGIN_LEFT + $indent + (self::CONTENT_W - $indent - $w) / 2,
            default => self::MARGIN_LEFT + $indent,
        };

        $this->emitText($text, $x, $y, $size, $bold, $color, $spacing);
    }

    private function rule(float $weight, array $color, ?float $width = null): void
    {
        $this->ensureSpace($weight + 2);
        $y = self::PAGE_H - self::MARGIN_TOP - $this->cursorY;
        $w = $width ?? self::CONTENT_W;
        [$r, $g, $b] = $color;

        $this->stream .= sprintf(
            "%.3F %.3F %.3F RG %.2F w %.2F %.2F m %.2F %.2F l S\n",
            $r, $g, $b, $weight, self::MARGIN_LEFT, $y, self::MARGIN_LEFT + $w, $y,
        );
    }

    /** Points-per-pixel for an embedded raster image — 2x the box it's placed in, so it stays crisp if printed rather than looking like a screen-resolution logo. */
    private const IMAGE_SCALE = 2;

    /**
     * Reads an image file from disk and returns a JPEG sized to display at
     * `$displayW`x`$displayH` points (the logo's aspect ratio is
     * preserved within that box), rendered at `IMAGE_SCALE`x the pixel
     * count so it holds up in print, not just on screen.
     *
     * Always JPEG regardless of the source format: a PDF image XObject can
     * embed raw JPEG bytes as-is (`/Filter /DCTDecode`), which needs no
     * compression code of this writer's own — the same reasoning that
     * keeps this whole class free of a PDF library, applied one level
     * down. Transparency is flattened onto white first, since that is
     * what the logo will be sitting on regardless.
     *
     * Every failure mode (no GD, unreadable file, unsupported format)
     * returns null rather than throwing — a letter that arrives without
     * its logo is a cosmetic gap; one that fails to send because a
     * settings upload could not be re-read is a real problem.
     *
     * @return array{bytes: string, pixelW: int, pixelH: int, w: float, h: float}|null
     */
    private function loadLogo(string $path, float $displayW, float $displayH): ?array
    {
        if (! extension_loaded('gd') || ! is_file($path)) {
            return null;
        }

        $info = @getimagesize($path);

        if (! $info) {
            return null;
        }

        $src = match ($info[2]) {
            IMAGETYPE_PNG => @imagecreatefrompng($path),
            IMAGETYPE_JPEG => @imagecreatefromjpeg($path),
            IMAGETYPE_GIF => @imagecreatefromgif($path),
            IMAGETYPE_WEBP => @imagecreatefromwebp($path),
            default => null,
        };

        if (! $src) {
            return null;
        }

        $srcW = imagesx($src);
        $srcH = imagesy($src);
        // Fit within the display box first, then render at IMAGE_SCALE
        // times that many pixels — the box (in points) is what `image()`
        // draws at; the pixel count is only about sharpness.
        $fit = min($displayW / max($srcW, 1), $displayH / max($srcH, 1));
        $displayW = $srcW * $fit;
        $displayH = $srcH * $fit;
        $pixelW = max(1, (int) round($displayW * self::IMAGE_SCALE));
        $pixelH = max(1, (int) round($displayH * self::IMAGE_SCALE));

        $canvas = imagecreatetruecolor($pixelW, $pixelH);
        $white = imagecolorallocate($canvas, 255, 255, 255);
        imagefill($canvas, 0, 0, $white);
        imagealphablending($canvas, true);
        imagecopyresampled($canvas, $src, 0, 0, 0, 0, $pixelW, $pixelH, $srcW, $srcH);

        ob_start();
        imagejpeg($canvas, null, 88);
        $bytes = ob_get_clean();

        imagedestroy($canvas);
        imagedestroy($src);

        return $bytes ? [
            'bytes' => $bytes, 'pixelW' => $pixelW, 'pixelH' => $pixelH, 'w' => $displayW, 'h' => $displayH,
        ] : null;
    }

    /**
     * Places an already-loaded image (see `loadLogo`) at the cursor.
     *
     * `$offsetFromTop` nudges the image up or down relative to where the
     * cursor's top edge would otherwise put it — a small logo mark tends
     * to look better a couple of points higher than raw baseline math
     * would place it, next to a cap-height line of text.
     */
    private function image(array $logo, float $x, float $cursorTop, float $offsetFromTop = 0): void
    {
        $this->images[] = $logo;
        $index = count($this->images);

        $topY = self::PAGE_H - self::MARGIN_TOP - $cursorTop + $offsetFromTop;
        $bottomY = $topY - $logo['h'];

        $this->stream .= sprintf("q %.2F 0 0 %.2F %.2F %.2F cm /Im%d Do Q\n", $logo['w'], $logo['h'], $x, $bottomY, $index);
    }

    /**
     * `Tc` (character spacing) is graphics state, not a `BT...ET`-scoped
     * property — set once by a letter-spaced title and never explicitly
     * reset, it silently widens every character in every word drawn for
     * the rest of the page. Always writing it, zero included, is what
     * keeps one call's spacing from leaking into the next.
     */
    private function emitText(string $text, float $x, float $y, float $size, bool $bold, array $color, float $spacing = 0): void
    {
        $font = $bold ? '/F2' : '/F1';
        [$r, $g, $b] = $color;
        $encoded = $this->pdfString($text);

        $this->stream .= sprintf(
            "BT %.3F %.3F %.3F rg %.2F Tc %s %.2F Tf 1 0 0 1 %.2F %.2F Tm (%s) Tj ET\n",
            $r, $g, $b, $spacing, $font, $size, $x, $y, $encoded,
        );
    }

    private function toUpper(string $text): string
    {
        return mb_strtoupper($text);
    }

    /** String width in points, for real Helvetica metrics. */
    private function width(string $text, float $size, bool $bold): float
    {
        $table = $bold ? self::WIDTHS_BOLD : self::WIDTHS_REGULAR;
        $bytes = mb_convert_encoding($text, 'Windows-1252', 'UTF-8');
        $units = 0;

        for ($i = 0, $len = strlen($bytes); $i < $len; $i++) {
            $code = ord($bytes[$i]);
            $units += $table[$code - 32] ?? ($bold ? 600 : 556);
        }

        return $units * $size / 1000;
    }

    /** WinAnsi bytes, with the two characters PDF's literal-string syntax reserves escaped. */
    private function pdfString(string $text): string
    {
        $bytes = mb_convert_encoding($text, 'Windows-1252', 'UTF-8');

        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $bytes);
    }

    /* ====================================================================== */
    /* Output                                                                  */
    /* ====================================================================== */

    /** The finished PDF, as bytes. */
    public function render(): string
    {
        $this->flushPage();
        $pageCount = count($this->pages);
        $imageCount = count($this->images);

        // Object numbers: 1 Catalog, 2 Pages, 3-4 fonts, 5..5+i-1 image
        // XObjects, 5+i..5+i+n-1 Page objects, then n Content streams.
        $fontsStart = 3;
        $imagesStart = 5;
        $pagesStart = $imagesStart + $imageCount;
        $contentsStart = $pagesStart + $pageCount;
        $totalObjects = $contentsStart + $pageCount;

        $kids = implode(' ', array_map(fn ($i) => ($pagesStart + $i).' 0 R', range(0, $pageCount - 1)));
        $xobjectDict = implode(' ', array_map(fn ($i) => '/Im'.($i + 1).' '.($imagesStart + $i).' 0 R', range(0, $imageCount - 1)));

        $objects = [];
        $objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
        $objects[2] = "<< /Type /Pages /Kids [{$kids}] /Count {$pageCount} >>";
        $objects[$fontsStart] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        $objects[$fontsStart + 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

        foreach ($this->pages as $i => $content) {
            $pageObj = $pagesStart + $i;
            $contentObj = $contentsStart + $i;

            $objects[$pageObj] = "<< /Type /Page /Parent 2 0 R "
                ."/MediaBox [0 0 ".self::PAGE_W." ".self::PAGE_H."] "
                ."/Resources << /Font << /F1 {$fontsStart} 0 R /F2 ".($fontsStart + 1)." 0 R >>"
                .($imageCount > 0 ? " /XObject << {$xobjectDict} >>" : '')." >> "
                ."/Contents {$contentObj} 0 R >>";
        }

        $pdf = "%PDF-1.4\n";
        $offsets = [];

        foreach ($objects as $num => $body) {
            $offsets[$num] = strlen($pdf);
            $pdf .= "{$num} 0 obj\n{$body}\nendobj\n";
        }

        foreach ($this->images as $i => $img) {
            // One object: the dictionary and the stream it describes must
            // be the same "N 0 obj ... endobj" block, not two separate
            // ones sharing a number — split apart, the xref's one offset
            // per object number can only point at one half, and the image
            // that reader follows has bytes with no dictionary telling it
            // how to decode them. PDF.js drops it silently rather than
            // erroring, which is exactly what made this look like the
            // logo simply hadn't been placed.
            $objNum = $imagesStart + $i;
            $dict = sprintf(
                '<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB '
                .'/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>',
                $img['pixelW'], $img['pixelH'], strlen($img['bytes']),
            );
            $offsets[$objNum] = strlen($pdf);
            $pdf .= "{$objNum} 0 obj\n{$dict}\nstream\n{$img['bytes']}\nendstream\nendobj\n";
        }

        foreach ($this->pages as $i => $content) {
            $contentObj = $contentsStart + $i;
            $length = strlen($content);
            $offsets[$contentObj] = strlen($pdf);
            $pdf .= "{$contentObj} 0 obj\n<< /Length {$length} >>\nstream\n{$content}endstream\nendobj\n";
        }

        $xrefStart = strlen($pdf);
        $pdf .= "xref\n0 ".($totalObjects + 1)."\n";
        $pdf .= "0000000000 65535 f \n";

        for ($n = 1; $n <= $totalObjects; $n++) {
            $pdf .= str_pad((string) ($offsets[$n] ?? 0), 10, '0', STR_PAD_LEFT)." 00000 n \n";
        }

        $pdf .= "trailer\n<< /Size ".($totalObjects + 1)." /Root 1 0 R >>\n";
        $pdf .= "startxref\n{$xrefStart}\n%%EOF";

        return $pdf;
    }
}
