const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { sendCsvResponse } = require('../utils/csv-export');

// Enforce authentication & admin authorization on ALL admin routes
router.use(requireAuth, requireAdmin);

// GET /api/admin/dashboard - High-level metrics
router.get('/dashboard', (req, res) => {
    try {
        const totalPatients = db.prepare('SELECT COUNT(*) as c FROM patients').get().c;
        const totalActivePatients = db.prepare(`
            SELECT COUNT(*) as c FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE u.account_status = 'active'
        `).get().c;

        const totalDoctors = db.prepare('SELECT COUNT(*) as c FROM doctors WHERE active = 1').get().c;
        const totalAppointments = db.prepare('SELECT COUNT(*) as c FROM appointments').get().c;

        const apptCounts = db.prepare(`
            SELECT status, COUNT(*) as count
            FROM appointments
            GROUP BY status
        `).all();

        const statusMap = {
            pending: 0,
            confirmed: 0,
            completed: 0,
            cancelled: 0,
            rejected: 0
        };

        apptCounts.forEach(row => {
            if (statusMap.hasOwnProperty(row.status)) {
                statusMap[row.status] = row.count;
            }
        });

        const recentActivity = db.prepare(`
            SELECT a.*, u.full_name as actor_name, u.role as actor_role
            FROM activity_logs a
            LEFT JOIN users u ON a.actor_user_id = u.id
            ORDER BY a.timestamp DESC
            LIMIT 10
        `).all();

        return res.status(200).json({
            stats: {
                totalPatients,
                totalActivePatients,
                totalDoctors,
                totalAppointments,
                pendingAppointments: statusMap.pending,
                confirmedAppointments: statusMap.confirmed,
                completedAppointments: statusMap.completed,
                cancelledAppointments: statusMap.cancelled + statusMap.rejected
            },
            recentActivity
        });
    } catch (err) {
        console.error('[ADMIN DASHBOARD ERROR]', err);
        return res.status(500).json({ error: 'Failed to retrieve dashboard metrics.' });
    }
});

// GET /api/admin/patients - Search & List Patients
router.get('/patients', (req, res) => {
    const { search } = req.query;

    try {
        let query = `
            SELECT p.*, u.full_name, u.email, u.phone, u.account_status, u.created_at as registered_at, u.last_login_at
            FROM patients p
            JOIN users u ON p.user_id = u.id
        `;
        const params = [];

        if (search && search.trim() !== '') {
            query += ` WHERE (p.patient_number LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
            const pattern = `%${search.trim()}%`;
            params.push(pattern, pattern, pattern, pattern);
        }

        query += ' ORDER BY p.id DESC';

        const patients = db.prepare(query).all(...params);
        return res.status(200).json({ patients });
    } catch (err) {
        console.error('[ADMIN GET PATIENTS ERROR]', err);
        return res.status(500).json({ error: 'Failed to retrieve patient records.' });
    }
});

// GET /api/admin/patients/:id - Specific patient details
router.get('/patients/:id', (req, res) => {
    const patientId = parseInt(req.params.id, 10);

    try {
        const patient = db.prepare(`
            SELECT p.*, u.full_name, u.email, u.phone, u.account_status, u.created_at as registered_at, u.last_login_at
            FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = ?
        `).get(patientId);

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        const appointments = db.prepare(`
            SELECT a.*, d.full_name as doctor_name, d.specialization
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.patient_id = ?
            ORDER BY a.appointment_date DESC, a.start_time DESC
        `).all(patientId);

        return res.status(200).json({ patient, appointments });
    } catch (err) {
        console.error('[ADMIN GET PATIENT DETAIL ERROR]', err);
        return res.status(500).json({ error: 'Failed to fetch patient details.' });
    }
});

// PATCH /api/admin/patients/:id - Edit any patient field or toggle status
router.patch('/patients/:id', (req, res) => {
    const patientId = parseInt(req.params.id, 10);
    const { full_name, email, phone, account_status, address, emergency_contact, date_of_birth, gender } = req.body;

    try {
        const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
        if (!patient) {
            return res.status(404).json({ error: 'Patient record not found.' });
        }

        // Validate name if provided
        if (full_name && !/^[A-Za-z\s]+$/.test(full_name.trim())) {
            return res.status(400).json({ error: 'Full name must contain only letters and spaces.' });
        }

        // Validate phone if provided
        if (phone && !/^\d{10}$/.test(phone.trim())) {
            return res.status(400).json({ error: 'Phone number must contain exactly 10 numeric digits.' });
        }

        // Validate email if provided
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())) {
            return res.status(400).json({ error: 'Invalid email address format.' });
        }

        db.exec('BEGIN TRANSACTION;');

        // Update user fields
        if (full_name || email || phone || account_status) {
            db.prepare(`
                UPDATE users
                SET full_name = COALESCE(?, full_name),
                    email = COALESCE(?, email),
                    phone = COALESCE(?, phone),
                    account_status = COALESCE(?, account_status),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                full_name ? full_name.trim() : null,
                email ? email.trim().toLowerCase() : null,
                phone ? phone.trim() : null,
                account_status || null,
                patient.user_id
            );
        }

        // Update patient fields
        db.prepare(`
            UPDATE patients
            SET address = COALESCE(?, address),
                emergency_contact = COALESCE(?, emergency_contact),
                date_of_birth = COALESCE(?, date_of_birth),
                gender = COALESCE(?, gender),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            address ? address.trim() : null,
            emergency_contact ? emergency_contact.trim() : null,
            date_of_birth || null,
            gender || null,
            patientId
        );

        db.exec('COMMIT;');

        logActivity(req.user.id, patient.user_id, 'ADMIN_UPDATE_PATIENT_FULL', 'patients', patientId, {
            account_status,
            full_name,
            email,
            phone
        });

        const updated = db.prepare(`
            SELECT p.*, u.full_name, u.email, u.phone, u.account_status
            FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = ?
        `).get(patientId);

        return res.status(200).json({ message: 'Patient profile updated by administrator.', patient: updated });
    } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (e) {}
        console.error('[ADMIN UPDATE PATIENT ERROR]', err);
        return res.status(500).json({ error: 'Failed to update patient record.' });
    }
});

// GET /api/admin/doctors - List Doctors
router.get('/doctors', (req, res) => {
    try {
        const doctors = db.prepare('SELECT * FROM doctors ORDER BY department ASC, full_name ASC').all();
        const formatted = doctors.map(d => ({
            ...d,
            available_days: JSON.parse(d.available_days || '[]')
        }));
        return res.status(200).json({ doctors: formatted });
    } catch (err) {
        console.error('[ADMIN GET DOCTORS ERROR]', err);
        return res.status(500).json({ error: 'Failed to retrieve doctors.' });
    }
});

// POST /api/admin/doctors - Create Doctor
router.post('/doctors', (req, res) => {
    const { full_name, specialization, department, available_days, consultation_start, consultation_end, slot_duration_minutes } = req.body;

    if (!full_name || !specialization || !department || !available_days || !consultation_start || !consultation_end) {
        return res.status(400).json({ error: 'Full name, specialization, department, available days, start time, and end time are required.' });
    }

    try {
        const availableDaysJson = Array.isArray(available_days) ? JSON.stringify(available_days) : JSON.stringify([available_days]);

        const stmt = db.prepare(`
            INSERT INTO doctors (full_name, specialization, department, available_days, consultation_start, consultation_end, slot_duration_minutes, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `);

        const result = stmt.run(
            full_name.trim(),
            specialization.trim(),
            department.trim(),
            availableDaysJson,
            consultation_start,
            consultation_end,
            parseInt(slot_duration_minutes, 10) || 30
        );

        const doctorId = result.lastInsertRowid;

        logActivity(req.user.id, null, 'ADMIN_CREATE_DOCTOR', 'doctors', doctorId, {
            full_name,
            specialization
        });

        const newDoctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
        newDoctor.available_days = JSON.parse(newDoctor.available_days);

        return res.status(201).json({ message: 'Medical specialist created successfully!', doctor: newDoctor });
    } catch (err) {
        console.error('[ADMIN CREATE DOCTOR ERROR]', err);
        return res.status(500).json({ error: 'Failed to add new doctor.' });
    }
});

// PATCH /api/admin/doctors/:id - Update Doctor
router.patch('/doctors/:id', (req, res) => {
    const doctorId = parseInt(req.params.id, 10);
    const { full_name, specialization, department, available_days, consultation_start, consultation_end, slot_duration_minutes, active } = req.body;

    try {
        const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
        if (!doctor) {
            return res.status(404).json({ error: 'Doctor not found.' });
        }

        const availableDaysJson = available_days ? (Array.isArray(available_days) ? JSON.stringify(available_days) : available_days) : doctor.available_days;

        db.prepare(`
            UPDATE doctors
            SET full_name = COALESCE(?, full_name),
                specialization = COALESCE(?, specialization),
                department = COALESCE(?, department),
                available_days = ?,
                consultation_start = COALESCE(?, consultation_start),
                consultation_end = COALESCE(?, consultation_end),
                slot_duration_minutes = COALESCE(?, slot_duration_minutes),
                active = COALESCE(?, active)
            WHERE id = ?
        `).run(
            full_name ? full_name.trim() : null,
            specialization ? specialization.trim() : null,
            department ? department.trim() : null,
            availableDaysJson,
            consultation_start || null,
            consultation_end || null,
            slot_duration_minutes !== undefined ? parseInt(slot_duration_minutes, 10) : null,
            active !== undefined ? (active ? 1 : 0) : null,
            doctorId
        );

        logActivity(req.user.id, null, 'ADMIN_UPDATE_DOCTOR', 'doctors', doctorId, {
            active
        });

        const updated = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
        updated.available_days = JSON.parse(updated.available_days);

        return res.status(200).json({ message: 'Doctor profile updated.', doctor: updated });
    } catch (err) {
        console.error('[ADMIN UPDATE DOCTOR ERROR]', err);
        return res.status(500).json({ error: 'Failed to update doctor.' });
    }
});

// GET /api/admin/appointments - Search & Filter Master Appointments Table
router.get('/appointments', (req, res) => {
    const { status, doctor_id, patient_id, date, search } = req.query;

    try {
        let query = `
            SELECT a.*,
                   u.full_name as patient_name, u.email as patient_email, u.phone as patient_phone, p.patient_number,
                   d.full_name as doctor_name, d.specialization, d.department,
                   ub.full_name as updated_by_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN users u ON p.user_id = u.id
            JOIN doctors d ON a.doctor_id = d.id
            LEFT JOIN users ub ON a.updated_by = ub.id
        `;

        const conditions = [];
        const params = [];

        if (status && status !== 'all') {
            conditions.push('a.status = ?');
            params.push(status);
        }

        if (doctor_id) {
            conditions.push('a.doctor_id = ?');
            params.push(parseInt(doctor_id, 10));
        }

        if (patient_id) {
            conditions.push('a.patient_id = ?');
            params.push(parseInt(patient_id, 10));
        }

        if (date) {
            conditions.push('a.appointment_date = ?');
            params.push(date);
        }

        if (search && search.trim() !== '') {
            conditions.push('(u.full_name LIKE ? OR p.patient_number LIKE ? OR d.full_name LIKE ? OR a.reason_for_visit LIKE ?)');
            const pat = `%${search.trim()}%`;
            params.push(pat, pat, pat, pat);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY a.appointment_date DESC, a.start_time ASC';

        const appointments = db.prepare(query).all(...params);
        return res.status(200).json({ appointments });
    } catch (err) {
        console.error('[ADMIN GET APPOINTMENTS ERROR]', err);
        return res.status(500).json({ error: 'Failed to fetch appointments.' });
    }
});

// PATCH /api/admin/appointments/:id - Update status, reschedule, or add admin notes
router.patch('/appointments/:id', (req, res) => {
    const apptId = parseInt(req.params.id, 10);
    const { status, admin_notes, appointment_date, start_time, doctor_id } = req.body;

    try {
        const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(apptId);
        if (!appt) {
            return res.status(404).json({ error: 'Appointment not found.' });
        }

        const targetDoctorId = doctor_id ? parseInt(doctor_id, 10) : appt.doctor_id;
        const targetDate = appointment_date || appt.appointment_date;
        const targetStart = start_time || appt.start_time;

        // If date, doctor, or start_time is being updated, verify double-booking
        if (appointment_date || start_time || doctor_id) {
            const conflict = db.prepare(`
                SELECT id FROM appointments
                WHERE doctor_id = ? AND appointment_date = ? AND start_time = ?
                  AND id != ? AND status NOT IN ('cancelled', 'rejected')
            `).get(targetDoctorId, targetDate, targetStart, apptId);

            if (conflict) {
                return res.status(409).json({ error: 'Reschedule conflict: Target doctor already has an active slot at this date and time.' });
            }
        }

        // Compute end time if start time or doctor changed
        let targetEnd = appt.end_time;
        if (start_time || doctor_id) {
            const doc = db.prepare('SELECT slot_duration_minutes FROM doctors WHERE id = ?').get(targetDoctorId);
            if (doc) {
                const [h, m] = targetStart.split(':').map(Number);
                const endMins = h * 60 + m + (doc.slot_duration_minutes || 30);
                const eh = String(Math.floor(endMins / 60)).padStart(2, '0');
                const em = String(endMins % 60).padStart(2, '0');
                targetEnd = `${eh}:${em}`;
            }
        }

        db.prepare(`
            UPDATE appointments
            SET status = COALESCE(?, status),
                admin_notes = COALESCE(?, admin_notes),
                doctor_id = ?,
                appointment_date = ?,
                start_time = ?,
                end_time = ?,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = ?
            WHERE id = ?
        `).run(
            status || null,
            admin_notes !== undefined ? admin_notes : null,
            targetDoctorId,
            targetDate,
            targetStart,
            targetEnd,
            req.user.id,
            apptId
        );

        logActivity(req.user.id, null, 'ADMIN_UPDATE_APPOINTMENT', 'appointments', apptId, {
            new_status: status || appt.status,
            rescheduled: !!(appointment_date || start_time)
        });

        const updated = db.prepare(`
            SELECT a.*, u.full_name as patient_name, p.patient_number, d.full_name as doctor_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN users u ON p.user_id = u.id
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.id = ?
        `).get(apptId);

        return res.status(200).json({ message: 'Appointment updated successfully by administrator.', appointment: updated });

    } catch (err) {
        console.error('[ADMIN UPDATE APPOINTMENT ERROR]', err);
        return res.status(500).json({ error: 'Failed to update appointment status.' });
    }
});

// GET /api/admin/activity-logs - Audit Logs
router.get('/activity-logs', (req, res) => {
    try {
        const logs = db.prepare(`
            SELECT a.*,
                   u.full_name as actor_name, u.email as actor_email, u.role as actor_role,
                   tu.full_name as target_name, tu.email as target_email
            FROM activity_logs a
            LEFT JOIN users u ON a.actor_user_id = u.id
            LEFT JOIN users tu ON a.target_user_id = tu.id
            ORDER BY a.timestamp DESC
            LIMIT 100
        `).all();

        return res.status(200).json({ logs });
    } catch (err) {
        console.error('[ADMIN GET ACTIVITY LOGS ERROR]', err);
        return res.status(500).json({ error: 'Failed to fetch activity logs.' });
    }
});

// ==========================================
// CSV EXPORT ENDPOINTS (ADMIN ONLY)
// ==========================================

// Export Patients CSV
router.get('/export/patients', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT p.patient_number, u.full_name, u.email, u.phone, p.date_of_birth, p.gender, p.address, p.emergency_contact, u.account_status, u.created_at
            FROM patients p
            JOIN users u ON p.user_id = u.id
            ORDER BY p.id ASC
        `).all();

        const headers = [
            { label: 'Patient Number', key: 'patient_number' },
            { label: 'Full Name', key: 'full_name' },
            { label: 'Email', key: 'email' },
            { label: 'Phone', key: 'phone' },
            { label: 'Date of Birth', key: 'date_of_birth' },
            { label: 'Gender', key: 'gender' },
            { label: 'Address', key: 'address' },
            { label: 'Emergency Contact', key: 'emergency_contact' },
            { label: 'Account Status', key: 'account_status' },
            { label: 'Registration Date', key: 'created_at' }
        ];

        logActivity(req.user.id, null, 'ADMIN_EXPORT_CSV', 'patients', null, { type: 'patients' });

        return sendCsvResponse(res, `patients_export_${Date.now()}.csv`, headers, rows);
    } catch (err) {
        console.error('[CSV EXPORT PATIENTS ERROR]', err);
        return res.status(500).json({ error: 'Failed to generate patients CSV export.' });
    }
});

// Export Appointments CSV
router.get('/export/appointments', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT a.id, p.patient_number, u.full_name as patient_name, d.full_name as doctor_name, d.specialization,
                   a.appointment_date, a.start_time, a.end_time, a.status, a.reason_for_visit, a.admin_notes, a.created_at
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN users u ON p.user_id = u.id
            JOIN doctors d ON a.doctor_id = d.id
            ORDER BY a.appointment_date DESC, a.start_time ASC
        `).all();

        const headers = [
            { label: 'Appointment ID', key: 'id' },
            { label: 'Patient Number', key: 'patient_number' },
            { label: 'Patient Name', key: 'patient_name' },
            { label: 'Doctor Name', key: 'doctor_name' },
            { label: 'Specialization', key: 'specialization' },
            { label: 'Date', key: 'appointment_date' },
            { label: 'Start Time', key: 'start_time' },
            { label: 'End Time', key: 'end_time' },
            { label: 'Status', key: 'status' },
            { label: 'Reason for Visit', key: 'reason_for_visit' },
            { label: 'Admin Notes', key: 'admin_notes' },
            { label: 'Created At', key: 'created_at' }
        ];

        logActivity(req.user.id, null, 'ADMIN_EXPORT_CSV', 'appointments', null, { type: 'appointments' });

        return sendCsvResponse(res, `appointments_export_${Date.now()}.csv`, headers, rows);
    } catch (err) {
        console.error('[CSV EXPORT APPOINTMENTS ERROR]', err);
        return res.status(500).json({ error: 'Failed to generate appointments CSV export.' });
    }
});

// Export Doctors CSV
router.get('/export/doctors', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT id, full_name, department, specialization, available_days, consultation_start, consultation_end, slot_duration_minutes, active, created_at
            FROM doctors
            ORDER BY id ASC
        `).all();

        const headers = [
            { label: 'Doctor ID', key: 'id' },
            { label: 'Full Name', key: 'full_name' },
            { label: 'Department', key: 'department' },
            { label: 'Specialization', key: 'specialization' },
            { label: 'Available Days', key: 'available_days' },
            { label: 'Consultation Start', key: 'consultation_start' },
            { label: 'Consultation End', key: 'consultation_end' },
            { label: 'Slot Duration (Mins)', key: 'slot_duration_minutes' },
            { label: 'Active', key: 'active' },
            { label: 'Created At', key: 'created_at' }
        ];

        logActivity(req.user.id, null, 'ADMIN_EXPORT_CSV', 'doctors', null, { type: 'doctors' });

        return sendCsvResponse(res, `doctors_export_${Date.now()}.csv`, headers, rows);
    } catch (err) {
        console.error('[CSV EXPORT DOCTORS ERROR]', err);
        return res.status(500).json({ error: 'Failed to generate doctors CSV export.' });
    }
});

// Export Activity Logs CSV
router.get('/export/activity-logs', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT a.id, a.timestamp, u.full_name as actor, u.role as actor_role, a.action, a.entity_type, a.entity_id, a.metadata
            FROM activity_logs a
            LEFT JOIN users u ON a.actor_user_id = u.id
            ORDER BY a.timestamp DESC
        `).all();

        const headers = [
            { label: 'Log ID', key: 'id' },
            { label: 'Timestamp', key: 'timestamp' },
            { label: 'Actor', key: 'actor' },
            { label: 'Role', key: 'actor_role' },
            { label: 'Action', key: 'action' },
            { label: 'Entity Type', key: 'entity_type' },
            { label: 'Entity ID', key: 'entity_id' },
            { label: 'Details', key: 'metadata' }
        ];

        logActivity(req.user.id, null, 'ADMIN_EXPORT_CSV', 'activity_logs', null, { type: 'activity_logs' });

        return sendCsvResponse(res, `activity_logs_export_${Date.now()}.csv`, headers, rows);
    } catch (err) {
        console.error('[CSV EXPORT ACTIVITY LOGS ERROR]', err);
        return res.status(500).json({ error: 'Failed to generate activity logs CSV export.' });
    }
});

module.exports = router;
