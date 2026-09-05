# Putting Trinitas ERP online with Hostinger

About 30 minutes, start to finish. You do not need to write any code.

---

## Before you start

You need:

- A Hostinger plan with a domain pointed at it
- Your hPanel login
- The zip file produced by **`BUILD FOR HOSTING.bat`**

---

## Step 1 — Build the upload file

On your computer, double-click:

```
BUILD FOR HOSTING.bat
```

It compiles everything and produces a file like `trinitas-erp-2026-07-29-1420.zip`
in the TRINITAS ERP folder. Leave the window open until it says **Package ready**.

Inside that zip are two folders. Where each one goes matters:

| Folder | Where it goes | Why |
|---|---|---|
| `public_html` | **Into** your existing `public_html` | This is what the web serves |
| `erp` | **Next to** `public_html`, not inside it | Holds your database password — must not be reachable from the web |

---

## Step 2 — Set PHP to 8.2 or newer

hPanel → **Advanced** → **PHP Configuration**

1. Set the version to **8.2** or **8.3**
2. Open the **PHP extensions** tab and make sure these are ticked:
   `pdo_mysql`, `mbstring`, `openssl`, `zip`, `fileinfo`, `curl`
3. Save

> Almost always these are already on. The installer checks and tells you if one
> is missing.

---

## Step 3 — Create the database

hPanel → **Databases** → **MySQL Databases**

1. Create a new database — any name, e.g. `trinitas_erp`
2. Create a user and give it a strong password
3. Make sure the user has **all privileges** on that database

**Write down the four values it shows you.** You need them in Step 5:

- Database name (looks like `u123456789_trinitas`)
- Username (looks like `u123456789_admin`)
- Password
- Host — usually `localhost`

---

## Step 4 — Upload the files

hPanel → **Files** → **File Manager**

1. Go to the folder that contains `public_html` — usually
   `domains/yourdomain.com/`
2. Upload the zip there
3. Right-click it → **Extract**
4. You should now see `public_html` and `erp` side by side:

```
domains/yourdomain.com/
├── erp/            ← the application
└── public_html/    ← what visitors reach
```

5. Delete the zip

> **If the extract put everything inside `public_html`**, move the `erp` folder
> up one level so it sits beside `public_html`, not inside it. This matters —
> it is what keeps your database password off the public internet.

---

## Step 5 — Run the installer

In your browser, go to:

```
https://yourdomain.com/install.php
```

Fill in the form:

- The four database values from Step 3
- Your website address, including `https://`
- Your company name
- A password for the `superadmin` account — at least 10 characters

Press **Install**. It creates every table, loads the government rate tables, and
sets up your administrator account.

When it finishes it deletes itself. If it says it could not, delete
`install.php` from `public_html` yourself — do not leave it there.

---

## Step 6 — Sign in

```
https://yourdomain.com
```

Username `superadmin`, and the password you just chose.

Then, in this order:

1. **Admin → System Settings → Company** — address, TIN, logo
2. **Admin → System Settings → Email** — your SMTP details, then send a test
3. **HR → Employees → Import** — upload your AUB masterfile
4. **Admin → Backup & Restore** — take your first backup

---

## Keeping it running

### Free HTTPS certificate

hPanel → **Security** → **SSL**. Install it for your domain and turn on **Force
HTTPS**. The app already redirects, but this makes it airtight.

### Backups

Two independent layers, and you want both:

- **Inside the app** — Admin → Backup & Restore → *Back up now*, then download
  the file. Do this before any large import.
- **Hostinger's own** — hPanel → Files → Backups. Automatic, and it covers the
  files as well as the database.

### Your address, for logos and links in email

Open `erp/.env` and set `APP_URL` to your real address, including `https://`:

```
APP_URL=https://yourdomain.com
```

This one line decides whether your logo appears in emails. A mail client reads
the message on somebody else's computer, so the letterhead image has to carry a
full web address — `https://yourdomain.com/storage/branding/logo.png` — and that
address is built from `APP_URL`. Leave it as `http://localhost` and every
recipient sees your company initial in a red square instead of the logo, and the
"Open the task" buttons go nowhere.

The same applies to the sign-in link in the credentials email.

### Scheduled tasks

The deadline reminders and the compliance scan run from here, so this is
required rather than optional if you use Process &amp; Performance: without it
nothing is ever chased.

hPanel → **Advanced** → **Cron Jobs**, once per minute:

```
/usr/bin/php /home/uXXXXXXX/domains/yourdomain.com/erp/artisan schedule:run
```

Replace `uXXXXXXX` with your account name — File Manager shows it in the path.

### Updating later

Run `BUILD FOR HOSTING.bat` again and upload the new `public_html` and `erp`
folders over the old ones.

**Do not upload `erp/.env`** — that file holds your live database password and
is not in the package. Your data is in MySQL and is not touched by an update.

---

## If something goes wrong

**A blank white page**
PHP version is below 8.2, or an extension is missing. Recheck Step 2. Then look
at `erp/storage/logs/` in File Manager — the newest file names the problem.

**"Trinitas ERP is not installed correctly"**
The `erp` folder is not beside `public_html`, or the upload did not finish.
Recheck the folder layout in Step 4.

**"Could not connect to the database"**
One of the four values in Step 5 is wrong. The database name and username both
start with your account number, e.g. `u123456789_`. Copy them from hPanel rather
than typing them.

**Sign-in works but every screen is empty**
The API is fine but no data has been imported yet. Go to HR → Employees →
Import.

**"Already installed"**
Setup has run before. Delete `install.php` and sign in normally. To start over,
delete `erp/storage/installed.lock` first — this wipes nothing by itself, but
re-running the installer will rebuild empty tables.

**Everything looks broken after an update**
Your browser cached the old version. Hard-refresh with `Ctrl + Shift + R`.

---

## What is where

```
domains/yourdomain.com/
├── erp/
│   ├── .env                    your database password — never share this
│   ├── app/                    the application
│   ├── storage/
│   │   ├── app/private/backups your backups
│   │   └── logs/               error logs
│   └── vendor/                 third-party libraries
└── public_html/
    ├── index.php               the only PHP the web can reach
    ├── index.html              the app
    ├── assets/                 styles and scripts
    └── .htaccess               routing, HTTPS and caching rules
```
