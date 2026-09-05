<?php

namespace App\Services;

use App\Models\Item;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Creates, updates and deletes records described by the registry in
 * config/erp.php.
 *
 * The read side already maps database columns onto the JSON the React app
 * expects; this is the same idea in reverse, so a form and a table always
 * agree about what a field is called. Validation lives in the registry too —
 * a screen cannot save something the API would reject.
 */
class ResourceWriter
{
    public function __construct(
        private readonly AuditLogger $audit,
        private readonly ResourceGuards $guards,
    ) {}

    /** @throws ValidationException */
    public function create(string $resource, array $config, array $input): Model
    {
        $write = $this->writeConfig($resource, $config);
        $data = $this->validate($write, $input, null);

        return DB::transaction(function () use ($config, $write, $data, $input, $resource) {
            $attributes = $this->toColumns($write, $data);

            foreach ($write['defaults'] ?? [] as $column => $value) {
                $attributes[$column] ??= $value;
            }

            // Documents get their reference number from the server, never the
            // client — two people pressing Save must not produce SO-2026-0007
            // twice.
            if ($number = $write['number'] ?? null) {
                $attributes[$number['column']] = $this->nextNumber($config['model'], $number);
            }

            $record = $config['model']::create($attributes);

            $this->syncLines($record, $write, $input);

            $this->audit->log(
                'created a record',
                class_basename($config['model']),
                $record->getKey(),
                $this->labelFor($record, $write),
                explode('/', $resource)[0],
            );

            return $record;
        });
    }

    /** @throws ValidationException */
    public function update(string $resource, array $config, Model $record, array $input): Model
    {
        $write = $this->writeConfig($resource, $config);

        // Checked before validation, so a refusal is not buried under a list
        // of field errors the user cannot act on anyway.
        if ($refusal = $this->guards->forUpdate($resource, $record)) {
            abort(422, $refusal);
        }

        $data = $this->validate($write, $input, $record->getKey());

        return DB::transaction(function () use ($write, $data, $input, $record, $resource) {
            $original = $record->getOriginal();

            // Only the fields the form actually sent are touched, so a partial
            // save cannot blank out a column the screen does not show.
            $record->update($this->toColumns($write, $data, only: array_keys($data)));

            $this->syncLines($record, $write, $input);

            $this->audit->logModel('updated a record', $record, explode('/', $resource)[0], $original);

            return $record->fresh();
        });
    }

    public function delete(string $resource, array $config, Model $record, bool $force = false): void
    {
        $write = $this->writeConfig($resource, $config);

        $refusal = $this->guards->forDelete($resource, $record);

        // A forced delete does not make the reason for the refusal disappear
        // — it is still true that the run was approved, or the case still
        // has an open balance. `$force` only decides who gets to proceed
        // anyway, never that there was nothing to warn about.
        if ($refusal && ! $force) {
            abort(422, $refusal);
        }

        $label = $this->labelFor($record, $write);
        $forced = $refusal && $force;

        DB::transaction(function () use ($record, $config, $label, $resource, $forced, $refusal) {
            $record->delete();

            $this->audit->log(
                $forced ? 'force-deleted a record, bypassing a safety guard' : 'deleted a record',
                class_basename($config['model']),
                $record->getKey(),
                $label,
                explode('/', $resource)[0],
                $forced ? ['guardRefused' => $refusal] : null,
            );
        });
    }

    /**
     * Replaces a document's line items and recalculates its totals.
     *
     * Lines are the source of truth: a header total that disagrees with the
     * sum of its lines is the classic ERP data bug, so the header is always
     * derived here rather than trusted from the client.
     */
    private function syncLines(Model $record, array $write, array $input): void
    {
        $spec = $write['lines'] ?? null;

        // Absent key means "leave the lines alone"; an empty array means
        // "remove them all". Those are different intentions.
        if (! $spec || ! array_key_exists($spec['input'] ?? 'lines', $input)) {
            return;
        }

        $rows = $input[$spec['input'] ?? 'lines'] ?? [];
        abort_unless(is_array($rows), 422, 'Line items must be a list.');

        $validated = [];
        foreach ($rows as $index => $row) {
            $validated[] = Validator::make(
                is_array($row) ? $row : [],
                $spec['rules'],
                [],
                [],
            )->validate() + ['__index' => $index];
        }

        $record->{$spec['relation']}()->delete();

        $subtotal = 0.0;
        $cost = 0.0;

        foreach ($validated as $row) {
            $attributes = [];
            foreach ($spec['fields'] as $field => $column) {
                if (array_key_exists($field, $row)) {
                    $attributes[$column] = $row[$field];
                }
            }

            $quantity = (float) ($row['quantity'] ?? 0);
            $price = (float) ($row['unitPrice'] ?? 0);
            $discount = (float) ($row['discountPct'] ?? 0);
            $lineTotal = round($quantity * $price * (1 - $discount / 100), 2);

            // Not every line is a money line. A goods receipt line records how
            // many arrived and how many were turned away; there is nothing to
            // extend and no column to put it in.
            $totalColumn = array_key_exists('line_total_column', $spec)
                ? $spec['line_total_column']
                : 'line_total';

            if ($totalColumn) {
                $attributes[$totalColumn] = $lineTotal;
            }

            $subtotal += $lineTotal;

            // Cost comes from the item master, never the form — otherwise
            // anyone could type a margin into existence. A quotation has no
            // per-line cost column but still wants a header margin, so the two
            // are separate switches.
            if ((isset($spec['cost_column']) || ! empty($spec['cost_from_items'])) && ! empty($attributes['item_id'])) {
                $unitCost = (float) (Item::whereKey($attributes['item_id'])->value('unit_cost') ?? 0);

                if (isset($spec['cost_column'])) {
                    $attributes[$spec['cost_column']] = $unitCost;
                }

                $cost += $unitCost * $quantity;
            }

            $record->{$spec['relation']}()->create($attributes);
        }

        $totals = ['subtotal' => round($subtotal, 2), 'total' => round($subtotal, 2)];

        if (isset($spec['cost_column']) || ! empty($spec['cost_from_items'])) {
            $totals['cost_total'] = round($cost, 2);
            $totals['margin_pct'] = $subtotal > 0 ? round((($subtotal - $cost) / $subtotal) * 100, 2) : 0;
        }

        $header = array_intersect_key($totals, array_flip($spec['header_columns'] ?? array_keys($totals)));

        // Not every document calls its money column `total`. A requisition
        // carries an `amount`; renaming here beats a bespoke writer for it.
        foreach ($spec['header_map'] ?? [] as $from => $column) {
            if (array_key_exists($from, $totals)) {
                $header[$column] = $totals[$from];
            }
        }

        if ($column = $spec['count_column'] ?? null) {
            $header[$column] = count($validated);
        }

        // Quantity roll-ups — a goods receipt totals what arrived and what was
        // turned away, neither of which is a money column.
        foreach ($spec['sum_columns'] ?? [] as $lineField => $column) {
            $header[$column] = round(array_sum(array_map(
                fn (array $row) => (float) ($row[$lineField] ?? 0),
                $validated,
            )), 2);
        }

        $record->forceFill($header)->save();
    }

    /* ---------------------------------------------------------------------- */

    private function writeConfig(string $resource, array $config): array
    {
        $write = $config['write'] ?? null;

        abort_if(! $write, 405, "The {$resource} list is read-only.");

        return $write;
    }

    /** @throws ValidationException */
    private function validate(array $write, array $input, mixed $id): array
    {
        $rules = $write['rules'] ?? [];

        // `unique:table,column` needs the current row excluded on an update,
        // or saving a record without changing its code fails against itself.
        if ($id !== null) {
            foreach ($rules as $field => $rule) {
                $rules[$field] = is_string($rule)
                    ? preg_replace('/(unique:[^|,]+,[^|,]+)/', '$1,'.$id, $rule)
                    : array_map(
                        fn ($r) => is_string($r) ? preg_replace('/^(unique:[^,]+,[^,]+)$/', '$1,'.$id, $r) : $r,
                        $rule,
                    );
            }

            // On update only validate what was submitted.
            $rules = array_intersect_key($rules, $input);
        }

        return Validator::make($input, $rules, [], $write['labels'] ?? [])->validate();
    }

    /**
     * Maps JSON field names onto database columns.
     *
     * @param  array<int, string>|null  $only  Restrict to these JSON fields.
     */
    private function toColumns(array $write, array $data, ?array $only = null): array
    {
        $out = [];

        foreach ($write['fields'] as $field => $column) {
            if ($only !== null && ! in_array($field, $only, true)) {
                continue;
            }
            if (! array_key_exists($field, $data)) {
                continue;
            }

            $value = $data[$field];

            // Empty strings from a form mean "not set", not an empty value.
            $out[$column] = $value === '' ? null : $value;
        }

        return $out;
    }

    /** Next sequential document number, e.g. SO-2026-0042. */
    private function nextNumber(string $model, array $config): string
    {
        $column = $config['column'];
        $prefix = $config['prefix'] ?? '';
        $digits = $config['digits'] ?? 4;
        $yearly = $config['yearly'] ?? true;

        $stem = $yearly ? $prefix.date('Y').'-' : $prefix;

        // Lock the table so two concurrent saves cannot pick the same number.
        $last = $model::query()
            ->where($column, 'like', $stem.'%')
            ->orderByDesc($column)
            ->lockForUpdate()
            ->value($column);

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : ($config['start'] ?? 1);

        return $stem.str_pad((string) $next, $digits, '0', STR_PAD_LEFT);
    }

    private function labelFor(Model $record, array $write): ?string
    {
        $column = $write['label'] ?? null;

        if ($column && filled($record->{$column} ?? null)) {
            return (string) $record->{$column};
        }

        foreach (['name', 'code', 'order_no', 'quote_no', 'title'] as $candidate) {
            if (filled($record->{$candidate} ?? null)) {
                return (string) $record->{$candidate};
            }
        }

        return null;
    }
}
