<?php

declare(strict_types=1);

function renderProfile(array $user): string
{
    return 'Profile: ' . strtoupper($user['profile']['displayName']);
}
