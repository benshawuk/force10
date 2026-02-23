<?php

use Illuminate\Http\Request;
use Force10\Laravel\PreflightChecker;

beforeEach(function () {
    $this->checker = new PreflightChecker();
    $this->request = Request::create('/test', 'GET');
});

it('auth passes when user is authenticated', function () {
    $this->actingAs(makeUser());

    $results = $this->checker->evaluate($this->request, ['auth']);

    expect($results)->toHaveKey('auth')
        ->and($results['auth']['pass'])->toBeTrue();
});

it('auth fails when user is not authenticated', function () {
    $results = $this->checker->evaluate($this->request, ['auth']);

    expect($results)->toHaveKey('auth')
        ->and($results['auth']['pass'])->toBeFalse();
});

it('guest passes when not authenticated', function () {
    $results = $this->checker->evaluate($this->request, ['guest']);

    expect($results)->toHaveKey('guest')
        ->and($results['guest']['pass'])->toBeTrue();
});

it('guest fails when authenticated', function () {
    $this->actingAs(makeUser());

    $results = $this->checker->evaluate($this->request, ['guest']);

    expect($results)->toHaveKey('guest')
        ->and($results['guest']['pass'])->toBeFalse();
});

it('verified passes when email is verified', function () {
    $this->actingAs(makeUser(emailVerified: true));

    $results = $this->checker->evaluate($this->request, ['verified']);

    expect($results)->toHaveKey('verified')
        ->and($results['verified']['pass'])->toBeTrue();
});

it('verified fails when email is not verified', function () {
    $this->actingAs(makeUser(emailVerified: false));

    $results = $this->checker->evaluate($this->request, ['verified']);

    expect($results)->toHaveKey('verified')
        ->and($results['verified']['pass'])->toBeFalse();
});

it('password.confirm passes when recently confirmed and includes expiresAt', function () {
    $this->actingAs(makeUser());
    $confirmedAt = time() - 60; // 60 seconds ago
    session(['auth.password_confirmed_at' => $confirmedAt]);

    $timeout = config('auth.password_timeout', 10800);

    $results = $this->checker->evaluate($this->request, ['password.confirm']);

    expect($results)->toHaveKey('password.confirm')
        ->and($results['password.confirm']['pass'])->toBeTrue()
        ->and($results['password.confirm']['expiresAt'])->toBe($confirmedAt + $timeout);
});

it('password.confirm fails when not confirmed', function () {
    $this->actingAs(makeUser());

    $results = $this->checker->evaluate($this->request, ['password.confirm']);

    expect($results)->toHaveKey('password.confirm')
        ->and($results['password.confirm']['pass'])->toBeFalse();
});

it('password.confirm fails when confirmation expired', function () {
    $this->actingAs(makeUser());
    $confirmedAt = time() - 20000; // Well past default 10800 timeout
    session(['auth.password_confirmed_at' => $confirmedAt]);

    $results = $this->checker->evaluate($this->request, ['password.confirm']);

    expect($results)->toHaveKey('password.confirm')
        ->and($results['password.confirm']['pass'])->toBeFalse();
});

it('does not include unknown middleware in results', function () {
    $results = $this->checker->evaluate($this->request, ['custom.unknown']);

    expect($results)->toBeEmpty();
});

it('handles custom registered evaluator', function () {
    $this->checker->register('subscription', fn (Request $r) => ['pass' => true]);

    $results = $this->checker->evaluate($this->request, ['subscription']);

    expect($results)->toHaveKey('subscription')
        ->and($results['subscription']['pass'])->toBeTrue();
});

it('returns empty array when no evaluators match', function () {
    $results = $this->checker->evaluate($this->request, ['foo', 'bar.baz']);

    expect($results)->toBeEmpty();
});

it('deduplicates middleware list', function () {
    $this->actingAs(makeUser());

    $results = $this->checker->evaluate($this->request, ['auth', 'auth', 'auth']);

    expect($results)->toHaveCount(1)
        ->and($results)->toHaveKey('auth');
});

it('handles middleware with parameters by matching base name', function () {
    $this->actingAs(makeUser());

    $results = $this->checker->evaluate($this->request, ['auth:sanctum']);

    expect($results)->toHaveKey('auth:sanctum')
        ->and($results['auth:sanctum']['pass'])->toBeTrue();
});

it('falls back to default guard when specified guard is not configured', function () {
    // auth:nonexistent should fall back to default guard (which has no user)
    $results = $this->checker->evaluate($this->request, ['auth:nonexistent']);

    expect($results)->toHaveKey('auth:nonexistent')
        ->and($results['auth:nonexistent']['pass'])->toBeFalse();

    // Now authenticate and verify fallback works
    $this->actingAs(makeUser());
    $results = $this->checker->evaluate($this->request, ['auth:nonexistent']);

    expect($results['auth:nonexistent']['pass'])->toBeTrue();
});

it('uses specified guard when it exists in auth config', function () {
    // Configure a custom guard
    config(['auth.guards.custom' => [
        'driver' => 'session',
        'provider' => 'users',
    ]]);

    // No user authenticated on custom guard
    $results = $this->checker->evaluate($this->request, ['auth:custom']);

    expect($results)->toHaveKey('auth:custom')
        ->and($results['auth:custom']['pass'])->toBeFalse();
});

// Helper to create a user for testing
function makeUser(bool $emailVerified = true): \Illuminate\Foundation\Auth\User
{
    $user = new class extends \Illuminate\Foundation\Auth\User implements \Illuminate\Contracts\Auth\MustVerifyEmail
    {
        use \Illuminate\Auth\MustVerifyEmail;

        protected $guarded = [];
        public bool $emailVerifiedOverride = true;

        public function hasVerifiedEmail(): bool
        {
            return $this->emailVerifiedOverride;
        }
    };

    $user->emailVerifiedOverride = $emailVerified;
    $user->id = 1;

    return $user;
}
