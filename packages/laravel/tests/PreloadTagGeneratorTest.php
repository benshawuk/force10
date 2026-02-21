<?php

use Force10\Laravel\PreloadTagGenerator;

beforeEach(function () {
    // Set up a temp directory for test fixtures
    $this->tempDir = sys_get_temp_dir().'/force10_preload_test_'.uniqid();
    mkdir($this->tempDir.'/public/build', 0755, true);
    mkdir($this->tempDir.'/resources/js', 0755, true);
});

afterEach(function () {
    // Clean up temp files
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($this->tempDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($files as $file) {
        $file->isDir() ? rmdir($file->getRealPath()) : unlink($file->getRealPath());
    }
    rmdir($this->tempDir);
});

it('generates modulepreload tags for manifest route components', function () {
    // Write a Force10 manifest
    $force10Manifest = <<<'TS'
    export default {
      routes: [
        { pattern: '/dashboard', component: 'dashboard', middleware: [], parameters: [] },
        { pattern: '/settings/profile', component: 'settings/profile', middleware: [], parameters: [] },
      ],
    };
    TS;
    file_put_contents($this->tempDir.'/resources/js/force10-manifest.ts', $force10Manifest);

    // Write a Vite build manifest
    $viteManifest = json_encode([
        'resources/js/pages/dashboard.tsx' => [
            'file' => 'assets/dashboard-abc123.js',
            'isDynamicEntry' => true,
        ],
        'resources/js/pages/settings/profile.tsx' => [
            'file' => 'assets/profile-def456.js',
            'isDynamicEntry' => true,
        ],
    ]);
    file_put_contents($this->tempDir.'/public/build/manifest.json', $viteManifest);

    // Configure paths
    config([
        'force10.manifest_path' => $this->tempDir.'/resources/js/force10-manifest.ts',
        'force10.build_path' => 'build',
        'force10.pages_directory' => 'resources/js/pages',
    ]);

    // Override public_path for testing
    app()->usePublicPath($this->tempDir.'/public');

    $generator = new PreloadTagGenerator();
    $output = $generator->generate();

    expect($output)->toContain('modulepreload');
    expect($output)->toContain('assets/dashboard-abc123.js');
    expect($output)->toContain('assets/profile-def456.js');
});

it('returns empty string when no vite build manifest exists', function () {
    config([
        'force10.manifest_path' => $this->tempDir.'/resources/js/force10-manifest.ts',
        'force10.build_path' => 'build',
    ]);

    app()->usePublicPath($this->tempDir.'/public');

    $generator = new PreloadTagGenerator();
    expect($generator->generate())->toBe('');
});

it('returns empty string when no force10 manifest exists', function () {
    // Write only the Vite manifest
    file_put_contents($this->tempDir.'/public/build/manifest.json', json_encode([]));

    config([
        'force10.manifest_path' => $this->tempDir.'/resources/js/nonexistent.ts',
        'force10.build_path' => 'build',
    ]);

    app()->usePublicPath($this->tempDir.'/public');

    $generator = new PreloadTagGenerator();
    expect($generator->generate())->toBe('');
});

it('reads from .vite/manifest.json path', function () {
    // Write Force10 manifest
    $force10Manifest = "export default { routes: [{ pattern: '/', component: 'welcome', middleware: [], parameters: [] }] };";
    file_put_contents($this->tempDir.'/resources/js/force10-manifest.ts', $force10Manifest);

    // Write Vite manifest at the newer .vite/ path
    mkdir($this->tempDir.'/public/build/.vite', 0755, true);
    $viteManifest = json_encode([
        'resources/js/pages/welcome.tsx' => [
            'file' => 'assets/welcome-xyz789.js',
        ],
    ]);
    file_put_contents($this->tempDir.'/public/build/.vite/manifest.json', $viteManifest);

    config([
        'force10.manifest_path' => $this->tempDir.'/resources/js/force10-manifest.ts',
        'force10.build_path' => 'build',
        'force10.pages_directory' => 'resources/js/pages',
    ]);

    app()->usePublicPath($this->tempDir.'/public');

    $generator = new PreloadTagGenerator();
    $output = $generator->generate();

    expect($output)->toContain('assets/welcome-xyz789.js');
});

it('registers the force10Preload blade directive', function () {
    $directives = app('blade.compiler')->getCustomDirectives();
    expect($directives)->toHaveKey('force10Preload');
});
