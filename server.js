const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Import Models
const Admin = require('./models/Admin');

// Import Routes
const playerRoutes = require('./routes/playerRoutes');
const teamRoutes = require('./routes/teamRoutes');
const transferRoutes = require('./routes/transferRoutes');
const adminRoutes = require('./routes/adminRoutes');
const otpRoutes = require('./routes/otpRoutes');
const contactRoutes = require('./routes/contactRoutes');

// Import Middlewares
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// ==========================================
// Middleware Configuration
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Lightweight request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// ==========================================
// Base / Health Check Endpoints
// ==========================================
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to CricPass API Backend',
    version: '1.0.0',
    endpoints: {
      players: '/api/players',
      teams: '/api/teams',
      transfers: '/api/transfers',
      admin: '/api/admin',
      health: '/api/health'
    }
  });
});

app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED';
  res.status(200).json({
    success: true,
    status: 'UP',
    database: dbStatus,
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// Mount Application Routes
// ==========================================
app.use('/api/players', playerRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/contact', contactRoutes);

// ==========================================
// 404 & Global Error Handling
// ==========================================
app.use(notFoundHandler);
app.use(errorHandler);

// ==========================================
// MongoDB Atlas Connection & Server Start
// ==========================================
async function startServer() {
  try {
    if (!MONGO_URI) {
      console.error('CRITICAL: MONGO_URI is not defined in environment variables.');
      process.exit(1);
    }

    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB Atlas connected successfully.');

    // Ensure Master Admin exists in MongoDB Atlas
    await Admin.seedDefaultAdmin();

    const server = app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(` CricPass Server running on port ${PORT}`);
      console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(` API Base URL: http://localhost:${PORT}/api`);
      console.log(`===============================================`);
    });

    // Graceful Shutdown Listeners
    const shutdown = async (signal) => {
      console.log(`\nReceived ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        try {
          await mongoose.connection.close();
          console.log('MongoDB connection closed.');
          process.exit(0);
        } catch (err) {
          console.error('Error during shutdown:', err);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('Failed to connect to MongoDB Atlas:', err.message);
    process.exit(1);
  }
}

// Start application if executed directly
if (require.main === module) {
  startServer();
}

module.exports = app;
