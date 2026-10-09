const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();
const { requireAuth } = require('./middleware/auth');

// Initialize Database Connection
const { db } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Security HTTP Headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"]
        }
    }
}));

// Body Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-super-secret-hospital-key-2026',
    resave: false,
    saveUninitialized: false,
    name: 'hospital.sid',
    cookie: {
        httpOnly: true, // Prevent XSS theft
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Root route handler
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Restrict the administrator dashboard page itself, not only its API.
app.get(['/admin-dashboard.html', '/admin-dashboard'], (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.redirect('/login.html');
    }

    return requireAuth(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.redirect('/patient-dashboard.html');
        }
        return next();
    });
}, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html')));

// Serve static assets after protected page routes.
app.use(express.static(path.join(__dirname, 'public')));

// Mount API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/admin', require('./routes/admin'));

// Handle page shortcuts
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'registration.html')));
app.get('/patient-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'patient-dashboard.html')));
app.get('/appointments', (req, res) => res.sendFile(path.join(__dirname, 'public', 'appointments.html')));
app.get('/doctors', (req, res) => res.sendFile(path.join(__dirname, 'public', 'doctors.html')));

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Requested API endpoint not found.' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[UNHANDLED ERROR]', err);
    res.status(500).json({ error: 'Internal server error occurred.' });
});

// Start Server if not loaded as a module in tests or serverless
if (require.main === module && !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`🏥 HOSPITAL MANAGEMENT SYSTEM IS ONLINE`);
        console.log(`📡 URL: http://localhost:${PORT}`);
        console.log(`🔑 Admin account: ${process.env.DEMO_ADMIN_EMAIL || 'admin@hospital.local'}`);
        console.log(`====================================================`);
    });
}

module.exports = app;
