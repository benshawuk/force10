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
        $this->register('auth', fn (Request $r) => ['pass' => auth()->check()]);

        $this->register('guest', fn (Request $r) => ['pass' => !auth()->check()]);

        $this->register('verified', fn (Request $r) => [
            'pass' => auth()->user()?->hasVerifiedEmail() ?? false,
        ]);

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

            if (isset($this->evaluators[$name])) {
                $results[$mw] = ($this->evaluators[$name])($request);
            }
        }

        return $results;
    }
}
