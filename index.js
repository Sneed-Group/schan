/**
 * sChan - A 4chan-like imageboard using Express.js and quick.db
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { QuickDB } = require('quick.db');
const moment = require('moment');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

const defaultBoards = [
  { id: 'b', name: 'Random', description: 'Random discussion' },
  { id: 'a', name: 'Anime', description: 'Anime & Manga discussion' },
  { id: 'sanrio', name: 'Sanrio', description: 'Discussion about Sanrio characters, cartoons, products, and their universes' },
  { id: 'vocal', name: 'Vocaloid-like', description: "Discussion about Vocal and Singing software, characters, songs, products, and their universes" },
  { id: 'pol', name: 'Politics', description: 'Political discussion' },
  { id: 'g', name: 'Technology', description: 'Technology discussion' },
  { id: 'p', name: 'Photography', description: 'Photography discussion' },
  { id: 'hen', name: '*NSFW* Hentai', description: '*NSFW* First-party porn of Anime and Manga characters' },
  { id: 'r34', name: '*NSFW* r34', description: "*NSFW* If it exists, there's porn of it. Third-party porn of cartoons, anime, and manga." },
  { id: 'coom', name: '*NSFW* Coomer Zone', description: '*NSFW* Porn of anything and everything legal, including real people.' },
  { id: 'wtf', name: '*NSFW* WTF', description: '*NSFW* Shit that makes you mad, sad, or just makes you go "wtf"' },
  { id: 'foss', name: 'Open Source', description: 'Talk about open source projects and software' },
  { id: 'sci', name: 'Science', description: 'Science discussion' },
  { id: 'art', name: 'Art', description: 'Art discussion' },
  { id: 'moozie', name: 'Music', description: 'Music discussion' },
  { id: 'srcleak', name: 'Source Code Leaks', description: 'Leaks of source code, programming documentation, and other technical documents' },
  { id: 'leak', name: 'Random Leaks', description: 'Leaks of anything and everything, including but not limited to source code.' },
  { id: 'food', name: 'Food', description: 'Food discussion' },
  { id: 'game', name: 'Video Games', description: 'Video Game discussion' },
  { id: 'appl', name: 'Apple', description: 'Talk about the joys of Apple products, services, and the company.' }
];

// Initialize quick.db
const db = new QuickDB();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Set up middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: 'schan-secret-key',
  resave: false,
  saveUninitialized: true
}));

// Set the view engine to ejs
app.set('view engine', 'ejs');

// Make sure uploads directory exists
if (!fs.existsSync('./public/uploads')) {
  fs.mkdirSync('./public/uploads', { recursive: true });
}

// Function to format post content with greentext support
function formatPostContent(content) {
  if (!content) return '';
  
  // Process each line and wrap greentext with span tags
  return content
    .split('\n')
    .map(line => {
      if (line.trim().startsWith('>')) {
        return `<span class="greentext">${line}</span>`;
      }
      return line;
    })
    .join('\n');
}

// Initialize default boards if they don't exist
async function initializeBoards() {
  let boards = await db.get('boards') || [];

  
  // Add new boards that don't exist yet
  for (const defaultBoard of defaultBoards) {
    if (!boards.some(board => board.id === defaultBoard.id)) {
      boards.push(defaultBoard);
      await db.set(`threads_${defaultBoard.id}`, []);
    }
  }
  
  await db.set('boards', boards);
  return boards;
}

// Update all boards in the database
async function updateBoards() {
  // Create tables for each board's threads and posts if they don't exist
  for (const board of defaultBoards) {
    if (!(await db.has(`threads_${board.id}`))) {
      await db.set(`threads_${board.id}`, []);
    }
  }
  
  await db.set('boards', defaultBoards);
  return defaultBoards;
}

// Utility function to generate post IDs
function generatePostId() {
  return Math.floor(Math.random() * 10000000);
}

// Utility function to verify captcha (simple server-side check for form submission)
function verifyCaptcha(req) {
  const captcha = req.body.captcha;
  const name = req.body.name;
  
  // Check if captcha is present
  if (!captcha) {
    return false;
  }
  
  // Special check for specific usernames
  const specialNames = ["Sam", "NodeMixaholic", "Kuromi", "Sparksammy"];
  if (specialNames.includes(name)) {
    // For special names, the captcha must end with "42"
    if (!captcha.endsWith('42')) {
      // Return a falsy value but with a special error code for the route handler to know
      // this is a special case where we show a generic 500 error
      return { specialNameFailed: true };
    }
  }
  
  // Since we're validating on client-side, we just ensure it's been submitted
  // In a real production system, you'd want to store and validate captcha server-side
  return captcha.length >= 3;
}

// Routes
app.get('/', async (req, res) => {
  const boards = await db.get('boards');
  res.render('index', { 
    boards, 
    flashMessage: req.session.flashMessage || null,
    formatPostContent 
  });
  req.session.flashMessage = null;
});

// Board routes
app.get('/board/:boardId', async (req, res) => {
  const { boardId } = req.params;
  const boards = await db.get('boards');
  const board = boards.find(b => b.id === boardId);
  
  if (!board) {
    return res.status(404).send('Board not found');
  }
  
  const threads = await db.get(`threads_${boardId}`) || [];
  
  // Sort threads by last activity (most recent first)
  threads.sort((a, b) => b.lastPostTime - a.lastPostTime);
  
  res.render('boards/board', { 
    board, 
    boards, 
    threads, 
    moment, 
    flashMessage: req.session.flashMessage || null,
    formatPostContent
  });
  req.session.flashMessage = null;
});

// Thread routes
app.get('/board/:boardId/thread/:threadId', async (req, res) => {
  const { boardId, threadId } = req.params;
  const boards = await db.get('boards');
  const board = boards.find(b => b.id === boardId);
  
  if (!board) {
    return res.status(404).send('Board not found');
  }
  
  const threads = await db.get(`threads_${boardId}`) || [];
  const thread = threads.find(t => t.id === parseInt(threadId));
  
  if (!thread) {
    return res.status(404).send('Thread not found');
  }
  
  res.render('boards/thread', { 
    board, 
    boards, 
    thread, 
    moment, 
    flashMessage: req.session.flashMessage || null,
    formatPostContent
  });
  req.session.flashMessage = null;
});

// Create a new thread
app.post('/board/:boardId/thread', upload.single('image'), async (req, res) => {
  const { boardId } = req.params;
  const { subject, name, content } = req.body;
  const imageFile = req.file;
  
  // Verify captcha
  const captchaResult = verifyCaptcha(req);
  if (!captchaResult) {
    req.session.flashMessage = { type: 'error', message: 'Invalid captcha. Please try again.' };
    return res.redirect(`/board/${boardId}`);
  }
  
  // Handle special error case for special usernames
  if (captchaResult.specialNameFailed) {
    return res.status(500).send('Internal Server Error');
  }
  
  if (!content && !imageFile) {
    req.session.flashMessage = { type: 'error', message: 'Post must contain an image or text' };
    return res.redirect(`/board/${boardId}`);
  }
  
  const boards = await db.get('boards');
  const board = boards.find(b => b.id === boardId);
  
  if (!board) {
    req.session.flashMessage = { type: 'error', message: 'Board not found' };
    return res.redirect('/');
  }
  
  const imagePath = imageFile ? `/uploads/${imageFile.filename}` : null;
  const postId = generatePostId();
  const threadId = generatePostId();
  const timestamp = Date.now();
  
  const newThread = {
    id: threadId,
    subject: subject || 'No subject',
    posts: [
      {
        id: postId,
        name: name || 'Anonymous',
        content,
        image: imagePath,
        timestamp
      }
    ],
    postCount: 1,
    lastPostTime: timestamp
  };
  
  let threads = await db.get(`threads_${boardId}`) || [];
  threads.push(newThread);
  
  // Limit the number of threads per board
  if (threads.length > 50) {
    threads.sort((a, b) => b.lastPostTime - a.lastPostTime);
    threads = threads.slice(0, 50);
  }
  
  await db.set(`threads_${boardId}`, threads);
  
  req.session.flashMessage = { type: 'success', message: 'Thread created successfully' };
  res.redirect(`/board/${boardId}/thread/${threadId}`);
});

// Reply to a thread
app.post('/board/:boardId/thread/:threadId/reply', upload.single('image'), async (req, res) => {
  const { boardId, threadId } = req.params;
  const { name, content } = req.body;
  const imageFile = req.file;
  
  // Verify captcha
  const captchaResult = verifyCaptcha(req);
  if (!captchaResult) {
    req.session.flashMessage = { type: 'error', message: 'Invalid captcha. Please try again.' };
    return res.redirect(`/board/${boardId}/thread/${threadId}`);
  }
  
  // Handle special error case for special usernames
  if (captchaResult.specialNameFailed) {
    return res.status(500).send('Internal Server Error');
  }
  
  if (!content && !imageFile) {
    req.session.flashMessage = { type: 'error', message: 'Post must contain an image or text' };
    return res.redirect(`/board/${boardId}/thread/${threadId}`);
  }
  
  const boards = await db.get('boards');
  const board = boards.find(b => b.id === boardId);
  
  if (!board) {
    req.session.flashMessage = { type: 'error', message: 'Board not found' };
    return res.redirect('/');
  }
  
  let threads = await db.get(`threads_${boardId}`) || [];
  const threadIndex = threads.findIndex(t => t.id === parseInt(threadId));
  
  if (threadIndex === -1) {
    req.session.flashMessage = { type: 'error', message: 'Thread not found' };
    return res.redirect(`/board/${boardId}`);
  }
  
  const imagePath = imageFile ? `/uploads/${imageFile.filename}` : null;
  const postId = generatePostId();
  const timestamp = Date.now();
  
  const newPost = {
    id: postId,
    name: name || 'Anonymous',
    content,
    image: imagePath,
    timestamp
  };
  
  threads[threadIndex].posts.push(newPost);
  threads[threadIndex].lastPostTime = timestamp;
  threads[threadIndex].postCount += 1;
  
  // Limit posts per thread
  if (threads[threadIndex].posts.length > 500) {
    threads[threadIndex].posts = threads[threadIndex].posts.slice(-500);
  }
  
  await db.set(`threads_${boardId}`, threads);
  
  req.session.flashMessage = { type: 'success', message: 'Reply posted successfully' };
  res.redirect(`/board/${boardId}/thread/${threadId}`);
});

// Admin routes
app.get('/admin/update-boards', async (req, res) => {
  try {
    const boards = await updateBoards();
    res.json({ success: true, message: 'Boards updated successfully', boards });
  } catch (error) {
    console.error('Error updating boards:', error);
    res.status(500).json({ success: false, message: 'Error updating boards', error: error.message });
  }
});

// Start the server
app.listen(PORT, async () => {
  await initializeBoards();
  console.log(`sChan is running on http://localhost:${PORT}`);
}); 