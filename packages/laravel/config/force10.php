<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Enabled
    |--------------------------------------------------------------------------
    |
    | Enable or disable Force10 manifest generation.
    |
    */
    'enabled' => env('FORCE10_ENABLED', true),

    /*
    |--------------------------------------------------------------------------
    | Manifest Output Path
    |--------------------------------------------------------------------------
    |
    | Where the generated TypeScript manifest file will be written.
    |
    */
    'manifest_path' => resource_path('js/force10-manifest.ts'),

    /*
    |--------------------------------------------------------------------------
    | Route Filtering
    |--------------------------------------------------------------------------
    |
    | Control which routes are included in the manifest.
    |
    */
    'routes' => [
        // Only include routes matching these patterns (empty = all)
        'include' => [],

        // Exclude routes matching these patterns
        'exclude' => [
            'telescope*',
            'horizon*',
            '_debugbar*',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Component Resolution
    |--------------------------------------------------------------------------
    |
    | Configure how Inertia component names are resolved from routes.
    |
    */
    'resolution' => [
        // Directories to scan for controllers
        'controller_paths' => [
            app_path('Http/Controllers'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Preloading
    |--------------------------------------------------------------------------
    |
    | Configure component chunk preloading for instant navigation.
    | The @force10Preload Blade directive uses these to generate
    | <link rel="modulepreload"> tags for all manifest route components.
    |
    */

    /*
    |--------------------------------------------------------------------------
    | Preflight
    |--------------------------------------------------------------------------
    |
    | Enable server-side middleware state evaluation. When enabled, Force10
    | shares middleware pass/fail state with the client so it can predict
    | whether optimistic navigation is safe (e.g., skip if password
    | confirmation is required).
    |
    */
    'preflight' => [
        'enabled' => env('FORCE10_PREFLIGHT', true),
    ],

    // Path to your pages directory (relative to project root)
    'pages_directory' => 'resources/js/pages',

    // Vite build output directory (relative to public/)
    'build_path' => 'build',
];
