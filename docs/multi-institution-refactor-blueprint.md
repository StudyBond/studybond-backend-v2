# StudyBond Multi-Institution Refactor Blueprint

## Purpose
This document defines how StudyBond should evolve from a UI-first backend into a multi-institution platform without cloning modules, duplicating tables per school, or compromising current launch quality.

The immediate launch target remains UI, but the backend should be ready to onboard OAU, UNILAG, and future institutions with controlled schema and service expansion.

## Implementation Status
- Phase 1 foundation is now landed:
  - `Institution`
  - `InstitutionExamConfig`
  - seeded `UI` institution and default `POST_UTME` rule profile
- Phase 2 nullable scope is now landed:
  - nullable `institutionId` on `Question`
  - nullable `institutionId` on `Exam`
  - nullable `institutionId` on `CollaborationSession`
  - nullable `institutionId` on leaderboard snapshot/projection tables
- Phase 3 UI backfill is now landed:
  - all legacy rows in the scoped tables are backfilled to `UI`
  - verification tooling exists to prove no null-scoped residue remains
  - temporary DB-side default-to-`UI` triggers now protect new writes while services are still UI-first
- Phase 4 institution context resolution is now landed for the write-heavy content and exam flows:
  - `User.targetInstitutionId` now exists and is backfilled to `UI`
  - `InstitutionContextService` resolves context by explicit institution, then user target institution, then launch fallback
  - auth registration now assigns new users to the launch institution explicitly
  - question create, update, list, and bulk upload now resolve and persist institution context
  - free-exam pool capacity enforcement is now scoped per `institutionId + subject`
  - exam start, retake, and history now use institution context
  - collaboration session create and start now use institution context and keep generated exams/question sets inside that institution
- Phase 5 rule-profile cutover is now partially landed:
  - `InstitutionExamConfig` is now the runtime source of truth for solo exam default source resolution
  - solo exam duration and total-question calculation now resolve through institution config
  - free full real exam total-attempt enforcement now resolves through institution config
  - premium daily real-exam limit enforcement now resolves through institution config
  - collaboration default source resolution and duration now resolve through institution config
  - collaboration question generation now uses institution-configured `questionsPerSubject`
- Phase 7 institution stats dual-write is now partially landed:
  - `UserInstitutionStats` now exists as an institution-scoped write-side stats model
  - existing exam history is backfilled into `UserInstitutionStats`
  - fallback backfill also protects legacy users with global counters but no exam-derived row yet
  - exam submission now dual-writes scoped SP and completion counters into `UserInstitutionStats`
  - weekly reset now clears institution-scoped `weeklySp` counters alongside the global user counters
- Phase 9 collaboration cutover is now partially landed:
  - collaboration eligibility now resolves against `UserInstitutionStats.realExamsCompleted` for the active institution
  - collaboration create, join, and start now enforce institution-scoped eligibility instead of global `User.realExamsCompleted`
  - explicit institution overrides are now honored safely for collaboration eligibility and question isolation
- Phase 8 leaderboard cutover is now partially landed:
  - weekly leaderboard, all-time leaderboard, and my-rank now resolve institution context explicitly
  - leaderboard reads now use `UserInstitutionStats` instead of global user SP fields
  - leaderboard response cache keys are now institution-scoped
  - weekly leaderboard archival/reset now snapshots per institution
  - projection event payloads are now institution-scoped in code
- Phase 10 user-facing stats and admin analytics cutover is now partially landed:
  - `GET /api/users/stats` now resolves institution context explicitly
  - user stats study counters now read from `UserInstitutionStats`
  - user stats exam and bookmark counts are now institution-scoped
  - admin analytics overview and activity now support explicit institution segmentation
  - admin `user-360` now resolves and returns institution-scoped engagement data
- Runtime behavior is still UI-first for launch, but it is no longer relying only on implicit UI assumptions.
- broader global analytics, premium/security views, and cross-institution rollups still remain intentionally global where that is the correct product behavior.

## Core Principles
1. One platform, many institutions.
2. No separate `exam`, `question`, or `leaderboard` modules per school.
3. No per-school columns like `uiWeeklySp`, `oauWeeklySp`, `unilagWeeklySp`.
4. Institution-specific rules belong in configuration or rule profiles, not hardcoded branches.
5. Question banks, leaderboards, collaboration, and exam stats must be isolated by institution.
6. Existing UI behavior must remain unchanged during the migration until cutover is deliberate.

## Critical Invariants
These rules must stay true after the refactor:

1. UI real questions are not OAU real questions.
2. UI practice questions are not OAU practice questions.
3. UI free-exam questions are not OAU free-exam questions.
4. `MIXED` is an exam selection mode, not a shared cross-school bucket.
5. A `MIXED` exam for UI must only mix UI real questions and UI practice questions.
6. A `MIXED` exam for OAU must only mix OAU real questions and OAU practice questions.
7. Leaderboards must be institution-scoped by default.
8. Collaboration eligibility should be institution-scoped.
9. Admin content and analytics must be institution-aware.

## Current UI-Specific Assumptions
The current backend is structurally single-institution in several places:

- [exams.constants.ts](../src/modules/exams/exams.constants.ts)
  - hardcoded UI subject list
  - hardcoded duration model
  - free-tier assumptions tied to one exam family
- [questions.constants.ts](../src/modules/questions/questions.constants.ts)
  - `REAL_UI` question pool name is UI-specific and will become a footgun
- [question-selector.ts](../src/modules/exams/question-selector.ts)
  - now supports institution-scoped selection
  - still depends on UI-first rule constants instead of institution rule profiles
- [scoring-engine.ts](../src/modules/exams/scoring-engine.ts)
  - updates user-wide counters such as `weeklySp`, `totalSp`, and `realExamsCompleted`
- [leaderboard.service.ts](../src/modules/leaderboard/leaderboard.service.ts)
  - read path is now institution-scoped through `UserInstitutionStats`
  - global user SP totals still exist for compatibility and broader analytics
- [collaboration.service.ts](../src/modules/collaboration/collaboration.service.ts)
  - session creation, eligibility gating, and question selection are now institution-aware
  - naming/session counters are not yet institution-scoped

## Architecture Decision
Use one shared backend with institution-scoped data and rule profiles.

Do not create:
- `UiQuestion`
- `OauQuestion`
- `UnilagQuestion`
- `UiExamService`
- `OauExamService`
- `UnilagExamService`

Instead:
- keep one `Question` model, scoped by institution
- keep one `Exam` model, scoped by institution
- keep one `Leaderboard` system, scoped by institution
- resolve school behavior through institution rule profiles

## Proposed Domain Additions

### 1. Institution
Add a new core model:

- `Institution`
  - `id`
  - `code` (`UI`, `OAU`, `UNILAG`)
  - `name`
  - `slug`
  - `isActive`
  - `createdAt`
  - `updatedAt`

Seed at least:
- `UI`

### 2. Institution Exam Config
Add a model that defines school-specific CBT behavior:

- `InstitutionExamConfig`
  - `id`
  - `institutionId`
  - `mode` (`FULL`, `SUBJECT`, `COLLAB`)
  - `questionsPerSubject`
  - `maxSubjects`
  - `durationSeconds`
  - `defaultQuestionSource`
  - `allowMixedQuestionSource`
  - `freeTierPolicyJson`
  - `collaborationEnabled`
  - `collaborationGateRealExams`
  - `createdAt`
  - `updatedAt`

For UI, this config should mirror current behavior exactly before any broader change.

### 3. User Institution Stats
Add a scoped stats model:

- `UserInstitutionStats`
  - `userId`
  - `institutionId`
  - `weeklySp`
  - `totalSp`
  - `realExamsCompleted`
  - `practiceExamsCompleted`
  - `lastExamAt`
  - `createdAt`
  - `updatedAt`

This becomes the source of truth for:
- institution leaderboards
- institution exam gates
- institution performance views

Optional later:
- keep platform-wide totals on `User` for all-platform analytics

### 4. User Target Institution
Add a user-level preference:

- `User.targetInstitutionId`

This allows the app to know which school the user primarily wants, while still allowing explicit overrides where needed.

## Existing Models To Extend

### Question
Add:

- `institutionId`

Keep:
- `questionPool`
- `questionType`

But rename `REAL_UI` to something generic, such as:
- `REAL_EXAM`

Recommended future question pools:
- `FREE_EXAM`
- `REAL_EXAM`
- `PRACTICE`

Pool meaning must be institution-local.

### Exam
Add:
- `institutionId`
- maybe `examConfigId` if we want immutable linkage to the exact rule profile used

### CollaborationSession
Add:
- `institutionId`
- maybe `examConfigId`

This ensures the collaboration room knows which school’s rules and question bank it belongs to.

### WeeklyLeaderboard / Projection Tables
Add:
- `institutionId`

Any projection, snapshot, or rank table should be institution-scoped.

## Mixed Question Mode
`MIXED` must stay a selection strategy, not a question pool.

Correct behavior:
- UI `MIXED`: pull UI `REAL_EXAM` + UI `PRACTICE`
- OAU `MIXED`: pull OAU `REAL_EXAM` + OAU `PRACTICE`
- UNILAG `MIXED`: pull UNILAG `REAL_EXAM` + UNILAG `PRACTICE`

Forbidden behavior:
- UI `MIXED` pulling OAU practice content
- OAU `MIXED` pulling UI real content

The selector must always filter by:
- `institutionId`
- `questionPool`
- `questionType`
- `subject`

## Admin Impact
Admin must become institution-aware in these surfaces:

- question creation
- question bulk upload
- report moderation
- analytics
- leaderboard operations
- collaboration analytics

Question admin should always specify institution context.
Bulk upload should support an institution-scoped import, not global ingestion.

## Implementation Phases

### Phase 1: Introduce Institution Domain
Goal:
- add the new domain with zero behavior change

Work:
- create `Institution`
- create `InstitutionExamConfig`
- seed `UI`

No service behavior changes yet.

### Phase 2: Add Institution Columns Nullable
Goal:
- prepare existing tables without breaking current flows

Add nullable `institutionId` to:
- `Question`
- `Exam`
- `CollaborationSession`
- leaderboard projection/snapshot tables
- `WeeklyLeaderboard`

Optional:
- `QuestionReport` may not need direct `institutionId` if it can always resolve through `Question`

### Phase 3: Backfill UI
Goal:
- make all current data explicitly UI-scoped

Work:
- backfill every legacy row to `UI`
- verify counts
- verify no null residue
- keep new inserts clean during the transition with temporary DB-side default-to-`UI` triggers on institution-scoped tables

Only after this phase should the columns move toward `NOT NULL`.

### Phase 4: Introduce Institution Context Resolution
Goal:
- stop relying on implicit UI behavior

Create an `InstitutionContextService` that resolves context in this order:
1. explicit request institution
2. user target institution
3. fallback `UI` during migration only

This service becomes the entry point for:
- exam creation
- question selection
- collaboration creation
- leaderboard reads
- admin content flows

Current landed scope:
- `InstitutionContextService` exists
- `User.targetInstitutionId` exists
- question admin and bulk upload use explicit institution resolution
- exam start, retake, and history use institution resolution
- collaboration create and start use institution resolution

Still pending in later phases:
- scoring/stat cutover
- deeper admin analytics segmentation for future institution-specific business metrics

### Phase 5: Rule Profile Cutover
Goal:
- move hardcoded exam rules into institution configuration

Refactor:
- subject validation
- timer calculation
- free-tier rules
- mixed source rules
- collaboration gate rules

Current UI behavior must be represented exactly in config first.

Current landed scope:
- solo exam default source resolution now uses `InstitutionExamConfig`
- solo exam total questions now use `InstitutionExamConfig`
- solo exam timing now uses `InstitutionExamConfig`
- free full real exam attempt limits now use `InstitutionExamConfig`
- premium daily real-exam limits now use `InstitutionExamConfig`
- collaboration default question source now uses `InstitutionExamConfig`
- collaboration timing now uses `InstitutionExamConfig`
- collaboration question generation now uses institution-configured `questionsPerSubject`

Still pending in this phase:
- institution-specific subject validation rules
- final cleanup of legacy UI-first constants that are no longer needed after the later stat/leaderboard cutovers

### Phase 6: Question Bank Isolation
Goal:
- ensure each institution has its own real/practice/free pools

Refactor:
- question create/update
- question bulk upload
- free exam pool capacity checks
- question selection

Free pool cap should become:
- per `institutionId + subject + questionPool`

### Phase 7: Institution Stats Dual Write
Goal:
- prepare for scoped leaderboards without breaking current user stats

Refactor scoring to dual-write:
- existing `User.weeklySp`, `User.totalSp`, `User.realExamsCompleted`
- new `UserInstitutionStats`

Do this before switching leaderboard reads.

Current landed scope:
- `UserInstitutionStats` exists with institution-scoped SP and completion counters
- migration backfills institution stats from existing scoped exams
- fallback backfill seeds rows for legacy users whose counters only existed on `User`
- exam submission now dual-writes institution-scoped stats without changing current public responses
- weekly reset now clears `UserInstitutionStats.weeklySp` so the new weekly counters do not drift

Still pending in this phase:
- expanding more read surfaces onto `UserInstitutionStats` where school-local semantics matter

### Phase 8: Leaderboard Cutover
Goal:
- make leaderboards institution-scoped

Refactor:
- top weekly
- top all-time
- my rank
- weekly reset
- redis projection
- cache keys

All leaderboard reads and writes should use:
- `institutionId`

Recommended cache key pattern:
- `leaderboard:{institutionId}:{type}:top:{limit}`

Current landed scope:
- weekly leaderboard, all-time leaderboard, and my-rank now resolve institution scope explicitly
- leaderboard DB reads now use `UserInstitutionStats`
- leaderboard response cache keys are now institution-scoped
- weekly reset now archives `WeeklyLeaderboard` rows per institution instead of globally

Still pending in this phase:
- Redis-enabled validation of the institution-scoped projection worker path
- any future leaderboard history/read APIs should expose institution scope explicitly

### Phase 9: Collaboration Cutover
Goal:
- make collaboration institution-safe

Refactor:
- create session with institution context
- question source resolution with institution scope
- collaboration gate checks against `UserInstitutionStats`
- name and scope counters include institution in the scope key

Current landed scope:
- collaboration eligibility is institution-scoped for create, join, and start
- explicit institution overrides are enforced against the correct institution stats row
- collaboration question selection remains isolated within the session institution

Still pending in this phase:
- name and scope counters include institution in the scope key
- any future collaboration analytics/read models become institution-scoped by default

### Phase 10: Admin and Analytics
Goal:
- institution-aware control center

Refactor:
- admin question management
- reports queue
- admin analytics
- user 360 exam history
- leaderboard insights

Current landed scope:
- `users/stats` now reads institution-scoped study counters from `UserInstitutionStats`
- `users/stats` now scopes exam and bookmark counts to the resolved institution
- admin analytics overview now supports explicit institution segmentation for content and engagement metrics
- admin analytics activity now supports explicit institution segmentation with live scoped reads
- admin user-360 now resolves institution context against the target user and scopes engagement/recent study data accordingly

Still pending in this phase:
- more granular institution-scoped premium/business reporting where product semantics call for it
- any future institution-aware admin dashboards for reports, moderation, and ops should use the same explicit institution resolution pattern

## Migration Safety Rules
1. No big-bang rewrite.
2. Add nullable columns first.
3. Backfill second.
4. Dual-write stats before read cutover.
5. Keep UI as the default migration institution until explicit multi-school UI is ready.
6. Use feature flags for read cutovers where possible.

## Testing Strategy
Add or expand tests for:

- institution-scoped question selection
- institution-scoped mixed mode
- institution-scoped free exam pool limits
- institution-scoped leaderboard ranking
- institution-scoped collaboration gates
- cross-school isolation
- backfill migration correctness

Must-have regression guarantee:
- UI behavior before the refactor equals UI behavior after the refactor

## Recommended Naming Adjustments
To avoid future semantic debt:
- rename `REAL_UI` -> `REAL_EXAM`

This is the correct abstraction because the pool represents real institution exam content, not a UI-only concept.

## Rollout Recommendation
Implement in this order:
1. schema foundation
2. backfill UI
3. institution context service
4. question-bank isolation
5. rule profile resolution
6. dual-write institution stats
7. leaderboard cutover
8. collaboration cutover
9. admin and analytics cutover

## Final Recommendation
The backend should be built as:
- one platform
- one shared module set
- institution-scoped data
- institution-specific rule profiles
- institution-scoped leaderboards and collaboration

This gives StudyBond clean day-2 expansion without the maintenance disaster of cloning modules per school.
