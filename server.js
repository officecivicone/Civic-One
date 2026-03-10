require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();

// --- 1. DIRECTORY SETUP ---
// This block prevents the "ENOENT: no such file or directory" error by creating the folder at startup
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('Success: Created missing directory at:', uploadDir);
}

// --- 2. MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 3. MULTER CONFIGURATION ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/'); 
  },
  filename: (req, file, cb) => {
    // Generates a unique name: timestamp-originalfilename.jpg
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// --- 4. DATABASE CONNECTION ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

pool.connect((err, client, release) => {
  if (err) {
    return console.error('Database connection error:', err.stack);
  }
  console.log('CivicOne Database connected successfully');
  release();
});

// --- 5. ROUTES ---

// Main Landing Page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CITIZEN API: Report Issue with Image
app.post('/api/report', upload.single('image'), async (req, res) => {
  const { category, description } = req.body;
  // imagePath will be stored as /uploads/filename.jpg in the DB
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const result = await pool.query(
      'INSERT INTO issues (category, description, status, department, image_path) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [category, description, 'Pending', 'Unassigned', imagePath]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Insert Error:", err.message);
    res.status(500).json({ error: 'Database error reporting issue' });
  }
});

// ADMIN API: Fetch all issues
app.get('/api/admin/all-issues', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM issues ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching admin data' });
  }
});

// ADMIN API: Assign Department
app.put('/api/admin/assign', async (req, res) => {
  const { id, department } = req.body;
  try {
    await pool.query('UPDATE issues SET department = $1 WHERE id = $2', [department, id]);
    res.json({ message: "Successfully assigned to department" });
  } catch (err) {
    res.status(500).json({ error: 'Database error during assignment' });
  }
});

// DEPT API: Fetch tasks for specific department
app.get('/api/dept/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const result = await pool.query('SELECT * FROM issues WHERE department = $1 ORDER BY id DESC', [name]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error fetching dept tasks' });
  }
});

// DEPT API: Update status to Resolved
app.put('/api/dept/status', async (req, res) => {
  const { id, status } = req.body;
  try {
    await pool.query('UPDATE issues SET status = $1 WHERE id = $2', [status, id]);
    res.json({ message: "Task status updated" });
  } catch (err) {
    res.status(500).json({ error: 'Database error updating task status' });
  }
} );

// --- 6. SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`CivicOne running at http://localhost:${PORT}`);
});
