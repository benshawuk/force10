<?php

namespace Force10\Laravel;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class PreflightChecker
{
    protected array $evaluators = [];

    public function __construct()
    {
        $this->register('auth', function (Request $r, ?string $guard = null) {
            return ['pass' => auth($this->resolveGuard($guard))->check()];
        });

        $this->register('guest', function (Request $r, ?string $guard = null) {
            return ['pass' => !auth($this->resolveGuard($guard))->check()];
        });

        $this->register('verified', function (Request $r, ?string $guard = null) {
            return ['pass' => auth($this->resolveGuard($guard))->user()?->hasVerifiedEmail() ?? false];
        });

        $this->register('password.confirm', function (Request $r) {
            $confirmedAt = session('auth.password_confirmed_at');
            $timeout = config('auth.password_timeout', 10800);

            if (!$confirmedAt) {
                return ['pass' => false];
            }

            $expiresAt = $confirmedAt + $timeout;

            return ['pass' => time() < $expiresAt, 'expiresAt' => $expiresAt];
        });
    }

    /**
     * Resolve a guard name, falling back to default if the guard isn't configured.
     */
    protected function resolveGuard(?string $guard): ?string
    {
        if ($guard === null) {
            return null;
        }

        $guards = config('auth.guards', []);

        return isset($guards[$guard]) ? $guard : null;
    }

    public function register(string $middleware, Closure $evaluator): void
    {
        $this->evaluators[$middleware] = $evaluator;
    }

    /**
     * Evaluate all middleware present across manifest routes.
     *
     * @param  string[]  $manifestMiddleware
     * @return array<string, array{pass: bool, expiresAt?: int}>
     */
    public function evaluate(Request $request, array $manifestMiddleware): array
    {
        $results = [];

        foreach (array_unique($manifestMiddleware) as $mw) {
            $name = Str::before($mw, ':');
            $params = Str::contains($mw, ':') ? Str::after($mw, ':') : null;

            if (isset($this->evaluators[$name])) {
                $results[$mw] = ($this->evaluators[$name])($request, $params);
            }
        }

        return $results;
    }
}
