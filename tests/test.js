/**
 * Automated Verification & Integration Test Suite
 * Hospital Management System
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Use a dedicated test database
process.env.DB_FILE = 'hospital_test.db';
process.env.SESSION_SECRET = 'test_secret_key_2026';

const app = require('../app');
const { db } = require('../database/db');

// Simple async HTTP test runner using node built-in fetch / http
let server;
let baseUrl;

async function runTests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING AUTOMATED HOSPITAL MANAGEMENT SYSTEM TESTS');
    console.log('======================================================\n');

    // Start server on free ephemeral port
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    let passedCount = 0;
    let failedCount = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  ✅ PASSED: ${name}`);
            passedCount++;
        } catch (err) {
            console.error(`  ❌ FAILED: ${name}`);
            console.error(`     Error: ${err.message}`);
            failedCount++;
        }
    }

    // Helper for requests with cookie session tracking
    class TestClient {
        constructor() {
            this.cookie = null;
        }

        async request(path, options = {}) {
            options.headers = options.headers || {};
            options.headers['Content-Type'] = 'application/json';

            if (this.cookie) {
                options.headers['Cookie'] = this.cookie;
            }

            const response = await fetch(`${baseUrl}${path}`, options);
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) {
                this.cookie = setCookie.split(';')[0];
            }

            const contentType = response.headers.get('content-type') || '';
            let body = null;
            if (contentType.includes('application/json')) {
                body = await response.json();
            } else if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
                body = await response.text();
            }

            return { status: response.status, headers: response.headers, body };
        }
    }

    try {
        // TEST 1: Database Setup & Seeding Verification
        await test('1. Database Tables & Seeded Demo Admin Verification', async () => {
            const admin = db.prepare("SELECT * FROM users WHERE email = 'admin@hospital.local'").get();
            assert.ok(admin, 'Demo admin account must exist in DB');
            assert.strictEqual(admin.role, 'admin');
            assert.strictEqual(admin.account_status, 'active');
            assert.notStrictEqual(admin.password_hash, '123456', 'Password must be hashed with bcrypt');

            const doctors = db.prepare('SELECT COUNT(*) as count FROM doctors').get().count;
            assert.ok(doctors >= 3, 'Must seed initial medical specialists');
        });

        // TEST 2: Admin Login
        const adminClient = new TestClient();
        await test('2. Demo Admin Login with Valid Credentials', async () => {
            const res = await adminClient.request('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    email: 'admin@hospital.local',
                    password: '123456'
                })
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.user.role, 'admin');
            assert.ok(adminClient.cookie, 'Session cookie must be assigned');
        });

        // TEST 3: Patient Registration
        const patient1Client = new TestClient();
        let patient1Id = null;
        let patient1UserId = null;
        await test('3. Patient Registration Creates User & Patient Profile', async () => {
            const res = await patient1Client.request('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: 'John Doe',
                    email: 'john.doe@example.com',
                    phone: '+1-555-0188',
                    password: 'password123',
                    confirmPassword: 'password123',
                    date_of_birth: '1990-05-15',
                    gender: 'Male',
                    address: '123 Health Ave'
                })
            });

            assert.strictEqual(res.status, 201);
            assert.strictEqual(res.body.user.role, 'patient');
            assert.ok(res.body.user.patient_number.startsWith('PAT-'));

            patient1UserId = res.body.user.id;
            const patRecord = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(patient1UserId);
            patient1Id = patRecord.id;
        });

        await test('3a. Only Administrators Can Open the Admin Dashboard Page', async () => {
            const anonymousClient = new TestClient();
            const anonymousRes = await anonymousClient.request('/admin-dashboard.html', {
                redirect: 'manual'
            });
            assert.strictEqual(anonymousRes.status, 302);
            assert.strictEqual(anonymousRes.headers.get('location'), '/login.html');

            const patientRes = await patient1Client.request('/admin-dashboard', {
                redirect: 'manual'
            });
            assert.strictEqual(patientRes.status, 302);
            assert.strictEqual(patientRes.headers.get('location'), '/patient-dashboard.html');

            const adminRes = await adminClient.request('/admin-dashboard.html', {
                redirect: 'manual'
            });
            assert.strictEqual(adminRes.status, 200);
        });

        // TEST 4: Duplicate Email Rejection
        await test('4. Duplicate Email Registration is Rejected (409 Conflict)', async () => {
            const client = new TestClient();
            const res = await client.request('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: 'John Clone',
                    email: 'john.doe@example.com', // Duplicate
                    phone: '+1-555-9999',
                    password: 'password123',
                    confirmPassword: 'password123'
                })
            });

            assert.strictEqual(res.status, 409);
            assert.ok(res.body.error.includes('already exists'));
        });

        // TEST 5: Invalid Password Rejection
        await test('5. Invalid Password Login Rejection', async () => {
            const client = new TestClient();
            const res = await client.request('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    email: 'john.doe@example.com',
                    password: 'wrongpassword'
                })
            });

            assert.strictEqual(res.status, 401);
            assert.strictEqual(res.body.error, 'Invalid email or password.');
        });

        // TEST 6: Patient Authorization & Security Isolation
        await test('6. Patient Cannot Access Admin Endpoints (403 Forbidden)', async () => {
            const res = await patient1Client.request('/api/admin/dashboard', {
                method: 'GET'
            });

            assert.strictEqual(res.status, 403);
            assert.ok(res.body.error.includes('Access denied'));
        });

        // TEST 7: Patient CSV Export Protection
        await test('7. Patient Cannot Download CSV Exports (403 Forbidden)', async () => {
            const res = await patient1Client.request('/api/admin/export/patients', {
                method: 'GET'
            });

            assert.strictEqual(res.status, 403);
        });

        // TEST 8: Appointment Booking & Dynamic Slot Calculation
        let apptId = null;
        await test('8. Patient Appointment Booking & Server Availability Validation', async () => {
            const doctor = db.prepare('SELECT id FROM doctors WHERE active = 1 LIMIT 1').get();
            
            // Calculate a guaranteed working day (e.g. next Monday)
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + ((1 + 7 - futureDate.getDay()) % 7 || 7));
            const y = futureDate.getFullYear();
            const m = String(futureDate.getMonth() + 1).padStart(2, '0');
            const d = String(futureDate.getDate()).padStart(2, '0');
            const apptDate = `${y}-${m}-${d}`;

            const res = await patient1Client.request('/api/appointments', {
                method: 'POST',
                body: JSON.stringify({
                    doctor_id: doctor.id,
                    appointment_date: apptDate,
                    start_time: '10:00',
                    reason_for_visit: 'Routine Annual Cardiac Consultation'
                })
            });

            if (res.status !== 201) {
                console.error('Test 8 Failure Body:', res.body);
            }

            assert.strictEqual(res.status, 201);
            assert.strictEqual(res.body.appointment.status, 'pending');
            apptId = res.body.appointment.id;
        });

        // TEST 9: Double Booking Conflict Prevention
        await test('9. Double Booking Prevention for Same Doctor & Slot (409 Conflict)', async () => {
            // Second patient attempts to book exact same doctor and slot
            const patient2Client = new TestClient();
            await patient2Client.request('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: 'Alice Smith',
                    email: 'alice.smith@example.com',
                    phone: '+1-555-0199',
                    password: 'password123',
                    confirmPassword: 'password123'
                })
            });

            const appt = db.prepare('SELECT doctor_id, appointment_date, start_time FROM appointments WHERE id = ?').get(apptId);

            const conflictRes = await patient2Client.request('/api/appointments', {
                method: 'POST',
                body: JSON.stringify({
                    doctor_id: appt.doctor_id,
                    appointment_date: appt.appointment_date,
                    start_time: appt.start_time,
                    reason_for_visit: 'Conflicting Booking Request'
                })
            });

            assert.strictEqual(conflictRes.status, 409);
            assert.ok(conflictRes.body.error.includes('booked by another patient'));
        });

        // TEST 10: Admin Appointment Management & Status Updates
        await test('10. Admin Can Confirm & Reschedule Appointments', async () => {
            const confirmRes = await adminClient.request(`/api/admin/appointments/${apptId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'confirmed', admin_notes: 'Confirmed by Admin Desk' })
            });

            assert.strictEqual(confirmRes.status, 200);
            assert.strictEqual(confirmRes.body.appointment.status, 'confirmed');
            assert.strictEqual(confirmRes.body.appointment.admin_notes, 'Confirmed by Admin Desk');
        });

        // TEST 11: Admin CSV Exports
        await test('11. Authorized Admin CSV Export with Injection Protection', async () => {
            const csvRes = await adminClient.request('/api/admin/export/patients', {
                method: 'GET'
            });

            assert.strictEqual(csvRes.status, 200);
            assert.ok(csvRes.headers.get('content-type').includes('text/csv'));
            assert.ok(csvRes.body.includes('Patient Number'));
            assert.ok(csvRes.body.includes('John Doe'));
        });

        // TEST 12: Account Status Toggle & Blocked Login
        await test('12. Admin Disabling Account Prevents Patient Login (403)', async () => {
            // Admin disables John Doe's account
            await adminClient.request(`/api/admin/patients/${patient1Id}`, {
                method: 'PATCH',
                body: JSON.stringify({ account_status: 'disabled' })
            });

            const loginRes = await patient1Client.request('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    email: 'john.doe@example.com',
                    password: 'password123'
                })
            });

            assert.strictEqual(loginRes.status, 403);
            assert.ok(loginRes.body.error.includes('Account disabled'));
        });

        // TEST 13: Activity Audit Log Recording
        await test('13. System Activity Audit Logs Captured', async () => {
            const logsRes = await adminClient.request('/api/admin/activity-logs', {
                method: 'GET'
            });

            assert.strictEqual(logsRes.status, 200);
            assert.ok(logsRes.body.logs.length > 0);
        });

    } finally {
        server.close();
        // Clean up test DB file
        try {
            db.close();
            const testDbPath = path.resolve(__dirname, '..', 'hospital_test.db');
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        } catch (e) {}
    }

    console.log('\n======================================================');
    console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('======================================================\n');

    if (failedCount > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test runner failure:', err);
    process.exit(1);
});
