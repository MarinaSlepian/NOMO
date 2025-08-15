// auth.js
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET is missing! Check your .env and restart the server.');
  process.exit(1);
}

// 🔐 SIGNUP route
router.post('/signup', async (req, res) => {
  console.log("🔐 SIGNUP route");
  const { username, email, password } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email`,
      [username, email, hash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token });
  } catch (err) {
    console.error('❌ Signup error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔐 LOGIN route
router.post('/login', async (req, res) => {
  console.log("🔐 LOGIN route");
  const { email, password } = req.body;

  try {
    const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log("🕓 Updating last_login for user", user.id);
    await pool.query(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);

    res.json({ token });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Middleware to protect routes
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export default router;
