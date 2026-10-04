# CPCMS — Production Debug Report (v1.4.1)

## Code functionality breakdown (traced, not assumed)
- login(): find user by email/phone → bcrypt compare → status checks → sign JWT (7d)
- requireAuth(): verify JWT → load user → status ACTIVE check → attach
- restore(): validate snapshot → pre-restore safety runBackup() → close DB, copy snapshot over live file, exit → PM2 restarts
- runBackup(): db.backup() → prune to newest 30 snapshots
- sync layer: hydrate on sign-in → debounced whole-doc PUT with optimistic version

## Bug 1 — invited users told "wrong password" (severity: high, UX/support load)
**Root cause:** login checked the password *before* the INVITED status. Invited
accounts carry a random placeholder hash, so bcrypt always fails first and the
status branch was unreachable — proven: forged INVITED user got
"Wrong email or password."
**Fix:** status check moved above the compare. Invitee now sees
"Invitation pending — set your password through the link that was emailed to you."
**Edge cases covered:** DISABLED still reports after password check (doesn't
leak which disabled accounts exist to password guessers); phone-login invitees
get the same message.

## Bug 2 — restore could delete the very snapshot being restored (severity: critical, data loss)
**Root cause:** restore() runs a pre-restore safety backup, and runBackup()
prunes to the newest 30 files. At exactly the retention cap, restoring the
*oldest* snapshot meant the safety backup pushed it past the cap — pruned
before the copy. Proven with 30 fabricated snapshots: target vanished.
The process then died in the copy step and PM2 restarted on the old DB —
a silent no-op restore.
**Fix:** the chosen snapshot is staged to `cpcms.db.restore-staged` *before*
the safety backup; the swap copies from the stage; the stage is cleaned on
success, failure, and (leftover) at next boot.
**Edge cases covered:** interrupted restore leaves no stale staging file;
failed copy still restarts cleanly on the untouched DB.

## Bug 3 — sessions survive password change/reset (severity: high, security)
**Root cause:** JWTs carried only user id + role; nothing tied them to the
credential. Admin resets a compromised account → the attacker's 7-day token
kept working. Proven: /me succeeded on the old token after a change.
**Fix:** tokens now embed a password-version claim (`pwv`, last 16 chars of the
bcrypt hash); requireAuth rejects any token whose pwv doesn't match the current
hash. Changing or resetting a password instantly invalidates every prior
session for that account.
**Deploy note:** all existing sessions become invalid once — everyone signs in
again after this deploy. That is the fix working, not a regression.

## Minor fixes in the same pass
- sync timer id lifecycle (beforeunload flush no longer fires when clean)
- duplicate `fs` import introduced during staging fix (caught by boot test)

## Verification (all automated, before/after)
reproduced ✓ → fixed ✓ for each: invited-message reachability, 30-cap restore
staging survival, token death on password change, fresh-login continuity.
