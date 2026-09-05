<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ResourceWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Serves every list endpoint from the registry in config/erp.php.
 *
 * One controller instead of fifty-four, because every list page needs the same
 * five things: eager loading, a scope, a sort, a field map, and JSON out. Where
 * an endpoint needs real behaviour it gets its own controller instead.
 */
class ResourceController extends Controller
{
    public function __construct(private readonly ResourceWriter $writer) {}

    public function index(Request $request, string $resource): JsonResponse
    {
        $config = $this->config($resource);

        $query = $config['model']::query()
            ->with($this->eagerLoads($config))
            ->when($config['scope'] ?? null, fn (Builder $q, array $scope) => $q->where($scope))
            ->when($config['scopeRelation'] ?? null, function (Builder $q, array $scopes) {
                // 'hrDepartment.code' => 'MAINTENANCE' becomes a whereHas.
                foreach ($scopes as $path => $value) {
                    [$relation, $column] = explode('.', $path, 2);
                    $q->whereHas($relation, fn (Builder $sub) => $sub->where($column, $value));
                }
            })
            ->when($config['scopeIn'] ?? null, function (Builder $q, array $scopes) {
                // A column restricted to a set: 'status' => ['Approved', 'Partial'].
                foreach ($scopes as $column => $values) {
                    $q->whereIn($column, $values);
                }
            })
            ->when($config['scopeRelationIn'] ?? null, function (Builder $q, array $scopes) {
                // Same, but for a set: 'hrDepartment.code' => ['OPERATIONS', 'WAREHOUSE'].
                foreach ($scopes as $path => $values) {
                    [$relation, $column] = explode('.', $path, 2);
                    $q->whereHas($relation, fn (Builder $sub) => $sub->whereIn($column, $values));
                }
            });

        foreach ($this->countRelations($config) as $relation) {
            $query->withCount($relation);
        }

        foreach ($config['sums'] ?? [] as $relation => $columns) {
            foreach (array_keys($columns) as $column) {
                $query->withSum($relation, $column);
            }
        }

        foreach ($config['sort'] ?? ['id' => 'asc'] as $column => $direction) {
            $query->orderBy($column, $direction);
        }

        if ($limit = $config['limit'] ?? null) {
            $query->limit($limit);
        }

        $rows = $query->get()->map(fn (Model $row) => $this->transform($row, $config));

        return response()->json(['data' => $rows]);
    }

    public function show(Request $request, string $resource, int $id): JsonResponse
    {
        $config = $this->config($resource);

        $row = $config['model']::query()->with($this->eagerLoads($config))->findOrFail($id);

        return response()->json(['data' => $this->transform($row, $config)]);
    }

    public function store(Request $request, string $resource): JsonResponse
    {
        $config = $this->config($resource);

        $record = $this->writer->create($resource, $config, $request->all());

        return response()->json(['data' => $this->reload($record, $config)], 201);
    }

    public function update(Request $request, string $resource, int $id): JsonResponse
    {
        $config = $this->config($resource);
        $record = $config['model']::findOrFail($id);

        $updated = $this->writer->update($resource, $config, $record, $request->all());

        return response()->json(['data' => $this->reload($updated, $config)]);
    }

    public function destroy(Request $request, string $resource, int $id): JsonResponse
    {
        $config = $this->config($resource);
        $record = $config['model']::findOrFail($id);

        // Bypassing a delete guard is reserved for the one role that answers
        // for the whole system, and even then only on request — an ordinary
        // delete must never silently escalate into one that skips the rule
        // protecting an approved payroll run or a closed statutory filing.
        $force = $request->boolean('force') && (bool) $request->user()?->is_super_admin;

        $this->writer->delete($resource, $config, $record, $force);

        return response()->json(['data' => ['deleted' => true]]);
    }

    /**
     * Re-reads a saved record through the same query the list uses, so the
     * response carries relation names and counts rather than raw foreign keys.
     */
    private function reload(Model $record, array $config): array
    {
        $query = $config['model']::query()->with($this->eagerLoads($config));

        foreach ($this->countRelations($config) as $relation) {
            $query->withCount($relation);
        }
        foreach ($config['sums'] ?? [] as $relation => $columns) {
            foreach (array_keys($columns) as $column) {
                $query->withSum($relation, $column);
            }
        }

        return $this->transform($query->findOrFail($record->getKey()), $config);
    }

    /**
     * Relations to eager-load: whatever the entry declares, plus the line
     * relation when the document has one, since every row now returns its lines.
     */
    private function eagerLoads(array $config): array
    {
        $with = $config['with'] ?? [];

        if ($relation = $config['write']['lines']['relation'] ?? null) {
            $with[] = $relation;
        }

        return array_unique($with);
    }

    /** Resolves the registry entry, or 404s on an unknown endpoint. */
    private function config(string $resource): array
    {
        $config = config("erp.resources.{$resource}");

        if (! $config) {
            throw new NotFoundHttpException("Unknown resource [{$resource}].");
        }

        return $config;
    }

    /**
     * `counts` accepts either a bare relation name (the field map picks up the
     * `*_count` column) or relation => output field.
     */
    private function countRelations(array $config): array
    {
        $relations = [];
        foreach ($config['counts'] ?? [] as $key => $value) {
            $relations[] = is_int($key) ? $value : $key;
        }

        return $relations;
    }

    /** Projects a model onto the JSON contract the frontend expects. */
    private function transform(Model $row, array $config): array
    {
        $out = [];

        foreach ($config['map'] ?? [] as $field => $path) {
            $out[$field] = $this->value($row, $path);
        }

        // Booleans the AUB masterfile and other exports express as YES / NO.
        foreach ($config['booleansAsYesNo'] ?? [] as $field => $column) {
            $out[$field] = $row->{$column} ? 'YES' : 'NO';
        }

        foreach ($config['counts'] ?? [] as $key => $value) {
            if (is_int($key)) {
                continue;   // handled by the field map
            }
            $out[$value] = (int) $row->{Str::snake($key).'_count'};
        }

        foreach ($config['sums'] ?? [] as $relation => $columns) {
            foreach ($columns as $column => $field) {
                $out[$field] = (float) ($row->{Str::snake($relation).'_sum_'.$column} ?? 0);
            }
        }

        foreach ($config['computed'] ?? [] as $field => $callable) {
            $out[$field] = $callable($row);
        }

        // A document's own lines, in the same field names the form posts back.
        // Without this an edit form opens with an empty line editor and saving
        // it would delete the lines the document already had.
        if ($spec = $config['write']['lines'] ?? null) {
            $out['lineItems'] = $row->{$spec['relation']}
                ->map(fn (Model $line) => collect($spec['fields'])
                    ->map(fn (string $column) => $this->value($line, $column))
                    ->all())
                ->values()
                ->all();
        }

        return $out;
    }

    /**
     * Reads a dotted path off the model. Dates go out as ISO strings because
     * that is what the browser's Date constructor parses reliably.
     */
    private function value(Model $row, string $path): mixed
    {
        $value = data_get($row, $path);

        if ($value instanceof \DateTimeInterface) {
            return $value->format(\DateTimeInterface::ATOM);
        }

        if (is_string($value) && is_numeric($value) && str_contains($value, '.')) {
            // Decimal casts come back as strings; the frontend expects numbers.
            return (float) $value;
        }

        return $value;
    }
}
