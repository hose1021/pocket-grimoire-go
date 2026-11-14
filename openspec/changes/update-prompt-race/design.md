# Design

## Context

See `proposal.md` — Why. The update controller registers `updatefound`, reads
`registration.installing`, and watches that worker's `statechange` events. The
browser check's opening-update step counts page loads.

## Goals / Non-Goals

**Goals:**

- A worker installed after the opening check always raises the prompt.
- The update check is deterministic on CI without weakening what it asserts.

**Non-Goals:**

- Any change to activation, the save policy or the precache list.
- Making the legacy preflight reply permanent; it stays a transition measure.

## Decisions

**Read `registration.waiting` when `installing` is empty.** The install of a small
or cached artifact can complete before the page receives `updatefound`; at that
moment the worker is waiting and `installing` is null. Watching
`installing ?? waiting` covers both orders. Alternative considered: re-check
`registration.waiting` on a timer — rejected, it papers over the miss.

**Assert the opening update's outcome, not its load count.** A reload can leave
the page without a controlled client for an instant, and the browser then
activates the waiting worker itself, so the next document already runs the new
version. One load or two both satisfy the spec. The check now waits for the new
worker to control the page and asserts the banner, the version and the pruned
cache; the load count only has to stay at or below two.

**Assert the preflight reply in a real browser.** The compatibility rule lives in
the generated worker and crosses a real `MessageChannel`; the unit test uses a
fake port, so the browser check asks the waiting worker directly.

## Risks / Trade-offs

- A prompt that a slow install never delivers is still possible if the page
  navigates away; the next open applies the update anyway.
- The relaxed count no longer proves that the page performs the reload in every
  environment. The version, banner and cache assertions cover the user-visible
  result, which is what the requirement states.

## Migration Plan

Revert the pull request if needed; both edits are independent of the deployed
worker protocol.
