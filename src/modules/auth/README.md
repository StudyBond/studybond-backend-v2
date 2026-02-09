# Authentication Module Documentation

## Overview
This module handles everything related to user access, including:
- Creating new accounts (Registration)
- Logging in
- Managing security (Passwords, Tokens)
- Verifying devices

It is designed to be **secure**, **fast**, and **easy to maintain**.

---

## 📂 File Structure & Responsibilities

Each file in this folder has a specific job. Here is what they do:

| File | Purpose |
|------|---------|
| **`auth.plugin.ts`** | **The Entry Point.** It tells the main app to load this module, sets up the helper service, and registers the routes. |
| **`auth.routes.ts`** | **The Map.** It defines the API URLs (like `/api/auth/login`) and tells the app which function handles each URL. |
| **`auth.controller.ts`** | **The Traffic Cop.** It receives requests from users, checks if the data is correct (validation), calls the Service to do the work, and sends back the response. |
| **`auth.service.ts`** | **The Brain.** This contains the real logic. It talks to the database, hashes passwords, and generates security tokens. |
| **`auth.types.ts`** | **The Rules.** It defines what data we expect from users (like "email must be a string") using Zod. |

---

## 🔐 Key Features

### 1. Secure Registration
When a user signs up, we don't just save their data. We:
- **Check** if the email is already used.
- **Hash the password** using `bcrypt` (so we never store plain passwords).
- **Create everything at once**: Using a "Database Transaction", we create the User, their first Device, and their first Session all together. If one fails, everything is cancelled.

### 2. Device Verification
We track which devices users use to log in.
- **First Device**: Automatically trusted.
- **New Devices**: We detect them. In the future, we will require email verification (OTP) for unknown devices to prevent hacking.

### 3. JWT Tokens (The "Keys")
We give the user two "keys" when they log in:
- **Access Token (15 mins)**: Short-lived key for doing things immediately.
- **Refresh Token (30 days)**: Long-lived key to get a new Access Token without logging in again.

---

## 🚀 API Endpoints

### 1. Register
**URL:** `POST /api/auth/register`

creates a new user account.

**Input (Body):**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "fullName": "John Doe",
  "aspiringCourse": "Computer Science",
  "targetScore": 300,
  "deviceId": "unique-device-id"
}
```

### 2. Login
**URL:** `POST /api/auth/login`

Logs in an existing user.

**Input (Body):**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "deviceId": "unique-device-id"
}
```

---

## 🛠️ How to Add New Features

1. **Define the Data**: Update `auth.types.ts` if you need new fields.
2. **Update the Logic**: Add functions to `auth.service.ts`.
3. **Add the URL**: Add a new route in `auth.routes.ts` and a handler in `auth.controller.ts`.
