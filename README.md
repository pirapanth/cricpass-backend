# CricPass Backend API

Production-ready Node.js & Express REST API using Mongoose for MongoDB Atlas to manage cricket players, teams, inter-team transfers, and administrative oversight.

---

## 🚀 Features

- **Player Management**: Register players with unique NIC validation and assign them to teams. Query players with automatic cooling-off period calculation and eligibility evaluation.
- **Team Management**: Register teams with unique alphanumeric team IDs (`TEAM-001`), team details, and admin contacts.
- **Two-Step Phone Update Flow**: Secure two-step OTP verification to change a team admin's contact number (Old phone OTP verification → New phone OTP verification → Database update).
- **Dual-OTP Transfer Flow**: Secure player transfers between clubs with required authorization from both the current team admin and the receiving team admin.
  - **`ALLOWED` transfers**: Grants a standard **14-day** cooling-off period before the player can compete.
  - **`NOT_ALLOWED` transfers**: Enforces a strict **30-day (1 month)** cooling-off period.
- **Master Admin Dashboard**: Comprehensive system metrics, all teams with player counts, player rosters, and safe deletion cascades.
- **Production Architecture**: Strict schema validations, virtual fields, centralized error handling, and environment isolation.

---

## 📁 Project Structure

```
backend/
├── .env                        # Environment configuration
├── .env.example                # Example environment template
├── package.json                # Project dependencies & scripts
├── server.js                   # Application entry point & DB connection
├── models/
│   ├── Player.js               # Player Mongoose schema with cooling-off virtuals
│   ├── Team.js                 # Team Mongoose schema with unique team_id
│   ├── TransferRequest.js      # Inter-team transfer request schema
│   └── PhoneUpdateSession.js   # State store for multi-step phone update OTPs (TTL indexed)
├── routes/
│   ├── playerRoutes.js         # Player endpoints
│   ├── teamRoutes.js           # Team endpoints
│   ├── transferRoutes.js       # Transfer endpoints
│   └── adminRoutes.js          # Master Admin endpoints
├── controllers/
│   ├── playerController.js     # Player business logic & query calculations
│   ├── teamController.js       # Team registration & two-step phone update logic
│   ├── transferController.js   # Transfer initiation & dual-OTP verification logic
│   └── adminController.js      # System overview & administrative actions
├── middleware/
│   └── errorHandler.js         # Centralized error and 404 handler
└── utils/
    ├── coolingOffCalculator.js  # Business logic for cooling-off days and eligibility
    └── otpGenerator.js          # Secure numeric OTP generator & SMS simulation
```

---

## 🛠️ Installation & Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the `backend` folder:
```env
PORT=5000
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/cricpass?retryWrites=true&w=majority
NODE_ENV=development
```

### 3. Run Server
```bash
# Production mode
npm start

# Development mode with hot-reloading
npm run dev
```

---

## 📡 API Endpoints Reference

### 1. Players (`/api/players`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/players/search/:nic` | Search player by NIC; calculates remaining cooling-off days and team info |
| `POST` | `/api/players/register` | Register new player with unique NIC and optional team assignment |
| `GET` | `/api/players` | List all players (supports `?status=...&team_id=...`) |
| `GET` | `/api/players/:id` | Get player by Mongo ID |

#### `GET /api/players/search/:nic`
Example Response:
```json
{
  "success": true,
  "message": "Player retrieved successfully",
  "data": {
    "_id": "67bc9812a...",
    "full_name": "Wanindu Hasaranga",
    "nic_number": "199707291234",
    "phone_number": "+94771234567",
    "image_url": "https://example.com/avatar.jpg",
    "status": "COOLING_OFF",
    "eligible_to_play_date": "2026-11-08T22:30:00.000Z",
    "remaining_cooling_off_days": 14,
    "is_eligible_to_play": false,
    "current_team": {
      "_id": "67bc9701a...",
      "team_id": "TEAM-002",
      "team_name": "Kandy Warriors",
      "admin_name": "Sara Admin",
      "phone_number": "+94722222222"
    }
  }
}
```

---

### 2. Teams (`/api/teams`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/teams/register` | Create a team with unique `team_id` and admin details |
| `PUT` | `/api/teams/update-phone` | Two-step OTP flow to change team admin phone number |
| `GET` | `/api/teams` | List all teams with active player counts |
| `GET` | `/api/teams/:id` | Get team by ID with player roster |

#### Two-Step OTP Flow for `PUT /api/teams/update-phone`:
- **Step 1 (Initiate)**: Pass `{ "team_id": "TEAM-001", "new_phone_number": "+94799999999" }`. Backend sends OTP to current admin number.
- **Step 2 (Verify Old OTP)**: Pass `{ "team_id": "TEAM-001", "old_phone_otp": "123456" }`. Backend verifies old phone and dispatches OTP to new number.
- **Step 3 (Verify New OTP & Update)**: Pass `{ "team_id": "TEAM-001", "new_phone_otp": "654321" }`. Backend verifies new phone and updates database.

---

### 3. Transfers (`/api/transfers`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/transfers/initiate` | Initiate transfer request; sends OTP to both team admins |
| `POST` | `/api/transfers/verify-otp` | Verify dual-OTPs (Current & New team admins) |
| `GET` | `/api/transfers` | List all transfers |
| `GET` | `/api/transfers/:id` | Get single transfer by ID |

#### Transfer Approval Logic:
- `transfer_type = 'ALLOWED'`: Player transferred, status set to `COOLING_OFF`, `eligible_to_play_date` set to **14 days** from today.
- `transfer_type = 'NOT_ALLOWED'`: Player transferred, status set to `COOLING_OFF`, `eligible_to_play_date` set to **30 days** from today (1 month cooling-off).

---

### 4. Master Admin (`/api/admin`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/overview` | Fetch system metrics, all team admins, and complete player directory |
| `DELETE` | `/api/admin/players/:id` | Delete player and clean up pending transfer requests |
| `DELETE` | `/api/admin/teams/:id` | Delete team and safely unassign associated players |
