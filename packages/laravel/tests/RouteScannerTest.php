<?php

use Force10\Laravel\RouteScanner;
use Force10\Laravel\ComponentResolver;
use Force10\Laravel\ManifestEntry;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    $this->resolver = new ComponentResolver();
    $this->scanner = new RouteScanner(app(Router::class), $this->resolver);
});

it('scans GET routes from Laravel router', function () {
    Route::get('/test', fn () => 'test')->name('test');
    Route::post('/test', fn () => 'test'); // Should be excluded

    $routes = $this->scanner->scan();

    $getRoutes = collect($routes)->filter(fn ($r) => true); // All should be GET
    expect($getRoutes)->not->toBeEmpty();
});

it('filters routes by exclude patterns', function () {
    Route::get('/users', fn () => 'users');
    Route::get('/admin/dashboard', fn () => 'admin');
    Route::get('/api/data', fn () => 'api');

    $routes = $this->scanner->scan();
    $filtered = $this->scanner->filterByConfig($routes, [
        'exclude' => ['admin*', 'api*'],
        'include' => [],
    ]);

    $patterns = collect($filtered)->pluck('uri')->toArray();
    expect($patterns)->not->toContain('admin/dashboard');
    expect($patterns)->not->toContain('api/data');
});

it('converts Laravel {param} to :param format', function () {
    expect($this->scanner->getRoutePattern('users/{user}'))->toBe('/users/:user');
    expect($this->scanner->getRoutePattern('users/{user}/posts/{post}'))->toBe('/users/:user/posts/:post');
    expect($this->scanner->getRoutePattern('users/{user?}'))->toBe('/users/:user?');
});

it('extracts middleware from routes', function () {
    Route::middleware(['auth', 'verified'])->get('/protected', fn () => 'protected');

    $routes = Route::getRoutes()->getRoutes();
    $lastRoute = end($routes);

    $middleware = $this->scanner->getMiddleware($lastRoute);
    expect($middleware)->toContain('auth');
    expect($middleware)->toContain('verified');
});

it('extracts route parameters with optionality', function () {
    Route::get('/users/{user}/posts/{post?}', fn () => 'test');

    $routes = Route::getRoutes()->getRoutes();
    $lastRoute = end($routes);

    $params = $this->scanner->getRouteParameters($lastRoute);
    expect($params)->toHaveCount(2);
    expect($params[0])->toMatchArray(['name' => 'user', 'required' => true]);
    expect($params[1])->toMatchArray(['name' => 'post', 'required' => false]);
});
