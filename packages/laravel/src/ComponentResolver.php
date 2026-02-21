<?php

namespace Force10\Laravel;

use Illuminate\Routing\Route;
use ReflectionClass;
use ReflectionException;
use ReflectionFunction;

/**
 * Resolves Inertia component names from Laravel routes.
 *
 * Supported patterns (in resolution order):
 *   1. Route::inertia('/path', 'Component')  — reads from route defaults
 *   2. Inertia::render('Component', [...])    — parsed from controller source
 *   3. inertia('Component', [...])            — parsed from controller source
 *   4. Invokable controllers (__invoke)       — same parsing as #2/#3
 *
 * Unsupported patterns:
 *   - Dynamic component names: Inertia::render($component)
 *   - Conditional renders: only the first Inertia::render() call in a method is matched
 *   - Components returned from other methods: $this->renderPage()
 *
 * Use `php artisan force10:generate --verbose` to see which routes were skipped and why.
 */
class ComponentResolver
{
    /**
     * Resolve the Inertia component name for a route.
     * Tries route defaults first, then parses the controller.
     */
    public function resolve(Route $route): ?string
    {
        return $this->resolveFromRouteDefaults($route)
            ?? $this->resolveFromClosure($route)
            ?? $this->resolveFromFortify($route)
            ?? $this->resolveFromController($route);
    }

    /**
     * Check route defaults for component name (Route::inertia routes).
     */
    public function resolveFromRouteDefaults(Route $route): ?string
    {
        $defaults = $route->defaults;

        return $defaults['component'] ?? null;
    }

    /**
     * Parse closure source for Inertia::render() or inertia() calls.
     */
    public function resolveFromClosure(Route $route): ?string
    {
        $action = $route->getAction();
        $uses = $action['uses'] ?? null;

        if (! $uses instanceof \Closure) {
            return null;
        }

        try {
            $reflection = new ReflectionFunction($uses);
            $file = $reflection->getFileName();
            $startLine = $reflection->getStartLine();
            $endLine = $reflection->getEndLine();

            if ($file === false || $startLine === false || $endLine === false) {
                return null;
            }

            $lines = file($file);

            if ($lines === false) {
                return null;
            }

            $closureSource = implode('', array_slice($lines, $startLine - 1, $endLine - $startLine + 1));

            return $this->parseSourceForComponent($closureSource);
        } catch (\ReflectionException) {
            return null;
        }
    }

    /**
     * Resolve component from Fortify view registrations in FortifyServiceProvider.
     *
     * Fortify controllers delegate rendering to closures registered via Fortify::loginView(),
     * Fortify::registerView(), etc. This method maps known Fortify controllers to their
     * corresponding view method name, then parses the FortifyServiceProvider for the
     * Inertia::render() call inside that registration.
     */
    public function resolveFromFortify(Route $route): ?string
    {
        if (! class_exists(\Laravel\Fortify\Fortify::class)) {
            return null;
        }

        $action = $route->getAction();
        $uses = $action['uses'] ?? null;

        if ($uses === null || ! is_string($uses)) {
            return null;
        }

        // Map Fortify controllers to their Fortify::*View() method names
        $fortifyViewMethods = [
            'Laravel\Fortify\Http\Controllers\AuthenticatedSessionController@create' => 'loginView',
            'Laravel\Fortify\Http\Controllers\RegisteredUserController@create' => 'registerView',
            'Laravel\Fortify\Http\Controllers\PasswordResetLinkController@create' => 'requestPasswordResetLinkView',
            'Laravel\Fortify\Http\Controllers\NewPasswordController@create' => 'resetPasswordView',
            'Laravel\Fortify\Http\Controllers\EmailVerificationPromptController' => 'verifyEmailView',
            'Laravel\Fortify\Http\Controllers\ConfirmablePasswordController@show' => 'confirmPasswordView',
            'Laravel\Fortify\Http\Controllers\TwoFactorAuthenticatedSessionController@create' => 'twoFactorChallengeView',
        ];

        $viewMethod = $fortifyViewMethods[$uses] ?? null;

        if ($viewMethod === null) {
            return null;
        }

        return $this->parseFortifyServiceProvider($viewMethod);
    }

    /**
     * Parse the app's FortifyServiceProvider for a Fortify::*View() registration.
     */
    public function parseFortifyServiceProvider(string $viewMethod): ?string
    {
        $providerPath = app_path('Providers/FortifyServiceProvider.php');

        if (! file_exists($providerPath)) {
            return null;
        }

        $content = file_get_contents($providerPath);

        if ($content === false) {
            return null;
        }

        // Match Fortify::loginView(fn (...) => Inertia::render('auth/login' ...))
        // or Fortify::loginView(function (...) { ... Inertia::render('auth/login' ...) })
        $pattern = '/Fortify::' . preg_quote($viewMethod, '/') . '\s*\([\s\S]*?Inertia::render\(\s*[\'"]([^\'"]+)[\'"]/';

        if (preg_match($pattern, $content, $matches)) {
            return $matches[1];
        }

        return null;
    }

    /**
     * Parse controller file for Inertia::render() or inertia() calls.
     */
    public function resolveFromController(Route $route): ?string
    {
        $action = $route->getAction();

        // Get the controller and method from the route action
        $uses = $action['uses'] ?? null;

        if ($uses === null || !is_string($uses)) {
            return null;
        }

        // Parse "Controller@method" format
        if (str_contains($uses, '@')) {
            [$controller, $method] = explode('@', $uses, 2);
        } else {
            // Invokable controller
            $controller = $uses;
            $method = '__invoke';
        }

        try {
            $reflection = new ReflectionClass($controller);
            $filePath = $reflection->getFileName();

            if ($filePath === false) {
                return null;
            }

            return $this->parseControllerFile($filePath, $method);
        } catch (ReflectionException) {
            return null;
        }
    }

    /**
     * Parse a controller file to find the Inertia component name.
     */
    public function parseControllerFile(string $filePath, string $methodName): ?string
    {
        if (!file_exists($filePath)) {
            return null;
        }

        $content = file_get_contents($filePath);

        if ($content === false) {
            return null;
        }

        // Find the method body
        $methodBody = $this->extractMethodBody($content, $methodName);

        if ($methodBody === null) {
            return null;
        }

        return $this->parseSourceForComponent($methodBody);
    }

    /**
     * Search a source string for Inertia::render() or inertia() calls.
     */
    protected function parseSourceForComponent(string $source): ?string
    {
        // Match Inertia::render('ComponentName') or Inertia::render("ComponentName")
        if (preg_match('/Inertia::render\(\s*[\'"]([^\'"]+)[\'"]\s*(?:,|\))/', $source, $matches)) {
            return $matches[1];
        }

        // Match inertia('ComponentName') or inertia("ComponentName")
        if (preg_match('/\binertia\(\s*[\'"]([^\'"]+)[\'"]\s*(?:,|\))/', $source, $matches)) {
            return $matches[1];
        }

        return null;
    }

    /**
     * Extract the body of a specific method from PHP source code.
     */
    protected function extractMethodBody(string $content, string $methodName): ?string
    {
        // Find the method declaration
        $pattern = '/function\s+' . preg_quote($methodName, '/') . '\s*\([^)]*\)(?:\s*:\s*[^\{]+)?\s*\{/';

        if (!preg_match($pattern, $content, $matches, PREG_OFFSET_CAPTURE)) {
            return null;
        }

        $startPos = $matches[0][1] + strlen($matches[0][0]);
        $braceCount = 1;
        $length = strlen($content);
        $pos = $startPos;

        while ($pos < $length && $braceCount > 0) {
            $char = $content[$pos];
            if ($char === '{') {
                $braceCount++;
            } elseif ($char === '}') {
                $braceCount--;
            }
            $pos++;
        }

        return substr($content, $startPos, $pos - $startPos - 1);
    }
}
