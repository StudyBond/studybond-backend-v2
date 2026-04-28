# Streaks Module

## Overview
This module owns StudyBond's streak experience.

It provides:
- accurate streak summary state
- streak calendar history
- milestone progress
- streak freezer tracking
- premium streak reminder support
- broken streak reconciliation support

## Routes
- `GET /api/streaks`
- `GET /api/streaks/calendar?days=30`

All routes require authentication.

## Operational Notes
- Day boundaries are computed in Nigeria time (`Africa/Lagos`).
- Streak progress is advanced atomically during exam submission.
- Crossing the 7-day milestone grants one streak freezer that can bridge a single missed day.
- Broken streaks are reconciled in the background so stored counters do not drift forever.
- Premium users can receive reminder emails when they are about to lose an active streak.
- Free users do not get daily streak nags; they receive periodic premium prompts instead.
