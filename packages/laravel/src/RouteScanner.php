<?php

namespace Force10\Laravel;

use Illuminate\Routing\Route;
use Illuminate\Routing\Router;

class RouteScanner
{
    public function __construct(
        protected Router $router,
        protected ComponentResolver $resolver,
    ) {}

    /**
     * Scan all GET routes from the Laravel router.
     *
     * @return Route[]
     */
    public function scan(): array
    {
        $routes = [];

        foreach ($this->router->getRoutes()->getRoutes() as $route) {
            if (in_array('GET', $route->methods()) && !in_array('api', $this->getMiddlewareGroups($route))) {
                $routes[] = $route;
            }
        }

        return $routes;
    }

    /**
     * Filter routes by include/exclude config patterns.
     *
     * @param Route[] $routes
     * @return Route[]
     */
    public function filterByConfig(array $routes, array $config): array
    {
        $include = $config['include'] ?? [];
        $exclude = $config['exclude'] ?? [];

        return array_values(array_filter($routes, function (Route $route) use ($include, $exclude) {
            $uri = $route->uri();

            // If include patterns are specified, route must match at least one
            if (!empty($include)) {
                $matched = false;
                foreach ($include as $pattern) {
                    if (fnmatch($pattern, $uri)) {
                        $matched = true;
                        break;
                    }
                }
                if (!$matched) {
                    return false;
                }
            }

            // If exclude patterns are specified, route must not match any
            foreach ($exclude as $pattern) {
                if (fnmatch($pattern, $uri)) {
                    return false;
                }
            }

            return true;
        }));
    }

    /**
     * Convert Laravel route URI to Force10 pattern format.
     * e.g. "users/{user}" -> "/users/:user"
     */
    public function getRoutePattern(string $uri): string
    {
        // Convert {param?} to :param?
        $pattern = preg_replace('/\{(\w+)\?\}/', ':$1?', $uri);

        // Convert {param} to :param
        $pattern = preg_replace('/\{(\w+)\}/', ':$1', $pattern);

        // Prepend / if needed
        if (!str_starts_with($pattern, '/')) {
            $pattern = '/' . $pattern;
        }

        return $pattern;
    }

    /**
     * Extract middleware names from a route.
     */
    public function getMiddleware(Route $route): array
    {
        return array_values(array_unique($route->gatherMiddleware()));
    }

    /**
     * Extract route parameters with optionality information.
     *
     * @return array<int, array{name: string, required: bool}>
     */
    public function getRouteParameters(Route $route): array
    {
        $parameters = [];
        $uri = $route->uri();

        preg_match_all('/\{(\w+)(\?)?\}/', $uri, $matches, PREG_SET_ORDER);

        foreach ($matches as $match) {
            $parameters[] = [
                'name' => $match[1],
                'required' => !isset($match[2]) || $match[2] !== '?',
            ];
        }

        return $parameters;
    }

    /**
     * Build the full manifest from scanned routes.
     *
     * @return ManifestEntry[]
     */
    public function buildManifest(array $config): array
    {
        $routes = $this->scan();
        $routes = $this->filterByConfig($routes, $config['routes'] ?? []);

        $entries = [];

        foreach ($routes as $route) {
            $component = $this->resolver->resolve($route);

            if ($component === null) {
                continue;
            }

            $entries[] = new ManifestEntry(
                pattern: $this->getRoutePattern($route->uri()),
                component: $component,
                middleware: $this->getMiddleware($route),
                parameters: $this->getRouteParameters($route),
                name: $route->getName(),
            );
        }

        return $entries;
    }

    /**
     * Get the middleware groups assigned to a route.
     */
    protected function getMiddlewareGroups(Route $route): array
    {
        $action = $route->getAction();

        return (array) ($action['middleware'] ?? []);
    }
}
