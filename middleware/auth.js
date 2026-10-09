const { db } = require('../database/db');

function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({
            error: 'Authentication required. Please log in.'
        });
    }

    try {
        const user = db.prepare('SELECT id, full_name, email, phone, role, account_status FROM users WHERE id = ?').get(req.session.userId);

        if (!user) {
            req.session.destroy();
            return res.status(401).json({ error: 'User account not found.' });
        }

        if (user.account_status === 'disabled') {
            req.session.destroy();
            return res.status(403).json({ error: 'Your account has been disabled. Please contact the administrator.' });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('[AUTH MIDDLEWARE ERROR]', err);
        return res.status(500).json({ error: 'Internal server error during authentication.' });
    }
}

module.exports = { requireAuth };
