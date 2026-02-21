<?php

namespace Force10\Laravel\Middleware;

use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

class Force10CacheControl
{
    public function handle(Request $request, Closure $next, string ...$directives): Response
    {
        $invalidate = [];

        foreach ($directives as $directive) {
            if (str_starts_with($directive, 'invalidate:')) {
                $invalidate[] = substr($directive, strlen('invalidate:'));
            }
        }

        if (! empty($invalidate)) {
            Inertia::share('_force10_server', [
                'invalidate' => $invalidate,
            ]);
        }

        return $next($request);
    }
}
