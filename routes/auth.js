const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, logActivity, generatePatientNumber } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// Rate limiter for authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nameRegex = /^[A-Za-z\s]+$/;
const phoneRegex = /^\d{10}$/;

// POST /api/auth/register - Patient Registration with Strict Logic
router.post('/register', authLimiter, (req, res) => {
    const { full_name, email, phone, password, confirmPassword, date_of_birth, gender, address, emergency_contact } = req.body;

    // 1. Mandatory Field Check
    if (!full_name || !email || !phone || !password || !confirmPassword) {
        return res.status(400).json({ error: 'Full name, email, 10-digit phone number, password, and password confirmation are required.' });
    }

    const trimmedName = full_name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();

    // 2. Name Validation (Only alphabets and spaces)
    if (!nameRegex.test(trimmedName)) {
        return res.status(400).json({ error: 'Full name must contain only letters and spaces (no numbers or special characters).' });
    }

    // 3. Email Validation
    if (!emailRegex.test(trimmedEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address format (e.g. user@example.com).' });
    }

    // 4. Mobile Number Validation (Strictly 10 digits)
    if (!phoneRegex.test(trimmedPhone)) {
        return res.status(400).json({ error: 'Phone number must contain exactly 10 numeric digits.' });
    }

    // 5. Password Length & Match Validation
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Password and confirm password do not match.' });
    }

    // 6. Check Duplicate Email
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
    if (existingUser) {
        return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    try {
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(password, salt);

        db.exec('BEGIN TRANSACTION;');

        const userStmt = db.prepare(`
            INSERT INTO users (full_name, email, phone, password_hash, role, account_status)
            VALUES (?, ?, ?, ?, 'patient', 'active')
        `);
        const userResult = userStmt.run(trimmedName, trimmedEmail, trimmedPhone, passwordHash);
        const userId = userResult.lastInsertRowid;

        const patientNum = generatePatientNumber();
        const patientStmt = db.prepare(`
            INSERT INTO patients (user_id, patient_number, date_of_birth, gender, address, emergency_contact)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        patientStmt.run(
            userId,
            patientNum,
            date_of_birth || null,
            gender || null,
            address ? address.trim() : null,
            emergency_contact ? emergency_contact.trim() : null
        );

        db.exec('COMMIT;');

        logActivity(userId, userId, 'PATIENT_REGISTER', 'users', userId, {
            email: trimmedEmail,
            patient_number: patientNum
        });

        req.session.regenerate((err) => {
            if (err) console.error('Session error:', err);
            req.session.userId = userId;
            return res.status(201).json({
                message: 'Registration successful! Welcome to HealthCare+ Portal.',
                user: {
                    id: userId,
                    full_name: trimmedName,
                    email: trimmedEmail,
                    role: 'patient',
                    patient_number: patientNum
                }
            });
        });

    } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (e) {}
        console.error('[REGISTER ERROR]', err);
        return res.status(500).json({ error: 'Registration failed due to a server error. Please try again.' });
    }
});

// POST /api/auth/login - Login
router.post('/login', authLimiter, (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail);

        if (!user) {
            logActivity(null, null, 'LOGIN_FAILED', 'users', null, { email: trimmedEmail, reason: 'user_not_found' });
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        if (user.account_status === 'disabled') {
            logActivity(user.id, user.id, 'LOGIN_BLOCKED', 'users', user.id, { reason: 'account_disabled' });
            return res.status(403).json({ error: 'Account disabled. Please contact system administrator.' });
        }

        const isMatch = bcrypt.compareSync(password, user.password_hash);
        if (!isMatch) {
            logActivity(user.id, user.id, 'LOGIN_FAILED', 'users', user.id, { reason: 'invalid_password' });
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

        logActivity(user.id, user.id, 'USER_LOGIN', 'users', user.id, { role: user.role });

        req.session.regenerate((err) => {
            if (err) console.error('Session error:', err);
            req.session.userId = user.id;

            let patientDetails = null;
            if (user.role === 'patient') {
                patientDetails = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(user.id);
            }

            return res.status(200).json({
                message: 'Login successful',
                user: {
                    id: user.id,
                    full_name: user.full_name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    patient: patientDetails
                }
            });
        });

    } catch (err) {
        console.error('[LOGIN ERROR]', err);
        return res.status(500).json({ error: 'An unexpected error occurred during login.' });
    }
});

// POST /api/auth/logout - Logout
router.post('/logout', requireAuth, (req, res) => {
    const userId = req.user.id;
    logActivity(userId, userId, 'USER_LOGOUT', 'users', userId, {});

    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Could not log out.' });
        res.clearCookie('hospital.sid');
        return res.status(200).json({ message: 'Successfully logged out.' });
    });
});

// GET /api/auth/me - Profile
router.get('/me', requireAuth, (req, res) => {
    try {
        let patientProfile = null;
        if (req.user.role === 'patient') {
            patientProfile = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(req.user.id);
        }

        let isDemoPasswordDefault = false;
        if (req.user.role === 'admin' && req.user.email === (process.env.DEMO_ADMIN_EMAIL || 'admin@hospital.local')) {
            const adminUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
            if (adminUser) {
                isDemoPasswordDefault = bcrypt.compareSync(process.env.DEMO_ADMIN_PASSWORD || '123456', adminUser.password_hash);
            }
        }

        return res.status(200).json({
            user: {
                id: req.user.id,
                full_name: req.user.full_name,
                email: req.user.email,
                phone: req.user.phone,
                role: req.user.role,
                patient: patientProfile,
                isDemoPasswordDefault
            }
        });
    } catch (err) {
        console.error('[AUTH ME ERROR]', err);
        return res.status(500).json({ error: 'Failed to retrieve profile data.' });
    }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    try {
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
        const isMatch = bcrypt.compareSync(currentPassword, user.password_hash);

        if (!isMatch) {
            return res.status(400).json({ error: 'Current password is incorrect.' });
        }

        const salt = bcrypt.genSaltSync(10);
        const newHash = bcrypt.hashSync(newPassword, salt);

        db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newHash, req.user.id);

        logActivity(req.user.id, req.user.id, 'CHANGE_PASSWORD', 'users', req.user.id, {});

        return res.status(200).json({ message: 'Password updated successfully.' });
    } catch (err) {
        console.error('[CHANGE PASSWORD ERROR]', err);
        return res.status(500).json({ error: 'Failed to update password.' });
    }
});

module.exports = router;
