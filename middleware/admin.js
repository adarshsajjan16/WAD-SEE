function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Access denied. Administrator privileges required.'
        });
    }
    next();
}

module.exports = { requireAdmin };
