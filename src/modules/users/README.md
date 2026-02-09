# Users Module Documentation

## Overview
This module handles everything related to user profile management, including:
- Viewing user profile information
- Updating profile settings
- Viewing user statistics (SP, streaks, exam counts)
- Account deletion with cascade cleanup

It is designed to be **secure** (all endpoints require authentication), **efficient**, and **easy to maintain**.

---

## File Structure & Responsibilities

Each file in this folder has a specific job. Here is what they do:

| File | Purpose |
|------|---------|
| **`users.plugin.ts`** | **The Entry Point.** It tells the main app to load this module and registers the routes with the `/api/users` prefix. |
| **`users.routes.ts`** | **The Map.** It defines the API URLs (like `/api/users/profile`) and specifies which function handles each URL. Also defines response schemas for OpenAPI docs. |
| **`users.controller.ts`** | **The Traffic Cop.** It receives requests from users, extracts the authenticated user ID from JWT, calls the Service to do the work, and sends back the response. |
| **`users.service.ts`** | **The Brain.** This contains the real logic. It talks to the database, formats user data safely, and handles cascading deletions. |
| **`users.schema.ts`** | **The Rules.** It defines input validation and response shapes using Zod. |

---

## Key Features

### 1. Authenticated Access Only
All endpoints require a valid JWT token. The `app.authenticate` preValidation hook:
- Verifies the token
- Extracts the `userId` from the token payload
- Makes it available via `req.user.userId`

### 2. Safe Profile Response
When returning user data, we **exclude sensitive fields**:
- ❌ `passwordHash` - Never exposed
- ❌ `refreshToken` - Security risk
- ✅ `id`, `email`, `fullName`, `role`, etc. - Safe to expose

### 3. Cascading Account Deletion
When a user deletes their account, we clean up **all associated data** in order:
1. AI Explanation Requests
2. Exam Answers
3. Exams
4. Bookmarked Questions
5. User Sessions
6. User Devices
7. Finally, the User record

This uses a Prisma transaction to ensure atomicity.

---

## API Endpoints

### 1. Get Profile
**URL:** `GET /api/users/profile`  
**Auth:** Required (Bearer Token)

Returns the authenticated user's profile information.

**Response (200):**
```json
{
  "id": 1,
  "email": "user@example.com",
  "fullName": "John Doe",
  "isVerified": true,
  "role": "USER",
  "aspiringCourse": "Medicine",
  "targetScore": 350,
  "isPremium": false,
  "emailUnsubscribed": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-20T14:45:00.000Z"
}
```

---

### 2. Update Profile
**URL:** `PATCH /api/users/profile`  
**Auth:** Required (Bearer Token)

Updates the authenticated user's profile. All fields are optional.

**Input (Body):**
```json
{
  "fullName": "Jane Doe",
  "aspiringCourse": "Engineering",
  "targetScore": 380,
  "emailUnsubscribed": true
}
```

**Response (200):** Returns the updated user profile (same shape as Get Profile).

---

### 3. Get Statistics
**URL:** `GET /api/users/stats`  
**Auth:** Required (Bearer Token)

Returns the authenticated user's study statistics.

**Response (200):**
```json
{
  "totalSp": 1250,
  "weeklySp": 350,
  "currentStreak": 5,
  "longestStreak": 12,
  "realExamsCompleted": 8,
  "hasTakenFreeExam": true,
  "aiExplanationsUsedToday": 2
}
```

---

### 4. Delete Account
**URL:** `DELETE /api/users/account`  
**Auth:** Required (Bearer Token)

Permanently deletes the authenticated user's account and all associated data.

**Response (200):**
```json
{
  "success": true,
  "message": "Account deleted successfully",
  "deletedAt": "2024-01-28T12:00:00.000Z"
}
```

⚠️ **Warning:** This action is irreversible!

---

## How to Add New Features

1. **Define the Schema**: Update `users.schema.ts` if you need new input/response fields.
2. **Update the Logic**: Add functions to `users.service.ts`.
3. **Add the Controller**: Add a handler method in `users.controller.ts`.
4. **Add the Route**: Register the new route in `users.routes.ts`.

---

## Testing

Use the Swagger UI at `/api/docs` to test endpoints interactively:
1. Authenticate first via `/api/auth/login`
2. Click "Authorize" and enter your JWT token
3. Test the Users endpoints

Or use cURL:
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:5000/api/users/profile
```
