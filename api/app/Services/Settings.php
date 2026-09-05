<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;

/**
 * Runtime configuration held in the database rather than .env, so an
 * administrator can change company details, SMTP and security policy from the
 * Admin screens without a deployment.
 *
 * Values of type `secret` are encrypted at rest — the SMTP password should not
 * be readable by anyone with a database viewer open.
 */
class Settings
{
    private const CACHE_KEY = 'erp.settings';

    private const CACHE_TTL = 3600;

    /** @return array<string, mixed> */
    public function group(string $group): array
    {
        return $this->all()[$group] ?? [];
    }

    public function get(string $group, string $key, mixed $default = null): mixed
    {
        return $this->all()[$group][$key] ?? $default;
    }

    public function set(string $group, string $key, mixed $value, string $type = 'string'): void
    {
        Setting::updateOrCreate(
            ['group' => $group, 'key' => $key],
            ['value' => $this->encode($value, $type), 'type' => $type],
        );

        $this->flush();
    }

    /** @param array<string, mixed> $values */
    public function setMany(string $group, array $values, array $types = []): void
    {
        foreach ($values as $key => $value) {
            $type = $types[$key] ?? 'string';
            Setting::updateOrCreate(
                ['group' => $group, 'key' => $key],
                ['value' => $this->encode($value, $type), 'type' => $type],
            );
        }

        $this->flush();
    }

    public function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /** @return array<string, array<string, mixed>> */
    public function all(): array
    {
        return Cache::remember(self::CACHE_KEY, self::CACHE_TTL, function () {
            $out = [];
            foreach (Setting::all() as $setting) {
                $out[$setting->group][$setting->key] = $this->decode($setting->value, $setting->type);
            }

            return $out;
        });
    }

    /**
     * Secrets are returned masked for display. Use `secret()` when the real
     * value is actually needed to open a connection.
     */
    public function forDisplay(string $group): array
    {
        $values = $this->group($group);

        foreach (Setting::where('group', $group)->where('type', 'secret')->pluck('key') as $key) {
            $values[$key] = filled($values[$key] ?? null) ? '********' : '';
        }

        return $values;
    }

    public function secret(string $group, string $key): ?string
    {
        $value = $this->get($group, $key);

        return $value === '' ? null : $value;
    }

    private function encode(mixed $value, string $type): ?string
    {
        return match ($type) {
            'json' => json_encode($value),
            'boolean' => $value ? '1' : '0',
            'secret' => filled($value) ? Crypt::encryptString((string) $value) : null,
            default => $value === null ? null : (string) $value,
        };
    }

    private function decode(?string $value, string $type): mixed
    {
        if ($value === null) {
            return $type === 'boolean' ? false : null;
        }

        return match ($type) {
            'json' => json_decode($value, true),
            'boolean' => $value === '1',
            'integer' => (int) $value,
            // A secret written before the app key changed cannot be read back;
            // treat it as unset rather than crashing every request.
            'secret' => rescue(fn () => Crypt::decryptString($value), null, false),
            default => $value,
        };
    }
}
