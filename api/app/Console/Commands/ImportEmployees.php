<?php

namespace App\Console\Commands;

use App\Services\EmployeeImporter;
use Illuminate\Console\Command;

class ImportEmployees extends Command
{
    protected $signature = 'erp:import-employees
                            {file : Path to the AUB payroll masterfile (.xlsx or .xls)}
                            {--dry-run : Validate and report without writing anything}
                            {--no-users : Import employees but do not create sign-in accounts}
                            {--password= : Starting password for new accounts}';

    protected $description = 'Import the AUB payroll masterfile into the HR tables and provision sign-in accounts';

    public function handle(EmployeeImporter $importer): int
    {
        $file = $this->argument('file');

        if (! is_file($file)) {
            $this->error("File not found: {$file}");

            return self::FAILURE;
        }

        $this->info('Reading '.basename($file).' …');

        $password = $this->option('password') ?: config('app.default_employee_password');

        $report = $this->option('dry-run')
            ? $importer->preview($file)
            : $importer->import($file, ! $this->option('no-users'), $password);

        $this->newLine();
        $this->line("  Rows read      : {$report['rows']}");
        $this->line("  Errors         : {$report['errors']}");
        $this->line("  Warnings       : {$report['warnings']}");

        if ($report['created']) {
            $this->newLine();
            $this->line('  Written:');
            foreach ($report['created'] as $bucket => $count) {
                $this->line(sprintf('    %-20s %d', str_replace('_', ' ', $bucket), $count));
            }
        }

        if ($report['issues']) {
            $this->newLine();
            $this->line('  Issues (first 25):');
            foreach (array_slice($report['issues'], 0, 25) as $issue) {
                $this->line(sprintf(
                    '    [%s] row %-4d %-10s %-18s %s',
                    strtoupper(substr($issue['severity'], 0, 4)),
                    $issue['row'],
                    $issue['employee_no'],
                    $issue['column'],
                    $issue['message'],
                ));
            }
            if (count($report['issues']) > 25) {
                $this->line('    … and '.(count($report['issues']) - 25).' more');
            }
        }

        $this->newLine();

        if ($report['errors'] > 0) {
            $this->error('  Nothing was written — fix the errors above and run it again.');

            return self::FAILURE;
        }

        if ($this->option('dry-run')) {
            $this->comment('  Dry run only. Re-run without --dry-run to write these records.');

            return self::SUCCESS;
        }

        $this->info('  Import complete.');

        if (! $this->option('no-users')) {
            $this->newLine();
            $this->line('  Sign-in accounts use the employee number without its UNI prefix.');
            $this->line("  Starting password: <options=bold>{$password}</>");
            $this->line('  Every account must change it at first sign-in.');
        }

        return self::SUCCESS;
    }
}
