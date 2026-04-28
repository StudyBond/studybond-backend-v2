# Bookmarks Module

## Overview
This module manages user question bookmarks.

Current policy:
- Free users: up to `20` active bookmarks
- Premium users: up to `50` active bookmarks
- Every bookmark expires after `30` days

Expired bookmarks are treated as inactive and do not consume the active bookmark limit.

## Routes
- `POST /api/bookmarks`
- `GET /api/bookmarks`
- `GET /api/bookmarks/:bookmarkId`
- `PATCH /api/bookmarks/:bookmarkId`
- `DELETE /api/bookmarks/:bookmarkId`

All routes require authentication.

## Notes
- Bookmark creation is serialized per user with a row lock so limit checks stay correct under concurrent requests.
- If `examId` is provided, the backend verifies both:
  - the exam belongs to the authenticated user
  - the bookmarked question is actually part of that exam
- Duplicate active bookmarks are rejected.
- Expired bookmarks are cleaned up proactively by a background job and are also ignored immediately by the live read/create flows.
