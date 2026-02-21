<?php

use Illuminate\Http\Request;
use Inertia\Inertia;
use Force10\Laravel\Middleware\Force10CacheControl;

it('shares invalidation patterns via Inertia', function () {
    $middleware = new Force10CacheControl();

    $middleware->handle(
        Request::create('/users', 'POST'),
        fn ($request) => response('ok'),
        'invalidate:/users/*',
        'invalidate:/dashboard',
    );

    $shared = Inertia::getShared('_force10_server');
    expect($shared)->toBe([
        'invalidate' => ['/users/*', '/dashboard'],
    ]);
});

it('does not share when no invalidation directives given', function () {
    $middleware = new Force10CacheControl();

    $middleware->handle(
        Request::create('/users', 'POST'),
        fn ($request) => response('ok'),
    );

    $shared = Inertia::getShared('_force10_server');
    expect($shared)->toBeNull();
});

it('registers the middleware alias', function () {
    $router = app('router');

    expect($router->getMiddleware())->toHaveKey('force10.cache');
});
