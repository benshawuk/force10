<?php

namespace Force10\Laravel;

class ManifestEntry
{
    public function __construct(
        public readonly string $pattern,
        public readonly string $component,
        public readonly array $middleware = [],
        public readonly array $parameters = [],
        public readonly ?string $name = null,
    ) {}

    public function toArray(): array
    {
        return [
            'pattern' => $this->pattern,
            'component' => $this->component,
            'middleware' => $this->middleware,
            'parameters' => $this->parameters,
        ];
    }
}
