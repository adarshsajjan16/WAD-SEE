# 🏥 Enterprise Hospital Management System

An enterprise-grade, full-stack Hospital Management System built from scratch with Node.js, Express, SQLite, and modern vanilla CSS/JS. Featuring secure authentication, role-based access control, appointment slot calculation, real-time double-booking prevention, administrator command center, CSV data exports, and automated security audit logging.

---

## 🌟 Key Features

### 🔐 Authentication & Security
* **Bcrypt Password Hashing**: Passwords stored securely using salt-based bcrypt hashing.
* **Session Management**: Server-side session validation using `express-session` with `httpOnly` and `sameSite` cookie security.
* **Brute-Force Rate Limiting**: Endpoint protection on `/api/auth/login` and `/api/auth/register` via `express-rate-limit`.
* **Security Headers**: HTTP header hardening using `helmet`.
* **Spreadsheet Formula Injection Defense**: All CSV exports sanitize dangerous cell prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`).
* **Audit Logging**: Comprehensive activity logs tracking patient registrations, logins, status changes, and exports.

### 🩺 Patient Portal
* **Instant Profile Dashboard**: View unique patient identifier (`PAT-10001`), contact info, and booking stats.
* **Dynamic Specialist Slot Finder**: Check real-time time slot availability for doctors based on their consultation hours and active bookings.
* **Conflict Prevention**: Server-side transactional checks prevent booking in the past, duplicate patient bookings, or doctor slot collisions.
* **Appointment Cancellation**: Request appointment cancellations for pending or confirmed consultations.
* **Profile Manager**: Update phone number, residential address, emergency contacts, date of birth, and gender identity.

### 👑 Administrator Command Center
* **Live System Metrics**: Metrics for registered patients, active accounts, active doctors, pending, confirmed, completed, and cancelled appointments.
* **Patient Directory**: Searchable & filterable database. Quick toggle to enable/disable patient accounts.
* **Specialist Roster**: Add new medical doctors, configure working days, consultation hours (start/end time), and slot duration.
* **Master Appointment Desk**: Filter appointments by status, date, doctor, or keyword. Quick actions: Confirm, Reject, Complete, Cancel, Reschedule (with slot picker), and add Admin Notes.
* **CSV Export Hub**: One-click RFC 4180 compliant CSV downloads for Patients, Appointments, Doctors, and Activity Audit Logs.

---

## 🛠️ Tech Stack

* **Frontend**: HTML5, CSS3 (Modern Glassmorphism & Custom Properties Design System), JavaScript (ES6+, Fetch API)
* **Backend**: Node.js, Express.js (REST API Architecture)
* **Database**: SQLite (Built-in `node:sqlite` DatabaseSync module)
* **Security**: `bcryptjs`, `helmet`, `express-session`, `express-rate-limit`

---

## 📁 Project Structure

```
hospital-management-system/
├── public/
│   ├── index.html                 # Landing page & emergency banner
│   ├── login.html                 # Patient & Admin sign-in page with demo quick-fill
│   ├── registration.html          # Patient registration form
│   ├── patient-dashboard.html     # Patient workspace & slot booking modal
│   ├── admin-dashboard.html       # Admin command center & CSV export hub
│   ├── appointments.html          # Patient appointments page
│   ├── doctors.html               # Public medical specialists directory
│   ├── css/
│   │   └── style.css              # Custom clinical design system & dark/light aesthetic
│   └── js/
│       ├── app.js                 # Shared notification toast engine & API wrapper
│       ├── auth.js                # Auth forms & session handler
│       ├── patient.js             # Patient dashboard controller
│       └── admin.js               # Admin command center controller
├── routes/
│   ├── auth.js                    # Login, Register, Logout, Session endpoints
│   ├── patients.js                # Patient profile API
│   ├── doctors.js                 # Doctors roster & slot calculation API
│   ├── appointments.js            # Appointment booking & cancellation API
│   └── admin.js                   # Admin dashboard, management, & CSV export API
├── middleware/
│   ├── auth.js                    # Session verification middleware
│   └── admin.js                   # Admin role-authorization middleware
├── database/
│   ├── db.js                      # SQLite initialization & helper functions
│   └── schema.sql                 # DDL schema definition
├── utils/
│   └── csv-export.js              # CSV generator & injection defense utility
├── tests/
│   └── test.js                    # Comprehensive integration test suite
├── app.js                         # Server entrypoint
├── package.json                   # Dependencies & npm scripts
├── .env.example                   # Environment configuration template
└── README.md                      # Complete system documentation
```

---

## 🚀 Deploying to Vercel

The application is pre-configured with a `vercel.json` manifest and serverless `/tmp` database path resolution for seamless deployment to Vercel.

### Method 1: Deploying via Vercel CLI

1. Install Vercel CLI (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. Deploy directly from your terminal:
   ```bash
   vercel
   ```

3. Deploy to Production:
   ```bash
   vercel --prod
   ```

### Method 2: Deploying via GitHub & Vercel Dashboard

1. Push your repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Deploy Hospital Management System"
   git branch -M main
   git remote add origin https://github.com/your-username/hospital-management-system.git
   git push -u origin main
   ```

2. Go to [vercel.com/new](https://vercel.com/new) and import your repository.
3. Add Environment Variables in Vercel project settings:
   - `NODE_ENV`: `production`
   - `SESSION_SECRET`: `your-secure-production-secret-key-12345`
   - `DEMO_ADMIN_EMAIL`: your administrator email
   - `DEMO_ADMIN_PASSWORD`: a strong, unique administrator password
4. Click **Deploy**. Vercel will build and launch your full-stack Hospital Management System!

---

## 🔑 Demo Credentials

An initial administrator account is automatically seeded during database setup using the `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` environment variables. Set these to private, unique values before starting the application.

The administrator dashboard requires an authenticated administrator account. Patient accounts are redirected to the patient dashboard, and unauthenticated visitors are redirected to sign in.

---

## 🧪 Automated Testing

Run the automated test suite to verify database initialization, authentication, patient isolation, appointment double-booking prevention, admin authorization, and CSV exports:

```bash
cmd /c npm test
```

Expected Output:
```
======================================================
🧪 RUNNING AUTOMATED HOSPITAL MANAGEMENT SYSTEM TESTS
======================================================

  ✅ PASSED: 1. Database Tables & Seeded Demo Admin Verification
  ✅ PASSED: 2. Demo Admin Login with Valid Credentials
  ✅ PASSED: 3. Patient Registration Creates User & Patient Profile
  ✅ PASSED: 4. Duplicate Email Registration is Rejected (409 Conflict)
  ✅ PASSED: 5. Invalid Password Login Rejection
  ✅ PASSED: 6. Patient Cannot Access Admin Endpoints (403 Forbidden)
  ✅ PASSED: 7. Patient Cannot Download CSV Exports (403 Forbidden)
  ✅ PASSED: 8. Patient Appointment Booking & Server Availability Validation
  ✅ PASSED: 9. Double Booking Prevention for Same Doctor & Slot (409 Conflict)
  ✅ PASSED: 10. Admin Can Confirm & Reschedule Appointments
  ✅ PASSED: 11. Authorized Admin CSV Export with Injection Protection
  ✅ PASSED: 12. Admin Disabling Account Prevents Patient Login (403)
  ✅ PASSED: 13. System Activity Audit Logs Captured

======================================================
📊 TEST RESULTS: 13 PASSED, 0 FAILED
======================================================
```

---

## 📊 Database Schema Details

The application automatically creates a local SQLite database (`hospital.db`) on startup with the following relational schema:

1. **`users`**: Core authentication table storing `full_name`, `email` (unique), `phone`, `password_hash`, `role` (`patient` / `admin`), `account_status` (`active` / `disabled`), and timestamps.
2. **`patients`**: Patient profiles linked to `users.id` with `patient_number` (e.g., `PAT-10001`), `date_of_birth`, `gender`, `address`, and `emergency_contact`.
3. **`doctors`**: Medical specialists table containing `specialization`, `department`, `available_days` (JSON array), `consultation_start`, `consultation_end`, `slot_duration_minutes`, and `active` status.
4. **`appointments`**: Clinical appointments linked to `patients.id` and `doctors.id` with `appointment_date`, `start_time`, `end_time`, `reason_for_visit`, `status` (`pending`, `confirmed`, `completed`, `cancelled`, `rejected`), `admin_notes`, and `updated_by`. Includes a partial unique index on active slots to prevent double-bookings.
5. **`activity_logs`**: System audit trail tracking `actor_user_id`, `target_user_id`, `action`, `entity_type`, `entity_id`, `timestamp`, and sanitized JSON `metadata`.

---

## 🔒 Security Architecture Highlights

* **Parameterized Queries**: All database operations use prepared statements to completely eliminate SQL injection risks.
* **Role-Based Access Control (RBAC)**: Backend middleware strictly enforces access rules. Patients trying to hit admin endpoints or CSV exports receive an HTTP `403 Forbidden` response.
* **CSRF & Session Fixation Protection**: Sessions are regenerated upon login/registration and destroyed upon logout. Cookies are set with `httpOnly: true` and `sameSite: 'lax'`.
* **CSV Injection Hardening**: All CSV cells are sanitized against spreadsheet formula execution.

---

## 📜 License

MIT License - Open Source & Enterprise Ready.
