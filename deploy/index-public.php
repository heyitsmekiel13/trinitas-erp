<?php

/**
 * Front controller for shared hosting.
 *
 * The Laravel application lives in a sibling `erp/` folder rather than inside
 * the web root, so nothing outside `public_html` — the .env file, the database
 * config, the vendor tree — can be requested over HTTP. This file is the only
 * PHP the web server can reach.
 */

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$app_path = __DIR__.'/../erp';

if (! is_file($app_path.'/vendor/autoload.php')) {
    http_response_code(500);
    exit('Trinitas ERP is not installed correctly: the erp/ folder is missing or incomplete.');
}

// Maintenance mode, if `php artisan down` has been run.
if (file_exists($maintenance = $app_path.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $app_path.'/vendor/autoload.php';

/** @var Application $app */
$app = require_once $app_path.'/bootstrap/app.php';

$app->handleRequest(Request::capture());
