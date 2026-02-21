<?php

namespace Force10\Laravel;

class PreloadTagGenerator
{
    /**
     * Generate <link rel="modulepreload"> tags for all Force10 manifest route components.
     * Only works in production (after vite build). In dev mode, returns empty string.
     */
    public function generate(): string
    {
        $viteManifest = $this->loadViteManifest();
        if ($viteManifest === null) {
            return '';
        }

        $components = $this->extractComponents();
        if (empty($components)) {
            return '';
        }

        $buildPath = config('force10.build_path', 'build');
        $pagesDir = config('force10.pages_directory', 'resources/js/pages');
        $extensions = ['tsx', 'jsx', 'ts', 'js', 'vue'];

        $tags = [];
        foreach ($components as $component) {
            foreach ($extensions as $ext) {
                $key = "{$pagesDir}/{$component}.{$ext}";
                if (isset($viteManifest[$key])) {
                    $href = asset("{$buildPath}/{$viteManifest[$key]['file']}");
                    $tags[] = "<link rel=\"modulepreload\" href=\"{$href}\">";
                    break;
                }
            }
        }

        return implode("\n    ", $tags);
    }

    /**
     * Load the Vite build manifest, checking both new and legacy paths.
     */
    protected function loadViteManifest(): ?array
    {
        $buildPath = config('force10.build_path', 'build');
        $candidates = [
            public_path("{$buildPath}/.vite/manifest.json"),
            public_path("{$buildPath}/manifest.json"),
        ];

        foreach ($candidates as $path) {
            if (file_exists($path)) {
                $data = json_decode(file_get_contents($path), true);
                if (is_array($data)) {
                    return $data;
                }
            }
        }

        return null;
    }

    /**
     * Extract component names from the Force10 manifest file.
     */
    protected function extractComponents(): array
    {
        $manifestPath = config('force10.manifest_path', resource_path('js/force10-manifest.ts'));

        if (! file_exists($manifestPath)) {
            return [];
        }

        $content = file_get_contents($manifestPath);
        preg_match_all("/component:\s*'([^']+)'/", $content, $matches);

        return array_unique($matches[1]);
    }
}
