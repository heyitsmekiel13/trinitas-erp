<?php

/**
 * One-time web installer for shared hosting.
 *
 * Hostinger's cheaper plans have no SSH, so there is no way to run
 * `php artisan migrate` by hand. This page does it once: writes the .env,
 * generates the application key, builds the tables and creates the
 * administrator account.
 *
 * It is deliberately single-use. Once `storage/installed.lock` exists it
 * refuses to do anything, and it tries to delete itself on completion — an
 * installer that can be re-run is a way to take over the whole system.
 */

declare(strict_types=1);

$appPath = __DIR__.'/../erp';
$lockFile = $appPath.'/storage/installed.lock';
$envFile = $appPath.'/.env';

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

function fail(string $title, string $detail): never
{
    render($title, "<p class='bad'>{$detail}</p>");
    exit;
}

if (is_file($lockFile)) {
    fail(
        'Already installed',
        'This system has already been set up. Delete <code>install.php</code> from public_html — '
        .'leaving it there is a security risk.'
    );
}

if (! is_dir($appPath) || ! is_file($appPath.'/vendor/autoload.php')) {
    fail('Files are missing', 'The <code>erp</code> folder is not next to <code>public_html</code>, or its upload did not finish.');
}

if (! is_writable($appPath)) {
    fail('Permission problem', 'The <code>erp</code> folder is not writable. In hPanel File Manager set its permissions to 755.');
}

foreach (['pdo_mysql', 'mbstring', 'openssl', 'zip'] as $extension) {
    if (! extension_loaded($extension)) {
        fail('PHP extension missing', "This server does not have <code>{$extension}</code> enabled. Turn it on in hPanel → Advanced → PHP Configuration.");
    }
}

if (version_compare(PHP_VERSION, '8.2.0', '<')) {
    fail('PHP is too old', 'Trinitas ERP needs PHP 8.2 or newer. Change it in hPanel → Advanced → PHP Configuration.');
}

/* -------------------------------------------------------------------------- */
/* Install                                                                     */
/* -------------------------------------------------------------------------- */

$errors = [];
$done = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = [
        'db_host' => trim((string) ($_POST['db_host'] ?? 'localhost')),
        'db_port' => trim((string) ($_POST['db_port'] ?? '3306')),
        'db_name' => trim((string) ($_POST['db_name'] ?? '')),
        'db_user' => trim((string) ($_POST['db_user'] ?? '')),
        'db_pass' => (string) ($_POST['db_pass'] ?? ''),
        'app_url' => rtrim(trim((string) ($_POST['app_url'] ?? '')), '/'),
        'company' => trim((string) ($_POST['company'] ?? '')),
        'admin_pass' => (string) ($_POST['admin_pass'] ?? ''),
    ];

    if ($input['db_name'] === '') $errors[] = 'Database name is required.';
    if ($input['db_user'] === '') $errors[] = 'Database user is required.';
    if ($input['app_url'] === '' || ! filter_var($input['app_url'], FILTER_VALIDATE_URL)) {
        $errors[] = 'Enter your full website address, including https://';
    }
    if (strlen($input['admin_pass']) < 10) $errors[] = 'The administrator password must be at least 10 characters.';

    // Prove the credentials work before writing anything to disk.
    if (! $errors) {
        try {
            new PDO(
                "mysql:host={$input['db_host']};port={$input['db_port']};dbname={$input['db_name']}",
                $input['db_user'],
                $input['db_pass'],
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5],
            );
        } catch (PDOException $e) {
            $errors[] = 'Could not connect to the database: '.$e->getMessage();
        }
    }

    if (! $errors) {
        try {
            $template = is_file(__DIR__.'/../erp/.env.example-production')
                ? file_get_contents(__DIR__.'/../erp/.env.example-production')
                : '';

            $env = strtr($template, [
                'APP_URL=https://yourdomain.com' => 'APP_URL='.$input['app_url'],
                'FRONTEND_URL=https://yourdomain.com' => 'FRONTEND_URL='.$input['app_url'],
                'DB_HOST=localhost' => 'DB_HOST='.$input['db_host'],
                'DB_PORT=3306' => 'DB_PORT='.$input['db_port'],
                'DB_DATABASE=' => 'DB_DATABASE='.$input['db_name'],
                'DB_USERNAME=' => 'DB_USERNAME='.$input['db_user'],
                'DB_PASSWORD=' => 'DB_PASSWORD="'.$input['db_pass'].'"',
            ]);

            // 32 random bytes, the length Laravel's AES-256 cipher expects.
            $key = 'base64:'.base64_encode(random_bytes(32));
            $env = str_replace('APP_KEY=', 'APP_KEY='.$key, $env);

            if (file_put_contents($envFile, $env) === false) {
                throw new RuntimeException('Could not write the .env file.');
            }
            @chmod($envFile, 0640);

            // Boot Laravel now that it has configuration, and let Artisan do
            // the schema work rather than reimplementing it here.
            require $appPath.'/vendor/autoload.php';
            $app = require $appPath.'/bootstrap/app.php';
            $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
            $kernel->bootstrap();

            $kernel->call('migrate', ['--force' => true]);
            $kernel->call('db:seed', ['--force' => true]);

            // Apply the choices made on this form.
            $settings = $app->make(App\Services\Settings::class);
            if ($input['company'] !== '') {
                $settings->setMany('company', ['legal_name' => $input['company'], 'trade_name' => $input['company']]);
            }

            App\Models\User::where('username', 'superadmin')->update([
                'password' => Illuminate\Support\Facades\Hash::make($input['admin_pass']),
                'must_change_password' => false,
                'password_changed_at' => now(),
            ]);

            $kernel->call('storage:link');
            $kernel->call('config:cache');
            $kernel->call('route:cache');

            file_put_contents($lockFile, date('c')." installed\n");

            $done = true;
        } catch (Throwable $e) {
            $errors[] = 'Setup failed: '.$e->getMessage();
        }
    }
}

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

if ($done) {
    // Best effort — if the web user cannot delete it, say so plainly.
    $removed = @unlink(__FILE__);

    render('Trinitas ERP is ready', "
        <p class='good'>Everything is installed and the database is built.</p>
        <p>Sign in with:</p>
        <table>
            <tr><th>Address</th><td><code>".htmlspecialchars($_POST['app_url'] ?? '')."</code></td></tr>
            <tr><th>Username</th><td><code>superadmin</code></td></tr>
            <tr><th>Password</th><td>the one you just chose</td></tr>
        </table>
        ".($removed
            ? "<p class='good'>This installer has deleted itself.</p>"
            : "<p class='bad'><strong>Delete <code>install.php</code> from public_html now.</strong> It could not remove itself automatically.</p>")."
        <p>Next: import your employees under HR → Employees, then set up email under
        Admin → System Settings → Email.</p>
    ");
    exit;
}

$post = fn (string $key, string $default = '') => htmlspecialchars((string) ($_POST[$key] ?? $default), ENT_QUOTES);

ob_start(); ?>
    <?php if ($errors): ?>
        <div class="errors">
            <?php foreach ($errors as $error): ?>
                <p class="bad"><?= htmlspecialchars($error) ?></p>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <p>This runs once and sets everything up. You need your database details from
       <strong>hPanel → Databases → MySQL Databases</strong>.</p>

    <form method="post">
        <h2>Database</h2>
        <label>Database name<input name="db_name" value="<?= $post('db_name') ?>" required autofocus></label>
        <label>Database user<input name="db_user" value="<?= $post('db_user') ?>" required></label>
        <label>Database password<input type="password" name="db_pass" value=""></label>
        <div class="row">
            <label>Host<input name="db_host" value="<?= $post('db_host', 'localhost') ?>"></label>
            <label>Port<input name="db_port" value="<?= $post('db_port', '3306') ?>"></label>
        </div>

        <h2>Your site</h2>
        <label>Website address<input name="app_url" value="<?= $post('app_url', 'https://') ?>" required></label>
        <label>Company name<input name="company" value="<?= $post('company') ?>" placeholder="Premium Kitchen Equipment Inc."></label>

        <h2>Administrator</h2>
        <label>Password for the <code>superadmin</code> account
            <input type="password" name="admin_pass" required minlength="10">
            <span class="hint">At least 10 characters. Write it down somewhere safe.</span>
        </label>

        <button type="submit">Install</button>
    </form>
<?php
render('Set up Trinitas ERP', ob_get_clean());

function render(string $title, string $body): void
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        .'<meta name="viewport" content="width=device-width,initial-scale=1">'
        .'<title>'.htmlspecialchars($title).'</title><style>'
        .':root{color-scheme:light}'
        .'*{box-sizing:border-box}'
        .'body{margin:0;padding:24px 16px;background:#f5f6f8;color:#0d0f14;'
        .'font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
        .'.card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;'
        .'border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgb(13 15 20/.07)}'
        .'.head{background:linear-gradient(135deg,#ff5c68,#e11d34 48%,#9d1024);'
        .'color:#fff;padding:22px 24px}'
        .'.head h1{margin:0;font-size:19px;letter-spacing:-.01em}'
        .'.head p{margin:4px 0 0;font-size:12px;letter-spacing:.18em;opacity:.75}'
        .'.body{padding:24px}'
        .'h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#79808e;'
        .'margin:22px 0 10px;padding-bottom:6px;border-bottom:1px solid #e4e7ec}'
        .'h2:first-child{margin-top:0}'
        .'label{display:block;margin-bottom:12px;font-size:13px;font-weight:500;color:#4b5262}'
        .'input{display:block;width:100%;margin-top:5px;padding:9px 11px;font-size:14px;'
        .'border:1px solid #d2d7df;border-radius:8px;font-family:inherit}'
        .'input:focus{outline:2px solid #e11d34;outline-offset:1px;border-color:#e11d34}'
        .'.row{display:flex;gap:12px}.row label{flex:1}'
        .'.hint{display:block;margin-top:4px;font-size:12px;font-weight:400;color:#79808e}'
        .'button{width:100%;margin-top:18px;padding:12px;font-size:15px;font-weight:600;'
        .'color:#fff;background:linear-gradient(135deg,#ff5c68,#e11d34 48%,#9d1024);'
        .'border:0;border-radius:10px;cursor:pointer}'
        .'button:hover{filter:brightness(1.08)}'
        .'code{background:#eef0f4;padding:1px 5px;border-radius:4px;font-size:13px}'
        .'.good{color:#046904;background:#f0fdf4;border:1px solid #bbf7d0;'
        .'padding:10px 12px;border-radius:8px}'
        .'.bad{color:#a11c1c;background:#fef2f2;border:1px solid #fecaca;'
        .'padding:10px 12px;border-radius:8px}'
        .'.errors{margin-bottom:16px}'
        .'table{width:100%;border-collapse:collapse;margin:12px 0}'
        .'th{text-align:left;padding:6px 0;width:110px;color:#79808e;font-weight:500;font-size:13px}'
        .'td{padding:6px 0}'
        .'</style></head><body><div class="card">'
        .'<div class="head"><h1>'.htmlspecialchars($title).'</h1><p>TRINITAS ERP SUITE</p></div>'
        .'<div class="body">'.$body.'</div></div></body></html>';
}
