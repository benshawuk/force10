<?php

use Force10\Laravel\ComponentResolver;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    $this->resolver = new ComponentResolver();
});

it('resolves component from route defaults (Route::inertia)', function () {
    Route::inertia('/about', 'About');

    $routes = Route::getRoutes()->getRoutes();
    $lastRoute = end($routes);

    $component = $this->resolver->resolveFromRouteDefaults($lastRoute);
    expect($component)->toBe('About');
});

it('resolves component from controller Inertia::render call', function () {
    // Create a temporary controller file for testing
    $controllerContent = <<<'PHP'
    <?php
    namespace App\Http\Controllers;
    use Inertia\Inertia;
    class TestController
    {
        public function index()
        {
            return Inertia::render('Users/Index', ['users' => []]);
        }
    }
    PHP;

    $tmpFile = tempnam(sys_get_temp_dir(), 'force10_test_');
    file_put_contents($tmpFile, $controllerContent);

    $component = $this->resolver->parseControllerFile($tmpFile, 'index');
    expect($component)->toBe('Users/Index');

    unlink($tmpFile);
});

it('resolves component from controller inertia() helper call', function () {
    $controllerContent = <<<'PHP'
    <?php
    namespace App\Http\Controllers;
    class TestHelperController
    {
        public function show()
        {
            return inertia('Users/Show', ['user' => null]);
        }
    }
    PHP;

    $tmpFile = tempnam(sys_get_temp_dir(), 'force10_test_');
    file_put_contents($tmpFile, $controllerContent);

    $component = $this->resolver->parseControllerFile($tmpFile, 'show');
    expect($component)->toBe('Users/Show');

    unlink($tmpFile);
});

it('returns null when no component found', function () {
    $controllerContent = <<<'PHP'
    <?php
    namespace App\Http\Controllers;
    class NoInertiaController
    {
        public function index()
        {
            return response()->json(['data' => []]);
        }
    }
    PHP;

    $tmpFile = tempnam(sys_get_temp_dir(), 'force10_test_');
    file_put_contents($tmpFile, $controllerContent);

    $component = $this->resolver->parseControllerFile($tmpFile, 'index');
    expect($component)->toBeNull();

    unlink($tmpFile);
});

it('resolves component from closure route', function () {
    Route::get('/closure-test', function () {
        return \Inertia\Inertia::render('ClosurePage', ['data' => []]);
    });

    $routes = Route::getRoutes()->getRoutes();
    $lastRoute = end($routes);

    $component = $this->resolver->resolveFromClosure($lastRoute);
    expect($component)->toBe('ClosurePage');
});

it('resolves component from arrow function closure route', function () {
    Route::get('/arrow-test', fn () => \Inertia\Inertia::render('ArrowPage'));

    $routes = Route::getRoutes()->getRoutes();
    $lastRoute = end($routes);

    $component = $this->resolver->resolveFromClosure($lastRoute);
    expect($component)->toBe('ArrowPage');
});

it('resolves component from Fortify service provider', function () {
    // Create a fake FortifyServiceProvider
    $providerContent = <<<'PHP'
    <?php
    namespace App\Providers;
    class FortifyServiceProvider
    {
        public function boot(): void
        {
            Fortify::loginView(fn () => Inertia::render('auth/login'));
            Fortify::registerView(fn () => Inertia::render('auth/register'));
        }
    }
    PHP;

    $providerDir = app_path('Providers');
    if (! is_dir($providerDir)) {
        mkdir($providerDir, 0755, true);
    }
    file_put_contents(app_path('Providers/FortifyServiceProvider.php'), $providerContent);

    $result = $this->resolver->parseFortifyServiceProvider('loginView');
    expect($result)->toBe('auth/login');

    $result = $this->resolver->parseFortifyServiceProvider('registerView');
    expect($result)->toBe('auth/register');

    unlink(app_path('Providers/FortifyServiceProvider.php'));
});

it('handles invokable controllers', function () {
    $controllerContent = <<<'PHP'
    <?php
    namespace App\Http\Controllers;
    use Inertia\Inertia;
    class ShowDashboard
    {
        public function __invoke()
        {
            return Inertia::render('Dashboard');
        }
    }
    PHP;

    $tmpFile = tempnam(sys_get_temp_dir(), 'force10_test_');
    file_put_contents($tmpFile, $controllerContent);

    $component = $this->resolver->parseControllerFile($tmpFile, '__invoke');
    expect($component)->toBe('Dashboard');

    unlink($tmpFile);
});
