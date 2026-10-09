const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// Helper to convert HH:MM to total minutes
function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(mins) {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
}

// POST /api/appointments - Patient creates appointment request
router.post('/', requireAuth, (req, res) => {
    if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can request appointments.' });
    }

    const { doctor_id, appointment_date, start_time, reason_for_visit } = req.body;

    if (!doctor_id || !appointment_date || !start_time || !reason_for_visit) {
        return res.status(400).json({ error: 'Doctor, date, time slot, and reason for visit are required.' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) {
        return res.status(400).json({ error: 'Invalid date format (must be YYYY-MM-DD).' });
    }

    // Check date is not in the past
    const todayStr = new Date().toISOString().split('T')[0];
    if (appointment_date < todayStr) {
        return res.status(400).json({ error: 'Cannot book appointments in the past.' });
    }

    try {
        // Find patient record derived strictly from session user id
        const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
        if (!patient) {
            return res.status(404).json({ error: 'Patient profile record not found.' });
        }

        // Verify Doctor
        const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctor_id);
        if (!doctor || !doctor.active) {
            return res.status(404).json({ error: 'Selected medical specialist is not available.' });
        }

        // Verify weekday availability
        const targetDate = new Date(`${appointment_date}T00:00:00`);
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = weekdays[targetDate.getDay()];

        let availableDays = [];
        try {
            availableDays = JSON.parse(doctor.available_days);
        } catch (e) {
            availableDays = doctor.available_days ? doctor.available_days.split(',') : [];
        }

        if (!availableDays.includes(dayName)) {
            return res.status(400).json({ error: `${doctor.full_name} does not consult on ${dayName}s.` });
        }

        // Compute end time based on doctor slot duration
        const duration = doctor.slot_duration_minutes || 30;
        const startMins = timeToMinutes(start_time);
        const endMins = startMins + duration;
        const endTime = minutesToTime(endMins);

        const doctorStartMins = timeToMinutes(doctor.consultation_start);
        const doctorEndMins = timeToMinutes(doctor.consultation_end);

        if (startMins < doctorStartMins || endMins > doctorEndMins) {
            return res.status(400).json({ error: 'Selected time slot is outside doctor consultation hours.' });
        }

        // Immediate Transaction Check to Prevent Double Bookings
        db.exec('BEGIN TRANSACTION;');

        // Check if doctor slot is already occupied
        const conflictDoctor = db.prepare(`
            SELECT id FROM appointments
            WHERE doctor_id = ? AND appointment_date = ? AND start_time = ?
              AND status NOT IN ('cancelled', 'rejected')
        `).get(doctor_id, appointment_date, start_time);

        if (conflictDoctor) {
            db.exec('ROLLBACK;');
            return res.status(409).json({ error: 'This time slot was just booked by another patient. Please select a different slot.' });
        }

        // Check if patient already has an active appointment at the exact same date and start time
        const conflictPatient = db.prepare(`
            SELECT id FROM appointments
            WHERE patient_id = ? AND appointment_date = ? AND start_time = ?
              AND status NOT IN ('cancelled', 'rejected')
        `).get(patient.id, appointment_date, start_time);

        if (conflictPatient) {
            db.exec('ROLLBACK;');
            return res.status(409).json({ error: 'You already have another active appointment scheduled for this exact date and time.' });
        }

        // Insert appointment
        const stmt = db.prepare(`
            INSERT INTO appointments (patient_id, doctor_id, appointment_date, start_time, end_time, reason_for_visit, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `);

        const result = stmt.run(
            patient.id,
            doctor_id,
            appointment_date,
            start_time,
            endTime,
            reason_for_visit.trim()
        );

        db.exec('COMMIT;');

        const appointmentId = result.lastInsertRowid;

        logActivity(req.user.id, req.user.id, 'APPOINTMENT_CREATE', 'appointments', appointmentId, {
            doctor_name: doctor.full_name,
            date: appointment_date,
            time: start_time
        });

        // Return details
        const createdAppt = db.prepare(`
            SELECT a.*, d.full_name as doctor_name, d.specialization, d.department
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.id = ?
        `).get(appointmentId);

        return res.status(201).json({
            message: 'Appointment request submitted successfully!',
            appointment: createdAppt
        });

    } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (e) {}
        console.error('[BOOK APPOINTMENT ERROR]', err);
        return res.status(500).json({ error: 'Failed to book appointment due to server error.' });
    }
});

// GET /api/appointments/my - Get patient's own appointments
router.get('/my', requireAuth, (req, res) => {
    if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'This route is reserved for patient accounts.' });
    }

    try {
        const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
        if (!patient) {
            return res.status(404).json({ error: 'Patient profile record not found.' });
        }

        const appointments = db.prepare(`
            SELECT a.*, d.full_name as doctor_name, d.specialization, d.department
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.patient_id = ?
            ORDER BY a.appointment_date DESC, a.start_time DESC
        `).all(patient.id);

        return res.status(200).json({ appointments });
    } catch (err) {
        console.error('[GET MY APPOINTMENTS ERROR]', err);
        return res.status(500).json({ error: 'Failed to retrieve appointments.' });
    }
});

// POST /api/appointments/:id/cancel - Patient requests cancellation
router.post('/:id/cancel', requireAuth, (req, res) => {
    const apptId = parseInt(req.params.id, 10);

    try {
        const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
        if (!patient) {
            return res.status(404).json({ error: 'Patient record not found.' });
        }

        const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(apptId);
        if (!appt) {
            return res.status(404).json({ error: 'Appointment not found.' });
        }

        // Verify patient ownership
        if (appt.patient_id !== patient.id) {
            return res.status(403).json({ error: 'You are not authorized to cancel another patient\'s appointment.' });
        }

        if (appt.status === 'completed' || appt.status === 'cancelled') {
            return res.status(400).json({ error: `Cannot cancel an appointment that is already ${appt.status}.` });
        }

        db.prepare(`
            UPDATE appointments
            SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP, updated_by = ?
            WHERE id = ?
        `).run(req.user.id, apptId);

        logActivity(req.user.id, req.user.id, 'APPOINTMENT_CANCEL_PATIENT', 'appointments', apptId, {
            previous_status: appt.status
        });

        return res.status(200).json({ message: 'Appointment cancelled successfully.' });
    } catch (err) {
        console.error('[CANCEL APPOINTMENT ERROR]', err);
        return res.status(500).json({ error: 'Failed to cancel appointment.' });
    }
});

module.exports = router;
