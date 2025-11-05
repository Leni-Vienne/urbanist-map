# Replacement Overlay Approval Workflow - Design Document

## Overview

When a moderator approves a replacement overlay (Overlay B that replaces Overlay A), there are several critical scenarios to handle, particularly when the original overlay (A) has pending change requests from users. This document outlines the complete workflow, edge cases, and implementation decisions.

## Current State

### What Already Exists ✅

1. **Database Schema:**
   - `overlays.replacesOverlayId` - UUID field pointing to the overlay being replaced (set by user during upload)
   - `overlays.version` - Integer for optimistic locking during moderation
   - `changeRequests.status` - Enum including 'pending', 'approved', 'rejected', 'conflicted'

2. **Frontend "View Original" Button:**
   - Located in `OverlayPopup.vue` (lines 85-95)
   - Shows when `overlayObject.replacesOverlayId` exists
   - Uses `navigateToOverlay()` to display the original overlay
   - **Only works while replacement is pending** (before approval)
   - After approval, images are cleaned up and button shows "Image no longer available"

3. **Two-Phase Image Storage:**
   - Upload: Images stored locally in `./uploads/`, thumbnails in `./uploads/thumbnails/`
   - Moderation: Moderators review using local files
   - Approval: Images migrated to R2, local files deleted (regular overlays)
   - Rejection: Local files deleted

## Required Changes

### Database Changes

1. **Add 'replaced' status to approval_status enum:**
   ```sql
   ALTER TYPE approval_status ADD VALUE 'replaced';
   ```
   - Used for overlays that have been superseded by a replacement
   - Different from 'rejected' (which means moderator declined it)
   - Migration will be created but executed manually

2. **Add `replacedByOverlayId` field to overlays table:**
   ```sql
   ALTER TABLE overlays ADD COLUMN replaced_by_overlay_id UUID REFERENCES overlays(id);
   ```
   - Reverse reference: points from original to replacement
   - Set by moderator during approval (not by user during upload)
   - Useful for audit trail and "view replacement" functionality

3. **Add index on `replacesOverlayId` for performance:**
   ```sql
   CREATE INDEX idx_overlays_replaces ON overlays(replaces_overlay_id) WHERE replaces_overlay_id IS NOT NULL;
   ```
   - Needed to quickly find competing replacement overlays

## Core Workflow: Approving a Replacement Overlay

### Step 1: Detection
When moderator clicks "Approve" on Overlay B where `B.replacesOverlayId = A`:

1. Query for original overlay A
2. Check A's current status:
   - If A is NOT 'approved', this is an error (should not happen - validation issue)
   - If A is 'approved', proceed
3. Query pending change requests on A:
   ```sql
   SELECT * FROM change_requests
   WHERE entity_type = 'overlay'
   AND entity_id = A
   AND status = 'pending'
   ```

### Step 2: Confirmation Dialog (if pending changes exist)

**Show dialog with:**
- Title: "Replacing Approved Overlay"
- Message: "This replacement will replace a live overlay and mark {count} pending change request(s) as conflicted."
- List of pending changes:
  - Field being changed
  - Submitter name
  - Old → New value
  - Submission date
- Actions: "Continue" / "Cancel"
- Scrollable list if more than ~10 changes

**If no pending changes exist:**
- No confirmation needed
- Proceed directly to approval

### Step 3: Atomic Approval Transaction

**Using version locking to prevent race conditions:**

```typescript
await db.transaction(async (tx) => {
  // 1. Lock and verify original overlay hasn't changed
  const currentOriginal = await tx.query.overlays.findFirst({
    where: eq(overlays.id, A.id),
    // PostgreSQL: FOR UPDATE locks the row
  });

  if (currentOriginal.version !== expectedVersion) {
    throw new Error('Overlay was modified during approval. Refresh and try again.');
  }

  if (currentOriginal.approvalStatus !== 'approved') {
    throw new Error('Overlay is no longer approved. Cannot replace it.');
  }

  // 2. Find and handle competing replacements (see Edge Cases section)
  const competingReplacements = await tx.query.overlays.findMany({
    where: and(
      eq(overlays.replacesOverlayId, A.id),
      eq(overlays.approvalStatus, 'pending'),
      ne(overlays.id, B.id)
    )
  });

  // If competing replacements exist, show warning and auto-reject them
  // (handled in frontend before transaction starts)

  // 3. Approve replacement overlay B
  await tx.update(overlays)
    .set({ approvalStatus: 'approved', version: sql`${overlays.version} + 1` })
    .where(eq(overlays.id, B.id));

  // 4. Mark original overlay A as 'replaced'
  await tx.update(overlays)
    .set({
      approvalStatus: 'replaced',
      replacedByOverlayId: B.id,
      version: sql`${overlays.version} + 1`
    })
    .where(eq(overlays.id, A.id));

  // 5. Mark all pending change requests on A as 'conflicted'
  await tx.update(changeRequests)
    .set({
      status: 'conflicted',
      resolvedAt: new Date(),
      resolvedBy: moderatorId,
      // Store reason in changeReason or new field
    })
    .where(and(
      eq(changeRequests.entityType, 'overlay'),
      eq(changeRequests.entityId, A.id),
      eq(changeRequests.status, 'pending')
    ));

  // 6. Migrate B's images to R2 (standard approval process)
  // This happens outside transaction (see Image Cleanup section)

  // 7. Schedule A's image cleanup for 15 days
  await scheduleImageCleanup(A.id, A.filename, daysFromNow(15));
});
```

**Important:** Only pending change requests become 'conflicted'. Already-approved or already-rejected change requests remain unchanged (historical record).

## Edge Cases & Solutions

### Edge Case 1: Replacement Chains

**Scenario:**
- Overlay A is approved
- User uploads B to replace A → B gets approved → B is now approved
- Another user uploads C to replace B → C gets approved → C is now approved
- Chain continues: A → B → C → D...

**Decision:** Chains are allowed, no tracking beyond immediate predecessor.
- Each overlay only knows its immediate predecessor via `replacesOverlayId`
- No need to track full chain history
- Old overlays get cleaned up after 15 days anyway

**No special handling required** - the workflow naturally supports this.

### Edge Case 2: Multiple Concurrent Replacement Submissions

**Scenario:**
- Overlay A is approved and live
- User X uploads Overlay B (`replacesOverlayId = A`, status = 'pending')
- User Y uploads Overlay C (`replacesOverlayId = A`, status = 'pending')
- User Z uploads Overlay D (`replacesOverlayId = A`, status = 'pending')
- All three are in moderation queue

**Solution:** When moderator approves B, show dialog:

**Competing Replacements Dialog:**
- Title: "Multiple Replacement Submissions"
- Message: "There are 2 other pending overlays trying to replace the same original. Approving this one will automatically reject them."
- List competing overlays:
  - Thumbnail preview
  - Caption
  - Uploader name
  - Submission date
- Actions: "Approve and Reject Others" / "Cancel"

**On confirm:**
- Approve B as normal
- Auto-reject C and D:
  ```typescript
  await tx.update(overlays)
    .set({
      approvalStatus: 'rejected',
      version: sql`${overlays.version} + 1`
    })
    .where(inArray(overlays.id, [C.id, D.id]));
  ```
- Delete full-size images of C and D immediately
- Keep thumbnails of C and D for 15 days (see Image Cleanup section)

### Edge Case 3: Race Condition - Simultaneous Approvals

**Scenario:**
- Overlay B (replacement for A) is in queue
- Change Request X (change to A) is in queue
- Moderator M1 starts approving B (transaction begins)
- Moderator M2 starts approving Change Request X (transaction begins)

**Solution:** PostgreSQL row-level locking with `FOR UPDATE`

When approving B:
```sql
SELECT * FROM overlays WHERE id = A FOR UPDATE;
```
This locks the row. If M2 already has the lock, M1 waits. If M1 has the lock, M2 waits.

After lock acquired, check version number:
- If version changed, abort with error: "Overlay modified, please refresh"
- User must refresh moderation panel and retry

**Also check A's status:**
- If A is already 'replaced', abort with error: "Overlay already replaced by another submission"

### Edge Case 4: Valid Change Requests Becoming Conflicted

**Scenario:**
- Overlay A has caption "Construction site" (wrong)
- User Y submits change request: caption → "Residential Building" (correct)
- User X uploads Overlay B (replacement) with caption still "Construction site" (same error)
- Moderator approves B
- Y's valid change request becomes 'conflicted'

**Decision:** Accept this limitation (Option 1 from discussion).
- Change request is marked 'conflicted'
- User Y must re-submit for Overlay B
- **Future improvement:** Add "Submit similar change for replacement" button that pre-fills form

**Why not auto-transfer changes?**
- The replacement overlay might be completely different (different angle, different image)
- The field values might have changed in ways that make the change request invalid
- Safest to let users re-evaluate and re-submit

### Edge Case 5: Cross-Project Replacements

**Decision:** Allowed - replacement overlay CAN belong to a different project.

**Use case:** User realizes the overlay should belong to a different project.
- Overlay A belongs to Project "Downtown Construction"
- Replacement Overlay B belongs to Project "Midtown Construction"
- This effectively "moves" the overlay to a new project

**No validation or warning needed** - this is intentional behavior.

The user has access to ProjectPicker component during replacement upload to choose or create a new project.

## Image Cleanup Policies

### Regular Overlays (Not Replacements)

**On Approval:**
- Full image: Local → R2, then delete local ✅
- Thumbnail: Local → R2, then delete local ✅

**On Rejection:**
- Full image: Delete immediately ✅
- Thumbnail: Delete immediately ✅

### Replacement Overlays (Special Handling)

**When Approving Replacement B (that replaces A):**

**For B (the new overlay):**
- Full image: Local → R2, then delete local (standard approval)
- Thumbnail: Local → R2, then delete local (standard approval)

**For A (the replaced overlay):**
- Full image on R2: Schedule deletion for 15 days
- Thumbnail on R2: Schedule deletion for 15 days
- Status: Set to 'replaced'

**When Rejecting Replacement B:**
- Full image (local): Delete immediately
- Thumbnail (local): Keep for 15 days (then delete)
- Reason: Moderators might want to review multiple submissions for comparison

**When User Deletes Pending Overlay:**
- Full image (local): Delete immediately
- Thumbnail (local): Delete immediately
- Both files cleaned up since user is removing their own content

### Cleanup Implementation Strategy

**Option A: Background Job**
Create a `scheduled_deletions` table:
```sql
CREATE TABLE scheduled_deletions (
  id UUID PRIMARY KEY,
  overlay_id UUID REFERENCES overlays(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  deletion_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Cron job runs daily:
```typescript
const now = new Date();
const pending = await db.query.scheduledDeletions.findMany({
  where: lte(scheduledDeletions.deletionDate, now)
});

for (const item of pending) {
  await r2Storage.delete(item.filename);
  await r2Storage.delete(getThumbnailFilename(item.filename));
  await db.delete(scheduledDeletions).where(eq(scheduledDeletions.id, item.id));
}
```

**Option B: Lazy Deletion**
Add `scheduledDeletionDate` to overlays table:
```sql
ALTER TABLE overlays ADD COLUMN scheduled_deletion_date TIMESTAMP;
```

When serving images, check date and delete on-the-fly:
```typescript
if (overlay.scheduledDeletionDate && overlay.scheduledDeletionDate < new Date()) {
  await r2Storage.delete(overlay.filename);
  await db.update(overlays).set({ filename: null }).where(eq(overlays.id, overlay.id));
  return 404;
}
```

**Recommendation:** Option A (background job) - cleaner separation of concerns.

## Delete Overlay Functionality (User-Initiated)

### Current State
Leaflet.DistortableImage has a default delete tool that immediately removes overlay from map. No backend communication, no confirmation dialog.

### Required Implementation

**Step 1: Disable Default Delete Tool**
```typescript
// In overlay initialization
overlay.editing.disable(); // Disable all default tools
// Then selectively enable only the tools we want
```

**Step 2: Create Custom Delete Button**
Add custom control/button to overlay toolbar that:
1. Shows confirmation dialog (async)
2. Calls backend API (async)
3. On success, removes overlay from map
4. On error, shows error message and keeps overlay on map

**Delete Dialog Content:**
```
Title: Delete Overlay?
Message: Are you sure you want to delete "{caption}"? This action cannot be undone.
Actions: Delete / Cancel
```

**Step 3: Backend Delete Endpoint**

**Permissions:**
- User can only delete their own overlays
- Only 'pending' status overlays can be deleted
- Cannot delete 'approved', 'rejected', or 'replaced' overlays

```typescript
deleteOverlay: protectedProcedure
  .input(z.object({ id: z.uuid() }))
  .mutation(async ({ input, ctx }) => {
    const overlay = await db.query.overlays.findFirst({
      where: eq(overlays.id, input.id)
    });

    if (!overlay) throw new TRPCError({ code: 'NOT_FOUND' });

    // Only owner can delete
    if (overlay.authorId !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    // Only pending overlays can be deleted
    if (overlay.approvalStatus !== 'pending') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Can only delete pending overlays'
      });
    }

    // Delete images first (safer - see below)
    await localStorage.delete(overlay.filename);
    await localStorage.delete(getThumbnailFilename(overlay.filename));

    // Then delete from database
    await db.delete(overlays).where(eq(overlays.id, input.id));

    return { success: true };
  });
```

**Image Deletion Safety:**

**Option A: Delete images first, then DB record** (RECOMMENDED)
```typescript
await deleteImageFiles(overlayId);  // If this fails, abort
await deleteFromDatabase(overlayId); // If this fails, orphaned files (acceptable)
```
✅ Safe: Never have DB pointing to missing images (no display errors)
⚠️ Risk: Rare case of orphaned files (no big deal, just wasted disk space)

**Option B: Delete DB first, then images** (NOT RECOMMENDED)
```typescript
await deleteFromDatabase(overlayId); // If this fails, abort
await deleteImageFiles(overlayId);   // If this fails, DB gone but images remain
```
❌ Dangerous: If image deletion fails, DB record is gone but images remain
❌ Worse: If someone queries between these operations, they get nothing

**Fallback for orphaned files:**
If image deletion fails but DB deletion succeeds, write filename to a cleanup log:
```typescript
// In catch block
await fs.appendFile('./orphaned_files.txt', `${filename}\n`);
```
Periodic cleanup script deletes files listed in this log.

### Delete Button Visibility

**Show delete button:**
- ✅ In edit mode
- ✅ User is author of overlay
- ✅ Overlay status is 'pending'

**Hide delete button:**
- ❌ In view mode (no toolbar visible anyway)
- ❌ User is not author
- ❌ Overlay status is 'approved', 'rejected', or 'replaced'

**Note:** Rejected/replaced overlays won't appear on the map anyway (visibility rules), so the button check is mostly for 'approved'.

### Future Extensions (Not Priority)

**Delete rejected overlays:**
- Allow users to delete their own rejected overlays (cleanup)
- Same process, just change status check

**Delete replaced overlays:**
- If user's overlay was replaced, allow them to manually delete it
- Useful for cleanup after replacement is approved

**Not allowed:** Deleting approved overlays (would remove public content)

## Frontend State Management

### Problem: User Editing a Replaced Overlay

**Scenario:**
- User has Overlay A on map in edit mode
- Moderator approves Overlay B (replaces A)
- User's frontend still shows A, unaware it's been replaced
- User makes changes to A and tries to save
- Backend returns: "Error: version conflict" (A's version was incremented)

**Current Handling:** Version error catches this (data-safe but bad UX)

**Error Message:** Should be clear:
```
"This overlay was replaced by another version while you were editing.
Your changes cannot be saved. Please refresh the page."
```

**Future Improvement (not priority):**
- WebSocket notifications (complex)
- Periodic polling to check overlay status (wasteful)
- For now: Accept bad UX, ensure data safety with version checking

## Summary of Decisions

| Question | Decision |
|----------|----------|
| Replacement chains allowed? | ✅ Yes, no limit or tracking beyond immediate predecessor |
| Multiple concurrent replacements? | Auto-reject others after moderator confirmation |
| Delete rules | Only pending overlays, only by owner |
| Cross-project replacements? | Allowed (user can "move" overlay to different project) |
| Change requests when replaced | Mark pending ones as 'conflicted', keep approved/rejected as historical |
| R2 cleanup for replaced overlays | Delete full + thumbnail after 15 days |
| R2 cleanup for rejected replacements | Delete full immediately, keep thumbnail for 15 days |
| Delete pending overlay cleanup | Delete both full + thumbnail immediately |
| Image deletion order | Images first, then DB (safer - see explanation above) |
| Row-level locking | Use PostgreSQL FOR UPDATE with version checking |
| "View original" button after approval | Shows "Image no longer available" after 15 days |

## Implementation Checklist

### Database
- [ ] Create migration to add 'replaced' to approval_status enum
- [ ] Create migration to add `replaced_by_overlay_id` column to overlays table
- [ ] Create index on `replaces_overlay_id`
- [ ] Create `scheduled_deletions` table (if using Option A for cleanup)
- [ ] Add `scheduled_deletion_date` column (if using Option B for cleanup)

### Backend
- [ ] Modify `setOverlayApprovalStatusWithVersion` in moderation.ts:
  - [ ] Detect replacement overlay (check `replacesOverlayId`)
  - [ ] Query pending change requests on original
  - [ ] Query competing replacement overlays
  - [ ] Update approval logic to handle all cases
  - [ ] Mark original as 'replaced' with version increment
  - [ ] Mark change requests as 'conflicted'
  - [ ] Auto-reject competing replacements
  - [ ] Schedule image cleanup for replaced overlay
- [ ] Create `deleteOverlay` endpoint in overlay.ts:
  - [ ] Permission checks (owner, pending status only)
  - [ ] Delete images before DB (safer order)
  - [ ] Orphaned file logging (fallback)
- [ ] Create image cleanup system:
  - [ ] Background job (cron) or lazy deletion
  - [ ] Schedule cleanup function
  - [ ] Cleanup execution logic
- [ ] Handle rejection of replacement overlays:
  - [ ] Delete full image immediately
  - [ ] Keep thumbnail for 15 days

### Frontend
- [ ] Create confirmation dialog component for replacement approval:
  - [ ] Show count of pending changes
  - [ ] Show count of competing replacements
  - [ ] Scrollable list of changes/overlays
  - [ ] Actions: Continue / Cancel
- [ ] Modify moderation panel to show dialogs before approval
- [ ] Disable Leaflet.DistortableImage default delete tool
- [ ] Create custom delete button/control:
  - [ ] Show confirmation dialog
  - [ ] Call deleteOverlay API
  - [ ] Remove overlay from map on success
  - [ ] Show error on failure
- [ ] Update delete button visibility logic:
  - [ ] Only show for pending, owned overlays in edit mode
- [ ] Update "View Original" button behavior:
  - [ ] Show "Image no longer available" if images deleted
- [ ] Improve version conflict error messages:
  - [ ] Detect replacement case
  - [ ] Show user-friendly message

### i18n
- [ ] Add translation keys:
  - [ ] Dialog titles and messages
  - [ ] Conflicted status label
  - [ ] Replaced status label
  - [ ] Delete confirmation
  - [ ] Error messages (version conflict, permission denied, etc.)

### Testing
- [ ] Test replacement approval with pending changes
- [ ] Test replacement approval with competing replacements
- [ ] Test replacement chains (A→B→C)
- [ ] Test race conditions (concurrent approvals)
- [ ] Test cross-project replacements
- [ ] Test delete pending overlay
- [ ] Test delete rejected overlay (future)
- [ ] Test image cleanup after 15 days
- [ ] Test version conflict handling

## Open Questions for Future

1. **Notification System:** How to notify users when their change requests become conflicted?
   - Email notifications?
   - In-app notifications?
   - Just show in "My Contributions" page?

2. **Re-submission UX:** Make it easier for users to re-submit conflicted changes?
   - "Submit for replacement overlay" button that pre-fills form?
   - Copy change request details to clipboard?

3. **Undo Replacement Approval:** Should moderators be able to undo replacement approvals?
   - If images are deleted after 15 days, undo is impossible
   - Should we keep images indefinitely for undo capability?
   - Or accept that undo has a time limit?

4. **View Replacement History:** Should users be able to see replacement history?
   - "This overlay replaced Overlay A on [date]"
   - "Overlay A replaced Overlay B on [date]"
   - Useful for transparency, but requires keeping metadata even after image deletion

5. **Orphaned File Cleanup:** Automated cleanup script for orphaned files?
   - Read `orphaned_files.txt` log
   - Attempt deletion
   - Log failures for manual intervention

---

**Document Version:** 1.0
**Last Updated:** 2025-11-05
**Status:** Ready for Implementation
