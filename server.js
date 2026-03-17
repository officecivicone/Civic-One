require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;

// --- 1. DIRECTORY SETUP ---
// Ensures the uploads folder exists so images don't fail to save
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) { 
    fs.mkdirSync(uploadDir, { recursive: true }); 
}

// --- 2. MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 3. DATABASE CONNECTION ---
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

// --- 4. MULTER STORAGE CONFIG (For Images) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'public/uploads/'); },
    filename: (req, file, cb) => { 
        cb(null, Date.now() + '-' + file.originalname); 
    }
});
const upload = multer({ storage: storage });

// --- 5. AUTHENTICATION ROUTES ---

// Root Redirect: Fixes "Cannot GET /"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// SIGN UP: Locked to Citizen Role
app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO users (full_name, email, password, role) VALUES ($1, $2, $3, $4)',
            [name, email, password, 'citizen']
        );
        res.status(201).json({ message: "Registration successful" });
    } catch (err) {
        res.status(400).json({ error: "Email already registered in system." });
    }
});

// LOGIN: Universal Gateway
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length > 0 && result.rows[0].password === password) {
            const user = result.rows[0];
            let redirect = 'dashboard.html';
            if (user.role === 'admin') redirect = 'admin.html';
            if (user.role === 'dept') redirect = 'dept.html';

            res.json({ 
                userId: user.id, 
                role: user.role, 
                dept: user.department_name, 
                redirect 
            });
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server error during login" });
    }
});

// --- 6. REPORTING & DASHBOARD ROUTES ---

// SUBMIT REPORT: Fixed for Image Uploads & user_id linkage
app.post('/api/report', upload.single('image'), async (req, res) => {
    const { category, description, userId } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
    try {
        const result = await pool.query(
            'INSERT INTO issues (category, description, status, department, image_path, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [category, description, 'Pending', 'Unassigned', imagePath, userId]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Failed to log report: " + err.message });
    }
});

// DASHBOARD STATS
app.get('/api/stats', async (req, res) => {
    try {
        const total = await pool.query('SELECT count(*) FROM issues');
        const pending = await pool.query("SELECT count(*) FROM issues WHERE status = 'Pending'");
        const resolved = await pool.query("SELECT count(*) FROM issues WHERE status = 'Resolved'");
        res.json({ 
            total: total.rows[0].count, 
            pending: pending.rows[0].count, 
            resolved: resolved.rows[0].count 
        });
    } catch (err) { res.status(500).json({ error: "Stats failure" }); }
});

// USER HISTORY: Linked by user_id
app.get('/api/my-reports', async (req, res) => {
    const { userId } = req.query;
    try {
        const result = await pool.query('SELECT * FROM issues WHERE user_id = $1 ORDER BY id DESC', [userId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "History failure" }); }
});

// --- 7. ADMIN & DEPT OPERATIONS ---

// ADMIN OVERVIEW: Includes submitter's name via JOIN
app.get('/api/admin/all-issues', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, u.full_name 
            FROM issues i 
            LEFT JOIN users u ON i.user_id = u.id 
            ORDER BY i.id DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Admin feed error" }); }
});

// DEPARTMENTAL DASHBOARD: Filtered by department_name
app.get('/api/dept/:name', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM issues WHERE department = $1 ORDER BY id DESC', 
            [req.params.name]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Dept fetch error" }); }
});

// UPDATE STATUS (Dept)
app.put('/api/dept/status', async (req, res) => {
    try {
        await pool.query('UPDATE issues SET status = $1 WHERE id = $2', [req.body.status, req.body.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Status update failed" }); }
});

// DISPATCH PROBLEM (Admin)
app.put('/api/admin/assign', async (req, res) => {
    try {
        await pool.query('UPDATE issues SET department = $1 WHERE id = $2', [req.body.department, req.body.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Dispatch failed" }); }
});

// --- 8. START SERVER ---
app.listen(PORT, () => {
    console.log(`CivicOne Protocol active on http://localhost:${PORT}`);
});