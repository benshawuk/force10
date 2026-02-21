<?php

namespace Force10\Laravel;

use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;
use Force10\Laravel\Commands\GenerateCommand;
use Force10\Laravel\Commands\InstallCommand;
use Force10\Laravel\Middleware\Force10CacheControl;

class Force10ServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(
            __DIR__.'/../config/force10.php',
            'force10'
        );
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/force10.php' => config_path('force10.php'),
        ], 'force10-config');

        /** @var Router $router */
        $router = $this->app->make(Router::class);
        $router->aliasMiddleware('force10.cache', Force10CacheControl::class);

        Blade::directive('force10Preload', function () {
            return "<?php echo app(\Force10\Laravel\PreloadTagGenerator::class)->generate(); ?>";
        });

        if ($this->app->runningInConsole()) {
            $this->commands([
                GenerateCommand::class,
                InstallCommand::class,
            ]);
        }
    }
}
