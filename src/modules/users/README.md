# Users Module Documentation

## Overview
This module handles everything related to user profile management, including:
- Viewing user profile information
- Updating profile settings
- Viewing user statistics (Study Points (SP), streaks, exam counts)
- Viewing active sessions and registered premium devices in read-only mode
- Changing the current account password safely
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
When a user deletes their account, we:
1. Require the current password.
2. Block self-service deletion for admin or historically privileged accounts.
3. Clean up user-owned collaboration/session records that would otherwise violate current foreign-key rules.
4. Delete the user inside one transaction.

This is built against the current larger backend, not the original smaller schema.

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
  "fullName": "Adedolapo Chibueze",
  "isVerified": true,
  "role": "USER",
  "aspiringCourse": "Medicine",
  "targetScore": 90,
  "isPremium": false,
  "emailUnsubscribed": false,
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-01-20T14:45:00.000Z"
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
  "targetScore": 88,
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
  "aiExplanationsUsedToday": 2,
  "completedExams": 14,
  "abandonedExams": 1,
  "inProgressExams": 0,
  "bookmarkedQuestions": 7,
  "activeSessions": 2,
  "registeredPremiumDevices": 1
}
```

---

### 4. Delete Account
**URL:** `DELETE /api/users/account`  
**Auth:** Required (Bearer Token)

Permanently deletes the authenticated user's account and all associated data.

**Input (Body):**
```json
{
  "password": "CurrentPassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Your account and personal study data were deleted successfully.",
  "deletedAt": "2026-01-28T12:00:00.000Z"
}
```

⚠️ **Warning:** This action is irreversible!

---

### 5. Get Security Overview
**URL:** `GET /api/users/security`  
**Auth:** Required (Bearer Token)

Returns the authenticated user's current active sessions and registered premium devices.

This endpoint is intentionally **read-only**. Users can inspect their security state from settings, but they cannot remove sessions or registered premium devices from this flow.

**Response (200):**
```json
{
  "deviceAccessMode": "PREMIUM",
  "currentSessionId": "6a8d6c89-1f8f-4c8f-a6d2-b2e6f95f0c9c",
  "currentDeviceId": "premium-device-a",
  "activeSessions": [
    {
      "sessionId": "6a8d6c89-1f8f-4c8f-a6d2-b2e6f95f0c9c",
      "deviceId": "premium-device-a",
      "deviceName": "Chrome on Pixel 8",
      "userAgent": "Mozilla/5.0 ...",
      "createdAt": "2026-03-11T08:00:00.000Z",
      "expiresAt": "2026-04-10T08:00:00.000Z",
      "lastLoginAt": "2026-03-11T08:00:00.000Z",
      "isCurrent": true,
      "isRegisteredPremiumDevice": true,
      "registrationMethod": "PREMIUM_FIRST_LOGIN"
    }
  ],
  "registeredPremiumDevices": [
    {
      "deviceId": "premium-device-a",
      "deviceName": "Chrome on Pixel 8",
      "userAgent": "Mozilla/5.0 ...",
      "createdAt": "2026-03-11T08:00:00.000Z",
      "verifiedAt": "2026-03-11T08:01:00.000Z",
      "lastLoginAt": "2026-03-11T08:00:00.000Z",
      "isCurrent": true,
      "isActive": true,
      "registrationMethod": "PREMIUM_FIRST_LOGIN"
    }
  ]
}
```

---

### 6. Change Password
**URL:** `PATCH /api/users/password`  
**Auth:** Required (Bearer Token)

Changes the authenticated user's password.

Behavior:
1. Verifies the current password.
2. Rejects password reuse.
3. Signs out other active sessions while keeping the current session active.
4. Clears any pending password-reset token state.
5. Enforces a daily password change cap.
6. Schedules a delayed security notice email instead of sending multiple immediate alerts if the password is changed repeatedly in a short window.

**Input (Body):**
```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword456!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Your password was changed successfully. Other active sessions were signed out.",
  "changedAt": "2026-03-11T09:30:00.000Z",
  "invalidatedSessions": 2
}
```

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
