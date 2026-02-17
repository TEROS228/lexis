import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Serve static files
app.use(express.static(__dirname));

// Route handlers for clean URLs
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/word-list', (req, res) => {
  res.sendFile(path.join(__dirname, 'word-list.html'));
});

app.get('/word-details', (req, res) => {
  res.sendFile(path.join(__dirname, 'word-details.html'));
});

app.get('/learn', (req, res) => {
  res.sendFile(path.join(__dirname, 'learn.html'));
});

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'quiz.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/tiers', (req, res) => {
  res.sendFile(path.join(__dirname, 'tiers.html'));
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Static server running on http://localhost:${port}`);
  console.log(`📄 Clean URLs enabled (no .html extension needed)`);
});
