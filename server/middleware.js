'use strict';
const { getAccess } = require('./utils');

const authenticate = async (req, res, next) => {
    try {
        req.tokens = await getAccess(req);
        return next();
    } catch (err) {
        return res.status(401).json({ error: err.message || 'Authentication failed' });
    }
};

module.exports = { authenticate };