<?php

namespace Database\Seeders;

use App\Models\NotificationRule;
use App\Models\Permission;
use App\Models\Role;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Roles, permissions, the bootstrap administrator and the default settings.
 *
 * The bootstrap account exists so the system can be signed into on a fresh
 * install. It is flagged in the UI and should be replaced with a named account
 * before the ERP goes live.
 */
class PlatformSeeder extends Seeder
{
    /** module => [action => label] */
    private const MODULES = [
        'sales' => 'Sales & Marketing',
        'procurement' => 'Procurement',
        'warehouse' => 'Warehouse',
        'maintenance' => 'Maintenance',
        'finance' => 'Finance & Accounting',
        'hr' => 'Human Resources',
        // The project management module, and the compliance office that
        // evaluates the work done in it.
        'process' => 'Process & Performance',
        'admin' => 'Administration',
    ];

    private const ACTIONS = ['view' => 'View', 'create' => 'Create', 'edit' => 'Edit', 'approve' => 'Approve', 'delete' => 'Delete'];

    public function run(): void
    {
        $this->seedPermissions();
        $this->seedRoles();
        $this->seedBootstrapUser();
        $this->seedSettings();
        $this->seedNotificationRules();
    }

    private function seedPermissions(): void
    {
        foreach (self::MODULES as $module => $moduleLabel) {
            foreach (self::ACTIONS as $action => $actionLabel) {
                Permission::updateOrCreate(
                    ['code' => "{$module}.{$action}"],
                    ['module' => $module, 'name' => "{$actionLabel} — {$moduleLabel}"],
                );
            }
        }
    }

    private function seedRoles(): void
    {
        $roles = [
            'super-admin' => ['System Administrator', 'Unrestricted access to every module and setting.', '*'],
            'executive' => ['Executive', 'Read-only visibility across the whole business.', ['*.view']],
            'sales-manager' => ['Sales Manager', 'Runs the sales pipeline and approves orders.', ['sales.*']],
            'sales-rep' => ['Sales Representative', 'Own accounts, quotations and orders.', ['sales.view', 'sales.create', 'sales.edit']],
            'buyer' => ['Buyer', 'Raises and manages purchase orders.', ['procurement.view', 'procurement.create', 'procurement.edit']],
            'procurement-manager' => ['Procurement Manager', 'Approves purchases and manages suppliers.', ['procurement.*']],
            'warehouse-staff' => ['Warehouse Staff', 'Receiving, picking and stock counts.', ['warehouse.view', 'warehouse.create', 'warehouse.edit']],
            'warehouse-manager' => ['Warehouse Manager', 'Full inventory control including adjustments.', ['warehouse.*']],
            'technician' => ['Technician', 'Works assigned maintenance jobs.', ['maintenance.view', 'maintenance.edit']],

            /*
             * Supervisor.
             *
             * A first-line approver rather than a department head: signs off
             * fuel and trip requests for the people in front of them, without
             * the settings and reporting reach a manager role carries. Named
             * generically because the shift supervisor on the floor and the
             * one in the yard are the same authority for this purpose.
             */
            'supervisor' => ['Supervisor', 'Approves fuel and trip requests for their team.', ['maintenance.view', 'maintenance.edit', 'hr.view']],
            'maintenance-manager' => ['Maintenance Manager', 'Assets, schedules and job approval.', ['maintenance.*']],
            'accountant' => ['Accountant', 'Posts entries and manages receivables and payables.', ['finance.view', 'finance.create', 'finance.edit']],
            'finance-manager' => ['Finance Manager', 'Approves postings, payments and the period close.', ['finance.*']],
            'hr-officer' => ['HR Officer', 'Employee records, attendance and leave.', ['hr.view', 'hr.create', 'hr.edit']],
            'hr-manager' => ['HR Manager', 'Full HR including payroll approval.', ['hr.*']],

            /*
             * The Process & Performance office.
             *
             * Two roles rather than one because the office does two different
             * things: an officer records observations and verdicts, a manager
             * also owns the projects and the automation rules. Holding either
             * is what makes the compliance screens visible — see ProcessOffice.
             */
            'process-officer' => ['Process Officer', 'Evaluates delivery against deadlines and records compliance findings.', ['process.view', 'process.create', 'process.edit']],
            'process-manager' => ['Process & Performance Manager', 'Owns the project portfolio, the compliance register and the escalation rules.', ['process.*']],
        ];

        foreach ($roles as $code => [$name, $description, $grants]) {
            $role = Role::updateOrCreate(
                ['code' => $code],
                ['name' => $name, 'description' => $description, 'is_system' => in_array($code, ['super-admin', 'executive'], true)],
            );

            $role->permissions()->sync($this->resolvePermissions($grants));
        }
    }

    /** Expands '*', 'sales.*' and '*.view' into concrete permission ids. */
    private function resolvePermissions(array|string $grants): array
    {
        if ($grants === '*') {
            return Permission::pluck('id')->all();
        }

        $ids = [];
        foreach ((array) $grants as $pattern) {
            [$module, $action] = explode('.', $pattern, 2);

            $query = Permission::query();
            if ($module !== '*') {
                $query->where('module', $module);
            }
            if ($action !== '*') {
                $query->where('code', 'like', "%.{$action}");
            }

            $ids = array_merge($ids, $query->pluck('id')->all());
        }

        return array_values(array_unique($ids));
    }

    private function seedBootstrapUser(): void
    {
        $user = User::withTrashed()->updateOrCreate(
            ['email' => 'superadmin@trinitas.com.ph'],
            [
                'name' => 'Super Administrator',
                'username' => 'superadmin',
                'password' => Hash::make('admin123'),
                'is_super_admin' => true,
                // Off on a fresh install so the first sign-in works before
                // SMTP is configured. Turn it on in Admin → Users.
                'requires_auth_code' => false,
                'status' => 'Active',
                'email_verified_at' => now(),
                'deleted_at' => null,
            ],
        );

        $superAdmin = Role::where('code', 'super-admin')->first();
        if ($superAdmin) {
            $user->roles()->syncWithoutDetaching([$superAdmin->id]);
        }
    }

    private function seedSettings(): void
    {
        $defaults = [
            'company' => [
                ['legal_name', 'Premium Kitchen Equipment Inc.', 'string', 'Registered company name'],
                ['trade_name', 'Trinitas ERP', 'string', 'Name shown in the application'],
                ['address', '', 'string', 'Registered address'],
                ['tin', '', 'string', 'Taxpayer identification number'],
                ['phone', '', 'string', 'Contact number'],
                ['email', '', 'string', 'Contact email'],
                ['logo_path', '', 'string', 'Logo shown on screen and on printed reports'],
                ['currency', 'PHP', 'string', 'Reporting currency'],
                ['fiscal_year_start', '1', 'integer', 'First month of the fiscal year'],
            ],
            'smtp' => [
                ['enabled', '0', 'boolean', 'Send transactional email'],
                ['host', '', 'string', 'SMTP server'],
                ['port', '587', 'integer', 'SMTP port'],
                ['encryption', 'tls', 'string', 'tls or ssl'],
                ['username', '', 'string', 'SMTP username'],
                ['password', null, 'secret', 'SMTP password'],
                ['from_address', '', 'string', 'Sender address'],
                ['from_name', 'Trinitas ERP', 'string', 'Sender name'],
                ['reply_to', '', 'string', 'Reply-to address'],
            ],
            'security' => [
                ['session_timeout_minutes', '30', 'integer', 'Sign out after this much inactivity'],
                ['require_auth_code', '1', 'boolean', 'Email a code on every sign-in'],
                ['max_failed_attempts', '5', 'integer', 'Failures before the account locks'],
                ['lockout_minutes', '15', 'integer', 'How long an account stays locked'],
                ['geo_fencing_enabled', '0', 'boolean', 'Restrict sign-in by location'],
                ['login_hours_enabled', '0', 'boolean', 'Restrict rank-and-file sign-in to their shift window'],
                ['min_password_length', '4', 'integer', 'Fewest characters any new password may have'],
                ['audit_retention_days', '730', 'integer', 'How long audit trail entries are kept before audit:purge removes them'],
            ],
            'payroll' => [
                ['statutory_schedule', 'second', 'string', 'Cutoff carrying the monthly statutory deduction'],
                ['working_days_factor', '313', 'integer', 'Days used to derive the monthly equivalent'],
                ['hours_per_day', '8', 'integer', 'Standard working hours per day'],
            ],
        ];

        foreach ($defaults as $group => $rows) {
            foreach ($rows as [$key, $value, $type, $label]) {
                // Never overwrite a value an administrator has already set.
                Setting::firstOrCreate(
                    ['group' => $group, 'key' => $key],
                    ['value' => $value, 'type' => $type, 'label' => $label],
                );
            }
        }
    }

    private function seedNotificationRules(): void
    {
        $rules = [
            ['auth.code', 'Sign-in code', 'Emails the six-digit code during sign-in.', ['*']],
            ['requisition.submitted', 'Requisition submitted', 'Tells the approver a requisition is waiting.', ['procurement-manager']],
            ['purchase_order.approved', 'Purchase order approved', 'Confirms approval to the buyer and supplier contact.', ['buyer', 'procurement-manager']],
            ['goods_receipt.posted', 'Goods receipt posted', 'Notifies procurement and finance that stock arrived.', ['procurement-manager', 'accountant']],
            ['sales_order.confirmed', 'Sales order confirmed', 'Tells the warehouse there is an order to pick.', ['warehouse-manager', 'sales-manager']],
            ['invoice.overdue', 'Invoice overdue', 'Daily digest of receivables past due.', ['accountant', 'finance-manager']],
            ['stock.below_reorder', 'Stock below reorder point', 'Warns procurement before a stockout.', ['warehouse-manager', 'procurement-manager']],
            ['work_order.assigned', 'Work order assigned', 'Tells a technician they have a job.', ['technician']],
            ['pm.overdue', 'Preventive maintenance overdue', 'Escalates a missed service.', ['maintenance-manager']],
            ['leave.filed', 'Leave filed', 'Sends the request to the approver.', ['hr-officer']],
            ['payroll.released', 'Payroll released', 'Confirms the run and the bank file are ready.', ['hr-manager', 'finance-manager']],
            ['document.expiring', '201 document expiring', 'Daily digest of employee documents lapsing within 30 days.', ['hr-officer', 'hr-manager']],
            ['applicant.received', 'Application received', 'Acknowledges a job application to the candidate the moment it is submitted.', []],
            ['applicant.rejected', 'Application not proceeding', 'Politely notifies a candidate once a recruiter confirms they are not moving forward.', []],
            ['onboarding.welcome', 'Welcome aboard', 'Sends a new hire their sign-in details the moment they are hired.', []],
            ['onboarding.overdue', 'Onboarding task overdue', 'Daily digest of new-hire checklist items past their due date.', ['hr-officer', 'hr-manager']],
            ['offboarding.initiated', 'Offboarding started', 'Tells HR and Finance a separation has started and clearance is needed.', ['hr-officer', 'hr-manager', 'finance-manager']],
            ['offboarding.exit-notice', 'Exit checklist sent', 'Sends a departing employee their clearance checklist and what to expect.', []],
            ['resignation.submitted', 'Resignation submitted', 'Tells HR an employee has filed a resignation request awaiting a decision.', ['hr-officer', 'hr-manager']],
            ['resignation.decided', 'Resignation decided', 'Tells an employee whether their resignation request was approved.', []],
            ['resignation.cancelled', 'Resignation withdrawn', 'Tells HR an employee withdrew their own resignation request before it was decided.', ['hr-officer', 'hr-manager']],
            ['offboarding.cancelled', 'Offboarding cancelled', 'Tells HR and Finance a clearance case was called off rather than completed.', ['hr-officer', 'hr-manager', 'finance-manager']],
            ['offboarding.cancelled-notice', 'Offboarding cancelled (employee notice)', 'Tells the employee their clearance process has been called off.', []],
            ['coe.requested', 'Certificate of Employment requested', 'Tells HR an employee has requested a Certificate of Employment.', ['hr-officer', 'hr-manager']],
            ['coe.decided', 'Certificate of Employment decided', 'Tells an employee whether their COE request was issued.', []],
            ['overtime.requested', 'Overtime pre-approval requested', 'Tells HR an employee is requesting overtime pre-approval.', ['hr-officer', 'hr-manager']],
            ['overtime.decided', 'Overtime pre-approval decided', 'Tells an employee whether their overtime request was approved.', []],
            ['hr.regularization-auto', 'Automatic regularisation', 'Confirms to an employee that their probation resolved and they are now regular.', []],
            ['hr.regularization-review-needed', 'Regularisation decision needed', 'Daily digest of probationary employees held back from auto-regularisation by a poor review.', ['hr-officer', 'hr-manager']],
            ['wage_order.applied', 'Wage order applied', 'Summarises who was adjusted when a wage order is applied.', ['hr-manager', 'finance-manager']],
        ];

        foreach ($rules as [$event, $name, $description, $roles]) {
            NotificationRule::firstOrCreate(
                ['event' => $event],
                [
                    'name' => $name,
                    'description' => $description,
                    'email_enabled' => true,
                    'in_app_enabled' => true,
                    'recipient_roles' => $roles,
                ],
            );
        }
    }
}
