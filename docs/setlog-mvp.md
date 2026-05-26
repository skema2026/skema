# HourRoom MVP Product Spec

HourRoom is an original private friend-group video journal concept inspired by the broad category of timed social capture apps. It does not copy Setlog naming, logo, copy, visual design, or brand system.

## 1. PRD

### Problem
Close friend groups want a low-pressure way to capture the ordinary moments of a day together. Existing short-video products are public-feed or creator-oriented, while private group memories require manual recording, editing, and sharing.

### Goal
Build a mobile-first MVP where users join private rooms, receive timed capture prompts, record 2-3 second real-time clips, see friends' clips in a shared day timeline, and receive an automatically assembled daily group vlog.

### Non Goals
- Public discovery feed
- Algorithmic recommendations
- Beauty filters or heavy editing
- Camera-roll backfilling for missed slots
- E2E encryption in MVP

### Success Metrics
- Room creation completion rate
- Invite acceptance rate
- Clips per member per day
- Daily vlog preview/open rate
- Day-7 room retention

## 2. MVP Feature Spec

### Phase 1
- Auth
- Nickname onboarding
- Optional profile image
- Private room creation/join by invite code
- Camera permission flow
- Real-time-only 2-3 second capture
- Clip upload
- Today timeline

### Phase 2
- Push notifications for each capture slot
- Realtime room updates
- Emoji reactions
- Short comments

### Phase 3
- FFmpeg daily vlog job
- Split-screen composition
- Preview, save, share

### Phase 4
- Calendar archive
- Member management
- Report/block

### Phase 5
- Design polish
- Performance optimization
- App Store/Play Store readiness

## 3. Database Schema

Recommended for this project: FastAPI + PostgreSQL + object storage compatible with signed URLs. If the mobile app moves to Expo/React Native, keep the same API boundary.

### users
- id uuid pk
- email text unique nullable
- phone text unique nullable
- nickname varchar(32) not null
- avatar_object_key text nullable
- birth_year int nullable
- is_deleted boolean default false
- created_at timestamptz
- updated_at timestamptz

Indexes:
- users_email_idx unique(email)
- users_phone_idx unique(phone)

Policy:
- User can read/update own profile.
- Admin/service role can soft-delete accounts.

### log_rooms
- id uuid pk
- owner_id uuid fk users(id)
- name varchar(40) not null
- color varchar(16) not null
- timezone varchar(64) not null
- reset_hour int default 4
- capture_interval_minutes int default 60
- max_members int default 12 check <= 12
- invite_code_hash text not null
- invite_version int default 1
- is_deleted boolean default false
- created_at timestamptz
- updated_at timestamptz

Indexes:
- log_rooms_owner_idx(owner_id)
- log_rooms_invite_hash_idx(invite_code_hash)

Policy:
- Room members can read room.
- Owner can update/delete room and rotate invite.

### room_members
- id uuid pk
- room_id uuid fk log_rooms(id)
- user_id uuid fk users(id)
- role enum(owner, member)
- joined_at timestamptz
- left_at timestamptz nullable

Indexes:
- room_members_room_user_unique unique(room_id, user_id) where left_at is null
- room_members_user_idx(user_id)

Policy:
- Members can read active member list.
- Owner can remove members.
- Member can leave self.

### capture_slots
- id uuid pk
- room_id uuid fk log_rooms(id)
- day_key date not null
- slot_start timestamptz not null
- slot_end timestamptz not null
- status enum(open, closed, composing, completed)
- created_at timestamptz

Indexes:
- capture_slots_room_day_idx(room_id, day_key, slot_start)
- capture_slots_open_idx(status, slot_start)

Policy:
- Members can read slots in their room.
- Service role creates/closes slots.

### clips
- id uuid pk
- room_id uuid fk log_rooms(id)
- slot_id uuid fk capture_slots(id)
- user_id uuid fk users(id)
- object_key text not null
- thumbnail_object_key text nullable
- duration_ms int check between 1500 and 3500
- width int
- height int
- camera_orientation enum(left_hand, right_hand)
- caption varchar(80) nullable
- status enum(uploading, ready, failed, deleted)
- created_at timestamptz
- deleted_at timestamptz nullable

Indexes:
- clips_slot_user_unique unique(slot_id, user_id) where deleted_at is null
- clips_room_day_idx(room_id, created_at)
- clips_user_idx(user_id)

Policy:
- Members can read ready clips in their room.
- User can delete own clip.
- Upload must match current open slot.

### clip_reactions
- id uuid pk
- clip_id uuid fk clips(id)
- user_id uuid fk users(id)
- emoji varchar(16)
- created_at timestamptz

Indexes:
- clip_reactions_unique unique(clip_id, user_id, emoji)

Policy:
- Room members can create/delete own reactions.

### clip_comments
- id uuid pk
- clip_id uuid fk clips(id)
- user_id uuid fk users(id)
- body varchar(140)
- created_at timestamptz
- deleted_at timestamptz nullable

Indexes:
- clip_comments_clip_idx(clip_id, created_at)

Policy:
- Room members can read comments.
- Author can delete own comment.

### daily_vlogs
- id uuid pk
- room_id uuid fk log_rooms(id)
- day_key date not null
- output_object_key text nullable
- status enum(queued, processing, ready, failed)
- duration_ms int nullable
- error_message text nullable
- created_at timestamptz
- completed_at timestamptz nullable

Indexes:
- daily_vlogs_room_day_unique unique(room_id, day_key)
- daily_vlogs_status_idx(status)

Policy:
- Room members can read ready vlogs.
- Service role writes output.

### reports
- id uuid pk
- reporter_id uuid fk users(id)
- reported_user_id uuid fk users(id) nullable
- room_id uuid fk log_rooms(id) nullable
- clip_id uuid fk clips(id) nullable
- reason enum(spam, harassment, unsafe, privacy, other)
- detail text nullable
- status enum(open, reviewing, resolved, dismissed)
- created_at timestamptz

Policy:
- User can create report.
- Admin can read/update reports.

### blocks
- id uuid pk
- blocker_id uuid fk users(id)
- blocked_user_id uuid fk users(id)
- created_at timestamptz

Indexes:
- blocks_unique unique(blocker_id, blocked_user_id)

Policy:
- User can manage own block list.

## 4. API Spec

### Auth/Profile
- `GET /me`
- `PATCH /me`
- `DELETE /me`

### Rooms
- `POST /log-rooms`
- `GET /log-rooms`
- `GET /log-rooms/{room_id}`
- `PATCH /log-rooms/{room_id}`
- `DELETE /log-rooms/{room_id}`
- `POST /log-rooms/{room_id}/invite/rotate`
- `POST /log-rooms/join`
- `POST /log-rooms/{room_id}/leave`
- `DELETE /log-rooms/{room_id}/members/{user_id}`

### Slots/Clips
- `GET /log-rooms/{room_id}/today`
- `POST /capture-slots/{slot_id}/clips/upload-url`
- `POST /capture-slots/{slot_id}/clips/complete`
- `DELETE /clips/{clip_id}`
- `POST /clips/{clip_id}/reactions`
- `DELETE /clips/{clip_id}/reactions/{reaction_id}`
- `POST /clips/{clip_id}/comments`
- `DELETE /clips/{clip_id}/comments/{comment_id}`

### Vlogs/Archive
- `GET /log-rooms/{room_id}/vlogs/{day_key}`
- `POST /log-rooms/{room_id}/vlogs/{day_key}/compose`
- `GET /log-rooms/{room_id}/archive?month=YYYY-MM`

### Safety
- `POST /reports`
- `POST /blocks`
- `DELETE /blocks/{blocked_user_id}`

## 5. React Native Screen and Component Structure

```text
src/
  app/
    AppNavigator.tsx
    AuthNavigator.tsx
    RoomNavigator.tsx
  screens/
    OnboardingScreen.tsx
    HomeScreen.tsx
    CreateGroupScreen.tsx
    JoinGroupScreen.tsx
    GroupTodayScreen.tsx
    CameraCaptureScreen.tsx
    ClipDetailScreen.tsx
    DailyVlogPreviewScreen.tsx
    CalendarArchiveScreen.tsx
    SettingsScreen.tsx
    PrivacyAndSafetyScreen.tsx
  components/
    RoomCard.tsx
    SlotTimeline.tsx
    SplitClipGrid.tsx
    CapturePrompt.tsx
    ReactionBar.tsx
    CommentSheet.tsx
    VlogPlayer.tsx
    InviteCodeCard.tsx
  services/
    api.ts
    upload.ts
    push.ts
    camera.ts
    realtime.ts
  state/
    authStore.ts
    roomStore.ts
```

Recommended stack:
- Expo React Native for app delivery
- Expo Camera or react-native-vision-camera
- Expo Notifications or FCM/APNs native path
- FastAPI API, PostgreSQL, Redis queue
- S3-compatible object storage with signed URLs
- FFmpeg worker container for composition

## 6. Upload and FFmpeg Composition

Upload flow:
1. App requests upload URL for current open slot.
2. Server verifies membership and slot window.
3. App records exactly 2-3 seconds in camera screen.
4. App uploads to signed PUT URL.
5. App calls complete endpoint with metadata.
6. Worker generates thumbnail.

Composition flow:
1. At room reset boundary, enqueue daily vlog job.
2. Worker downloads clips through internal signed URLs.
3. For each slot, create a split-screen canvas matching active member count.
4. Fill missing clips with blurred placeholder tile.
5. Overlay member name, time label, date.
6. Concatenate slot scenes in chronological order.
7. Upload final MP4 and poster image.
8. Mark daily_vlogs row ready.

FFmpeg notes:
- Normalize input to 1280x720, 30fps, H.264/AAC.
- Keep MVP output under 90 seconds when possible.
- Use server-side queue retries and idempotent output keys.

## 7. Push Notification Design

Notification types:
- capture_slot_open
- capture_slot_closing_soon
- friend_uploaded_clip
- daily_vlog_ready
- invite_joined

Rules:
- Slot prompt at every room interval.
- Do not send missed-slot backfill prompts.
- Deep link notification to `CameraCaptureScreen(roomId, slotId)`.
- Quiet hours can follow room reset settings later.

## 8. Security and RLS Policy

Minimum MVP security:
- HTTPS only
- Signed URL storage access
- Server-side authorization for every room resource
- Storage object keys never exposed as public permanent URLs
- Row-level policies based on active membership
- Owner-only destructive room/member actions
- Self-only clip/account deletion
- Invite code stored hashed
- Rate-limit invite join attempts
- Report/block pipeline
- 13+ age gate and Terms/Privacy pages

Future:
- E2E encryption for clips and vlogs
- Device integrity checks
- Advanced moderation

## 9. Implementation Checklist

### Phase 1
- [ ] Add mobile app shell
- [ ] Auth and profile onboarding
- [ ] Create/join room APIs
- [ ] Member list and invite code
- [ ] Current slot calculation
- [ ] Camera capture screen
- [ ] Signed upload flow
- [ ] Today timeline

### Phase 2
- [ ] Realtime channel per room/day
- [ ] Emoji reactions
- [ ] Comments
- [ ] FCM/APNs push registration
- [ ] Capture slot notification scheduler

### Phase 3
- [ ] FFmpeg worker image
- [ ] Vlog queue table/job
- [ ] Composition template
- [ ] Preview player
- [ ] Save/share action

### Phase 4
- [ ] Calendar archive
- [ ] Owner member moderation
- [ ] Report/block UI
- [ ] Account deletion

### Phase 5
- [ ] Performance profiling
- [ ] Upload retry/resume
- [ ] Design polish
- [ ] App Store/Play Store prep

