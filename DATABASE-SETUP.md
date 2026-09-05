# Setting up the database

You only do this once. It takes about two minutes.

---

## What you need first

**MySQL must be running.** You already have it — it is the "MySQL80" service that
MySQL Workbench connects to.

To check: press `Win + R`, type `services.msc`, press Enter, and find **MySQL80**
in the list. The Status column should say **Running**. If it is blank, right-click
it and choose **Start**.

---

## Step 1 — Run the setup

In the `TRINITAS ERP` folder, double-click:

```
SETUP DATABASE.bat
```

A black window opens and asks you four things. For the first three, just press
**Enter** to accept the default:

| It asks | You type |
|---|---|
| Host | *(press Enter)* |
| Port | *(press Enter)* |
| MySQL admin username | *(press Enter)* |
| **Password** | **your MySQL root password** |

The password is the one you set when you installed MySQL — the same one MySQL
Workbench asks for. Nothing appears on screen while you type it. That is normal.

> The password is used once, to connect. It is never saved to a file, never
> shown, and never sent anywhere. The ERP itself gets its own separate limited
> account called `trinitas_app`.

Then it runs on its own and finishes with **Setup complete**.

---

## Step 2 — See it in MySQL Workbench

1. Open **MySQL Workbench**
2. Click your **Local instance MySQL80** connection
3. On the left, under **SCHEMAS**, you will see **trinitas_erp**
4. Click the arrow beside it, then the arrow beside **Tables**

You should see these tables:

**People**
- `employees` — the 201 file, one row per employee
- `business_groups` — Panadero, Premium Kitchen Equipment, Smart Home
- `branch_units` — all 27 JBYL branches plus PKE and Smart Homes
- `hr_departments`, `positions`, `payroll_groups`

**Payroll**
- `payroll_periods` — each semi-monthly cutoff
- `employee_timecards` — hours, overtime, late, absences per cutoff
- `payroll_runs` — one run per payroll group per cutoff
- `payslips` — the computed pay for each employee
- `payslip_lines` — the itemised earnings and deductions

**Government rates**
- `statutory_settings` — SSS, PhilHealth, Pag-IBIG and BIR rates with the date
  each took effect
- `sss_brackets` — the full SSS salary-credit ladder
- `withholding_brackets` — the BIR tax table

To look inside any table, right-click it and choose **Select Rows**.

---

## If something goes wrong

**"MySQL refused the connection"**
The password was wrong, or the MySQL service is stopped. Check the service is
Running (see the top of this page) and try again.

**"Could not find mysql.exe"**
MySQL Server is not installed in the usual place. Install MySQL Server 8, then
run the setup again.

**You want to start over**
Running `SETUP DATABASE.bat` again is safe — it will not delete your data. To
wipe everything and rebuild empty tables, open a terminal in the `api` folder
and run:

```bash
php artisan migrate:fresh --seed
```

---

## What the setup actually did

1. Created a database called `trinitas_erp`
2. Created a MySQL user called `trinitas_app` with a strong random password, and
   gave it access to that database only
3. Saved those connection details into `api\.env` so the ERP can connect
4. Created every table
5. Loaded your real reference data — the business groups, the 29 branch units,
   the position titles, the three payroll groups — and the current SSS,
   PhilHealth, Pag-IBIG and BIR rate tables

The ERP never connects as `root`. If the app is ever compromised, the attacker
cannot touch any other database on the server.
