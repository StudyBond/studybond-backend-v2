# Reports Module

## Purpose
The reports module lets users flag broken or suspicious questions and gives the admin team a clean moderation queue to review, resolve, and, when absolutely necessary, purge invalid reports.

This module is designed around two principles:

1. Users can safely report question issues without needing support intervention.
2. Admin moderation stays auditable and controlled.

## User Capabilities
- Create a report for a question.
- View their own reports.
- View one of their own reports by ID.
- Delete their own report only while it is still `PENDING`.

## Admin Capabilities
- View the moderation queue at `GET /api/admin/reports`.
- Filter by status, issue type, subject, question, or reporting user.
- Mark reports as `REVIEWED` or `RESOLVED`.
- Add an admin note when moderating.

## Superadmin Capability
- Hard delete a report through `DELETE /api/admin/reports/:reportId/hard-delete`.

Hard delete is intentionally restricted to `SUPERADMIN` because it permanently removes a moderation record. Regular admins should resolve reports, not erase them.

## Business Rules
- A user can only create one report per `question + issueType`.
- Duplicate prevention is enforced at both the service layer and the database layer.
- `OTHER` issue type requires a description.
- Reports move through this lifecycle:
  - `PENDING`
  - `REVIEWED`
  - `RESOLVED`
- Once a report is `RESOLVED`, it cannot be re-opened through this module.
- Users cannot delete reviewed or resolved reports.

## Why We Persist Reports
Unlike realtime collaboration notifications, reports are not ephemeral. They are operational signals that affect:

- question quality
- learner trust
- admin workload
- auditability

That makes persistence correct here.

## Auditing
Admin moderation actions are written to `AdminAuditLog` with `targetType=REPORT`.

Current report-related audit actions:
- `REPORT_REVIEWED`
- `REPORT_RESOLVED`
- `REPORT_HARD_DELETED`

## Main Endpoints

### User
- `POST /api/reports`
- `GET /api/reports`
- `GET /api/reports/:reportId`
- `DELETE /api/reports/:reportId`

### Admin
- `GET /api/admin/reports`
- `GET /api/admin/reports/:reportId`
- `PATCH /api/admin/reports/:reportId/status`

### Superadmin
- `DELETE /api/admin/reports/:reportId/hard-delete`

## Data Model Notes
`QuestionReport` stores:
- reporting user
- question
- issue type
- optional user description
- moderation status
- admin note
- review metadata
- resolution metadata

Important indexes and constraints:
- unique `(userId, questionId, issueType)`
- queue-oriented indexes for status and creation time
- reviewer/resolver indexes for moderation visibility

## Validation Notes
- Report IDs are positive integers.
- Admin note is mandatory when reviewing or resolving.
- Hard delete requires a reason.

## Testing
The reports module is covered by:
- `src/tests/e2e/reports.e2e.test.ts`

That suite verifies:
- user create/list/get/delete flow
- duplicate report protection
- admin review/resolve flow
- superadmin-only hard delete
