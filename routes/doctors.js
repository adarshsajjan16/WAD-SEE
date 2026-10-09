const express = require('express');
const router = express.Router();
const { db } = require('../database/db');

// Helper to convert HH:MM to total minutes from midnight
function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

// Helper to convert total minutes to HH:MM string
function minutesToTime(mins) {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
}

// GET /api/doctors - List all doctors (active by default)
router.get('/', (req, res) => {
    try {
        const includeInactive = req.query.all === 'true';
        let query = 'SELECT * FROM doctors';
        if (!includeInactive) {
            query += ' WHERE active = 1';
        }
        query += ' ORDER BY department ASC, full_name ASC';

        const doctors = db.prepare(query).all();

        // Parse JSON available_days
        const formattedDoctors = doctors.map(doc => {
            let availableDays = [];
            try {
                availableDays = JSON.parse(doc.available_days);
            } catch (e) {
                availableDays = doc.available_days ? doc.available_days.split(',') : [];
            }
            return {
                ...doc,
                available_days: availableDays
            };
        });

        return res.status(200).json({ doctors: formattedDoctors });
    } catch (err) {
        console.error('[GET DOCTORS ERROR]', err);
        return res.status(500).json({ error: 'Failed to retrieve doctors list.' });
    }
});

// GET /api/doctors/:id/slots?date=YYYY-MM-DD - Get available slots for doctor on specific date
router.get('/:id/slots', (req, res) => {
    const doctorId = parseInt(req.params.id, 10);
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Valid appointment date (YYYY-MM-DD) is required.' });
    }

    try {
        const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
        if (!doctor || !doctor.active) {
            return res.status(404).json({ error: 'Doctor not found or currently inactive.' });
        }

        // Determine weekday of target date
        const targetDate = new Date(`${date}T00:00:00`);
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = weekdays[targetDate.getDay()];

        let availableDays = [];
        try {
            availableDays = JSON.parse(doctor.available_days);
        } catch (e) {
            availableDays = doctor.available_days ? doctor.available_days.split(',') : [];
        }

        // Check if doctor works on this day
        const isWorkingDay = availableDays.includes(dayName);
        if (!isWorkingDay) {
            return res.status(200).json({
                date,
                dayName,
                isWorkingDay: false,
                message: `${doctor.full_name} is not available on ${dayName}s.`,
                slots: []
            });
        }

        // Generate time slots
        const startMins = timeToMinutes(doctor.consultation_start);
        const endMins = timeToMinutes(doctor.consultation_end);
        const duration = doctor.slot_duration_minutes || 30;

        // Fetch existing booked slots for this doctor on this date
        const existingBookings = db.prepare(`
            SELECT start_time, end_time, status
            FROM appointments
            WHERE doctor_id = ? AND appointment_date = ? AND status NOT IN ('cancelled', 'rejected')
        `).all(doctorId, date);

        const bookedStartTimes = new Set(existingBookings.map(b => b.start_time));

        // Check current date/time to filter past slots if booking for today
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const currentMins = now.getHours() * 60 + now.getMinutes();

        const slots = [];
        for (let t = startMins; t + duration <= endMins; t += duration) {
            const slotStart = minutesToTime(t);
            const slotEnd = minutesToTime(t + duration);

            let isBooked = bookedStartTimes.has(slotStart);
            let isPast = (date === todayStr && t < currentMins + 15); // Require at least 15m advance booking for today

            slots.push({
                start_time: slotStart,
                end_time: slotEnd,
                available: !isBooked && !isPast,
                reason: isBooked ? 'Already Booked' : (isPast ? 'Slot Past' : 'Available')
            });
        }

        return res.status(200).json({
            date,
            dayName,
            isWorkingDay: true,
            doctor_name: doctor.full_name,
            specialization: doctor.specialization,
            slots
        });

    } catch (err) {
        console.error('[GET DOCTOR SLOTS ERROR]', err);
        return res.status(500).json({ error: 'Failed to calculate available doctor slots.' });
    }
});

module.exports = router;
