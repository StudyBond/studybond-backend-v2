# Authentication Module Documentation

## Overview
This module now separates three concerns that were previously mixed together:

1. Email verification for account activation.
2. Premium device registration and approval.
3. Password recovery with reset OTP.
4. Session lifecycle and invalidation policy.

That split keeps the auth flow predictable under premium/free transitions and prevents OTP state collisions.

## Current Access Policy

### Free users
- Can sign in on unlimited devices and keep multiple active sessions.
- Do not enter the premium device registry.
- Still use email OTP during registration.

### Premium users
- Premium access is reconciled against `User.isPremium` and `User.deviceAccessMode`.
- The first login after premium activation is auto-trusted and becomes the first registered premium device.
- The second distinct premium device requires a 6-digit email OTP.
- Only two registered premium devices are allowed per premium cycle.
- Only one premium session stays active at a time. A fresh premium login invalidates the previous active premium session.

### Premium to free downgrade
- Device registry is cleared.
- The account returns to free multi-session behavior.
- Future premium activation starts from a clean device slate again.

## Data Flow

### Registration
- `POST /api/auth/signup`
- Creates the user and stores an email verification OTP on the user record.
- Does not create a `UserDevice`.

### OTP verification
- `POST /api/auth/verify-otp`
- If the user is not yet verified, the OTP is treated as an email verification OTP.
- If the user is already verified and premium sign-in is pending, the OTP is treated as a device registration OTP.
- Password reset does not use this endpoint. Recovery has its own dedicated flow.

### Forgot password
- `POST /api/auth/forgot-password`
- Accepts only an email address.
- Always returns the same generic message to avoid account enumeration.
- If the account exists and is eligible, the backend stores a hashed reset OTP and emails it through the transactional mail service.
- Abuse controls:
  - per-account reset email cap
  - per-IP reset request cap
  - reset OTP expires quickly
  - repeated wrong OTP attempts invalidate the current reset challenge
- If a reset code was just issued, the backend will not immediately issue another one. This prevents email spam and abuse.

### Resend password reset OTP
- `POST /api/auth/resend-reset-otp`
- Accepts only an email address.
- Also returns a generic message.
- Only rotates and resends the OTP if there is an existing pending reset challenge and the cooldown window has passed.
- If the user asks too soon, the backend no-ops and keeps the current reset challenge unchanged.

### Reset password
- `POST /api/auth/reset-password`
- Accepts `email`, `otp`, `newPassword`, and `confirmNewPassword`.
- Verifies the reset OTP against the hashed stored value.
- Updates the password hash.
- Clears the reset OTP state.
- Invalidates every active session for the account.
- Marks all devices inactive, but keeps trusted premium devices registered for future login.
- Does not auto-login the user after reset. The user must sign in again, which keeps premium device policy intact.
- If too many wrong reset codes are entered, the current reset challenge is invalidated and the user must request a fresh code.

### Login
- `POST /api/auth/login`
- Free login creates a session immediately.
- Premium login requires device fingerprint context.
- Premium login either:
  - auto-trusts the first device,
  - allows an already verified device, or
  - sends OTP for the second device.

## Device Identity
- Legacy `deviceId` and `deviceName` are still accepted.
- Preferred input is the structured `device` payload.
- The backend stores:
  - canonical device key,
  - fingerprint hash,
  - normalized device metadata,
  - latest IP and user agent.

This is stronger than a raw device ID and gives the backend a better chance of recognizing the same device later.

## Password Security Boundaries

### Logged-in password change
- `PATCH /api/users/password`
- Requires the current password.
- Keeps the current session active and signs out other active sessions.
- Does not use email OTP.
- Is limited to a small number of changes per day.
- Triggers a delayed password-change security email so multiple quick changes do not spam the user.

### Forgot-password recovery
- `POST /api/auth/forgot-password`
- `POST /api/auth/resend-reset-otp`
- `POST /api/auth/reset-password`
- Uses email OTP because the user is not authenticated.
- Signs out every active session after a successful reset.
