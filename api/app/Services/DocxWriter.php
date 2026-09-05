<?php

namespace App\Services;

/**
 * Writing a Word document, without a Word library.
 *
 * An employment offer has to arrive as a file the candidate can print, sign
 * and bring to their first day. A PDF would be the obvious choice and is the
 * wrong one here: HR edits these — a start date moves, a line is added about
 * reporting to a different site — and a PDF is a dead end for that. A .docx
 * opens in Word, in Google Docs and in the free office suite everybody
 * actually has, and it can be corrected without coming back to us.
 *
 * The format is a zip of XML, and this writes the four parts that make a
 * minimal valid one. It is deliberately small: paragraphs, headings, bullets,
 * a two-column table and a signature rule, which is every element an offer
 * letter and a referral slip contain between them. Anything more elaborate
 * belongs in a template file, not in generated markup.
 *
 * Dependency-free for the same reason `ResumeReader` is: the vendor directory
 * is shipped as-is to a shared host and `composer install` is not something
 * this project runs on the server.
 */
class DocxWriter
{
    /** @var list<string> The document body, as XML fragments. */
    private array $body = [];

    public const HEADING = 'heading';

    public const TITLE = 'title';

    /* ====================================================================== */
    /* Blocks */
    /* ====================================================================== */

    /** A document title — centred, large, letter-spaced. */
    public function title(string $text): self
    {
        $this->body[] = '<w:p>'
            .'<w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>'
            .$this->run($text, ['bold' => true, 'size' => 32, 'caps' => true, 'spacing' => 40])
            .'</w:p>';

        return $this;
    }

    /** A numbered clause heading, e.g. "1. Term of Employment Contract". */
    public function heading(string $text): self
    {
        $this->body[] = '<w:p>'
            .'<w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>'
            .$this->run($text, ['bold' => true, 'size' => 22])
            .'</w:p>';

        return $this;
    }

    /**
     * A paragraph.
     *
     * `bold` marks the whole run; for a line with one emphasised phrase, pass
     * the parts as an array of [text, isBold] pairs to `runs()` instead.
     */
    public function paragraph(string $text, array $options = []): self
    {
        $align = $options['align'] ?? 'left';
        $after = $options['after'] ?? 120;

        $this->body[] = '<w:p>'
            ."<w:pPr><w:jc w:val=\"{$align}\"/><w:spacing w:after=\"{$after}\" w:line=\"276\" w:lineRule=\"auto\"/></w:pPr>"
            .$this->run($text, $options)
            .'</w:p>';

        return $this;
    }

    /** A paragraph built from mixed emphasis: [['Total: ', true], ['₱920', false]]. */
    public function runs(array $parts, array $options = []): self
    {
        $align = $options['align'] ?? 'left';
        $xml = '';

        foreach ($parts as [$text, $bold]) {
            $xml .= $this->run($text, ['bold' => $bold] + $options);
        }

        $this->body[] = '<w:p>'
            ."<w:pPr><w:jc w:val=\"{$align}\"/><w:spacing w:after=\"120\" w:line=\"276\" w:lineRule=\"auto\"/></w:pPr>"
            .$xml
            .'</w:p>';

        return $this;
    }

    /**
     * A lettered or numbered list.
     *
     * Rendered as indented paragraphs carrying their own marker rather than as
     * a real Word numbering definition. A numbering definition means a fifth
     * part, a relationship to it and an abstract numbering id — a great deal
     * of markup for a list whose markers never need to renumber themselves.
     */
    public function list(array $items, string $style = 'letter'): self
    {
        foreach ($items as $i => $item) {
            $marker = match ($style) {
                'letter' => chr(97 + $i).'.',
                'number' => ($i + 1).'.',
                default => '•',
            };

            $this->body[] = '<w:p>'
                .'<w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr>'
                .$this->run("{$marker}\t{$item}", [])
                .'</w:p>';
        }

        return $this;
    }

    /**
     * A two-column money table — label on the left, amount right-aligned.
     *
     * @param  list<array{0: string, 1: string, 2?: bool}>  $rows
     */
    public function amounts(array $rows): self
    {
        $xml = '<w:tbl>'
            .'<w:tblPr><w:tblW w:w="5000" w:type="pct"/>'
            .'<w:tblBorders>'
            .'<w:top w:val="single" w:sz="4" w:color="D0D5DD"/>'
            .'<w:bottom w:val="single" w:sz="4" w:color="D0D5DD"/>'
            .'<w:insideH w:val="single" w:sz="4" w:color="E8EAEE"/>'
            .'</w:tblBorders>'
            .'<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/></w:tblCellMar>'
            .'</w:tblPr>';

        foreach ($rows as $row) {
            [$label, $amount] = $row;
            $bold = $row[2] ?? false;

            $xml .= '<w:tr>'
                .'<w:tc><w:tcPr><w:tcW w:w="3200" w:type="pct"/></w:tcPr><w:p>'
                .$this->run($label, ['bold' => $bold])
                .'</w:p></w:tc>'
                .'<w:tc><w:tcPr><w:tcW w:w="1800" w:type="pct"/></w:tcPr>'
                .'<w:p><w:pPr><w:jc w:val="right"/></w:pPr>'
                .$this->run($amount, ['bold' => $bold])
                .'</w:p></w:tc>'
                .'</w:tr>';
        }

        $this->body[] = $xml.'</w:tbl>';

        // A table butted straight against the next paragraph reads as cramped
        // in every Word version there is.
        return $this->spacer();
    }

    /** A blank line. */
    public function spacer(int $height = 120): self
    {
        $this->body[] = "<w:p><w:pPr><w:spacing w:after=\"{$height}\"/></w:pPr></w:p>";

        return $this;
    }

    /** A rule to sign over, with its caption underneath. */
    public function signatureLine(string $caption, string $under = ''): self
    {
        $this->body[] = '<w:p>'
            .'<w:pPr><w:spacing w:before="360" w:after="0"/>'
            .'<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr></w:pPr>'
            .'<w:r><w:t xml:space="preserve">     </w:t></w:r>'
            .'</w:p>';

        $this->body[] = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>'
            .$this->run($caption, ['size' => 18])
            .'</w:p>';

        if ($under !== '') {
            $this->body[] = '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>'
                .$this->run($under, ['size' => 18])
                .'</w:p>';
        }

        return $this;
    }

    /** Starts a new page. */
    public function pageBreak(): self
    {
        $this->body[] = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

        return $this;
    }

    /* ====================================================================== */
    /* Output */
    /* ====================================================================== */

    /**
     * The finished .docx, as bytes.
     *
     * Written through a temporary file because ZipArchive has no in-memory
     * mode; the file is read back and removed immediately.
     */
    public function render(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'docx');

        if ($path === false) {
            throw new \RuntimeException('Could not create a temporary file for the document.');
        }

        $zip = new \ZipArchive;

        if ($zip->open($path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            @unlink($path);

            throw new \RuntimeException('Could not open the document for writing.');
        }

        $zip->addFromString('[Content_Types].xml', $this->contentTypes());
        $zip->addFromString('_rels/.rels', $this->rootRels());
        $zip->addFromString('word/_rels/document.xml.rels', $this->documentRels());
        $zip->addFromString('word/styles.xml', $this->styles());
        $zip->addFromString('word/document.xml', $this->document());
        $zip->close();

        $bytes = (string) file_get_contents($path);
        @unlink($path);

        return $bytes;
    }

    /* ====================================================================== */

    /** One text run, with the handful of properties these documents use. */
    private function run(string $text, array $options): string
    {
        $properties = '';

        if (! empty($options['bold'])) {
            $properties .= '<w:b/>';
        }

        if (! empty($options['italic'])) {
            $properties .= '<w:i/>';
        }

        if (! empty($options['caps'])) {
            $properties .= '<w:caps/>';
        }

        if (! empty($options['size'])) {
            // Half-points, as Word measures them.
            $properties .= '<w:sz w:val="'.(int) $options['size'].'"/>';
        }

        if (! empty($options['spacing'])) {
            $properties .= '<w:spacing w:val="'.(int) $options['spacing'].'"/>';
        }

        if (! empty($options['color'])) {
            $properties .= '<w:color w:val="'.$options['color'].'"/>';
        }

        $properties = $properties !== '' ? "<w:rPr>{$properties}</w:rPr>" : '';

        /* A tab inside the text is a real tab element, and a newline is a real
           break. Escaping them as characters produces a paragraph with visible
           control codes in it, which is exactly how generated documents end up
           looking generated. */
        $parts = preg_split('/(\t|\n)/', $text, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [$text];

        $xml = '';

        foreach ($parts as $part) {
            if ($part === "\t") {
                $xml .= '<w:tab/>';
            } elseif ($part === "\n") {
                $xml .= '<w:br/>';
            } elseif ($part !== '') {
                $xml .= '<w:t xml:space="preserve">'.htmlspecialchars($part, ENT_XML1 | ENT_QUOTES, 'UTF-8').'</w:t>';
            }
        }

        return "<w:r>{$properties}{$xml}</w:r>";
    }

    private function document(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            .'<w:body>'
            .implode('', $this->body)
            // A4 with 1-inch margins. Twips: 11906 x 16838, margin 1440.
            .'<w:sectPr>'
            .'<w:pgSz w:w="11906" w:h="16838"/>'
            .'<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>'
            .'</w:sectPr>'
            .'</w:body></w:document>';
    }

    private function styles(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            .'<w:docDefaults><w:rPrDefault><w:rPr>'
            .'<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
            .'<w:sz w:val="22"/><w:szCs w:val="22"/>'
            .'</w:rPr></w:rPrDefault></w:docDefaults>'
            .'<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
            .'<w:name w:val="Normal"/><w:qFormat/>'
            .'</w:style>'
            .'</w:styles>';
    }

    private function contentTypes(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            .'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            .'<Default Extension="xml" ContentType="application/xml"/>'
            .'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            .'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            .'</Types>';
    }

    private function rootRels(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            .'</Relationships>';
    }

    private function documentRels(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            .'</Relationships>';
    }
}
