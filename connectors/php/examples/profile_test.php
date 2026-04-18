<?php

declare(strict_types=1);

require __DIR__ . '/profile.php';

$actual = renderProfile(['id' => 'guest']);
$expected = 'Profile: GUEST';

if ($actual !== $expected) {
    fwrite(STDERR, "expected {$expected}, got {$actual}\n");
    exit(1);
}

echo "php profile tests passed\n";
