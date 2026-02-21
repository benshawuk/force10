<?php

namespace Force10\Laravel\Tests;

use Force10\Laravel\Force10ServiceProvider;
use Inertia\ServiceProvider as InertiaServiceProvider;
use Orchestra\Testbench\TestCase as BaseTestCase;

class TestCase extends BaseTestCase
{
    protected function getPackageProviders($app): array
    {
        return [
            InertiaServiceProvider::class,
            Force10ServiceProvider::class,
        ];
    }
}
