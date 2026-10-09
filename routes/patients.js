const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// GET /api/patients/me - Get logged-in patient's full record
router.get('/me', requireAuth, (req, res) => {
    if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'This route is reserved for patient accounts.' });
    }

    try {
        const patient = db.prepare(`
            SELECT p.*, u.full_name, u.email, u.phone, u.account_status, u.created_at as account_created_at
            FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE u.id = ?
        `).get(req.user.id);

        if (!patient) {
            return res.status(404).json({ error: 'Patient profile record not found.' });
        }

        // Fetch patient's appointments
        const appointments = db.prepare(`
            SELECT a.*, d.full_name as doctor_name, d.specialization, d.department
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.patient_id = ?
            ORDER BY a.appointment_date DESC, a.start_time DESC
        `).all(patient.id);

        return res.status(200).json({
            patient,
            appointments
        });
    } catch (err) {
        console.error('[GET PATIENT ME ERROR]', err);
        return res.status(500).json({ error: 'Failed to retrieve patient profile.' });
    }
});

// PATCH /api/patients/me - Update permitted patient profile fields
router.post('/me', requireAuth, (req, res) => {
    if (req.user.role !== 'patient') {
        return res.status(403).json({ error: 'Only patient accounts can update patient profile details.' });
    }

    const { phone, address, emergency_contact, date_of_birth, gender } = req.body;

    try {
        const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
        if (!patient) {
            return res.status(404).json({ error: 'Patient record not found.' });
        }

        db.exec('BEGIN TRANSACTION;');

        // Update phone on users table if provided
        if (phone && phone.trim() !== '') {
            const trimmedPhone = phone.trim();
            if (!/^\d{10}$/.test(trimmedPhone)) {
                return res.status(400).json({ error: 'Phone number must contain exactly 10 numeric digits.' });
            }
            db.prepare('UPDATE users SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(trimmedPhone, req.user.id);
        }

        // Update permitted fields on patients table
        db.prepare(`
            UPDATE patients
            SET date_of_birth = COALESCE(?, date_of_birth),
                gender = COALESCE(?, gender),
                address = COALESCE(?, address),
                emergency_contact = COALESCE(?, emergency_contact),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            date_of_birth || null,
            gender || null,
            address ? address.trim() : null,
            emergency_contact ? emergency_contact.trim() : null,
            patient.id
        );

        db.exec('COMMIT;');

        logActivity(req.user.id, req.user.id, 'PATIENT_UPDATE_PROFILE', 'patients', patient.id, {
            updated_fields: { phone, address, emergency_contact, date_of_birth, gender }
        });

        // Return updated record
        const updatedRecord = db.prepare(`
            SELECT p.*, u.full_name, u.email, u.phone
            FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = ?
        `).get(patient.id);

        return res.status(200).json({
            message: 'Profile updated successfully!',
            patient: updatedRecord
        });
    } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (e) {}
        console.error('[UPDATE PATIENT ME ERROR]', err);
        return res.status(500).json({ error: 'Failed to update patient profile.' });
    }
});

module.exports = router;
