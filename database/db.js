const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Vercel Serverless environment path resolution
const isServerless = process.env.VERCEL || process.env.AWS_EXECUTION_ENV || process.env.NODE_ENV === 'production';
let dbPath;

if (isServerless) {
    const tmpDir = '/tmp';
    dbPath = path.join(tmpDir, process.env.DB_FILE || 'hospital.db');
    const rootDbPath = path.resolve(__dirname, '..', process.env.DB_FILE || 'hospital.db');
    
    // Copy existing root database to /tmp if it exists and /tmp doesn't have it yet
    if (!fs.existsSync(dbPath) && fs.existsSync(rootDbPath)) {
        try {
            fs.copyFileSync(rootDbPath, dbPath);
        } catch (e) {
            console.error('[VERCEL DB INIT] Copy error:', e);
        }
    }
} else {
    dbPath = path.resolve(__dirname, '..', process.env.DB_FILE || 'hospital.db');
}

const db = new DatabaseSync(dbPath);

// Enable Foreign Keys PRAGMA
db.exec('PRAGMA foreign_keys = ON;');

// Initialize database schema
function initDatabase() {
    const schemaPath = path.resolve(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
    seedDemoAdmin();
    seedInitialDoctors();
}

// Seed Demo Administrator Account
function seedDemoAdmin() {
    const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'admin@hospital.local';
    const adminPass = process.env.DEMO_ADMIN_PASSWORD || '123456';

    const existingAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);
    if (!existingAdmin) {
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(adminPass, salt);

        const stmt = db.prepare(`
            INSERT INTO users (full_name, email, phone, password_hash, role, account_status)
            VALUES (?, ?, ?, ?, 'admin', 'active')
        `);
        const result = stmt.run('System Administrator', adminEmail, '+1-800-555-0199', passwordHash);

        // Log initial creation
        logActivity(result.lastInsertRowid, null, 'SYSTEM_INIT', 'users', result.lastInsertRowid, {
            note: 'Seeded default demo administrator account'
        });

        console.log(`[DB INIT] Created demo admin account: ${adminEmail}`);
    }
}

// Seed sample doctors if none exist
function seedInitialDoctors() {
    const count = db.prepare('SELECT COUNT(*) as count FROM doctors').get().count;
    if (count === 0) {
        const sampleDoctors = [
            {
                full_name: 'Dr. Sarah Jenkins',
                specialization: 'Cardiology',
                department: 'Cardiovascular Care',
                available_days: JSON.stringify(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']),
                consultation_start: '09:00',
                consultation_end: '17:00',
                slot_duration_minutes: 30
            },
            {
                full_name: 'Dr. Robert Chen',
                specialization: 'Orthopedics',
                department: 'Bone & Joint Center',
                available_days: JSON.stringify(['Monday', 'Wednesday', 'Friday']),
                consultation_start: '10:00',
                consultation_end: '16:00',
                slot_duration_minutes: 30
            },
            {
                full_name: 'Dr. Emily Taylor',
                specialization: 'Pediatrics',
                department: 'Children Health',
                available_days: JSON.stringify(['Monday', 'Tuesday', 'Thursday', 'Saturday']),
                consultation_start: '08:30',
                consultation_end: '15:30',
                slot_duration_minutes: 30
            }
        ];

        const insertStmt = db.prepare(`
            INSERT INTO doctors (full_name, specialization, department, available_days, consultation_start, consultation_end, slot_duration_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        sampleDoctors.forEach(doc => {
            insertStmt.run(
                doc.full_name,
                doc.specialization,
                doc.department,
                doc.available_days,
                doc.consultation_start,
                doc.consultation_end,
                doc.slot_duration_minutes
            );
        });

        console.log('[DB INIT] Seeded 3 default medical specialists.');
    }
}

// Helper to record activity audit logs safely
function logActivity(actorUserId, targetUserId, action, entityType, entityId, metadata = {}) {
    try {
        const safeMetadata = { ...metadata };
        delete safeMetadata.password;
        delete safeMetadata.password_hash;
        delete safeMetadata.token;
        delete safeMetadata.session;

        const stmt = db.prepare(`
            INSERT INTO activity_logs (actor_user_id, target_user_id, action, entity_type, entity_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            actorUserId || null,
            targetUserId || null,
            action,
            entityType,
            entityId || null,
            JSON.stringify(safeMetadata)
        );
    } catch (err) {
        console.error('[ACTIVITY LOG ERROR]', err.message);
    }
}

// Helper to generate next unique patient number
function generatePatientNumber() {
    const lastPatient = db.prepare('SELECT id FROM patients ORDER BY id DESC LIMIT 1').get();
    const nextId = (lastPatient ? lastPatient.id : 0) + 1;
    return `PAT-${String(nextId + 10000).padStart(5, '0')}`;
}

// Execute initial db setup
initDatabase();

module.exports = {
    db,
    logActivity,
    generatePatientNumber
};
