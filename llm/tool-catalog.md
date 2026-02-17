# Tool Catalog (Current)

This catalog is adapted from the upstream `nostr-mcp-server` functionality now hosted in Nostr Agent Interface.

## Reading and Querying

1. `getProfile`: Fetch Nostr profile metadata (kind 0) by pubkey.
2. `getKind1Notes`: Fetch text notes (kind 1) by author.
3. `getLongFormNotes`: Fetch long-form notes (kind 30023).
4. `getReceivedZaps`: Fetch zaps received by a pubkey.
5. `getSentZaps`: Fetch zaps sent by a pubkey.
6. `getAllZaps`: Fetch sent and received zaps together.
7. `queryEvents`: Generic event query by kinds/authors/ids/tags/time.
8. `getContactList`: Read contact list (kind 3).
9. `getFollowing`: Alias for following list retrieval.
10. `getRelayList`: Read relay list metadata (kind 10002 / NIP-65).

## Identity and Profile

11. `createKeypair`: Generate new Nostr keypairs.
12. `createProfile`: Create a profile event.
13. `updateProfile`: Update profile metadata.

## Notes

14. `createNote`: Create unsigned kind 1 note.
15. `signNote`: Sign note with private key.
16. `publishNote`: Publish signed note to relays.
17. `postNote`: One-step authenticated note post.

## Generic Event Lifecycle

18. `createNostrEvent`: Create unsigned event of arbitrary kind.
19. `signNostrEvent`: Sign arbitrary unsigned event.
20. `publishNostrEvent`: Publish arbitrary signed event.

## Social

21. `setRelayList`: Publish relay list metadata (NIP-65).
22. `follow`: Follow a pubkey via contact list update.
23. `unfollow`: Unfollow a pubkey.
24. `reactToEvent`: Publish reaction event (kind 7).
25. `repostEvent`: Publish repost (kind 6).
26. `deleteEvent`: Publish deletion request (kind 5).
27. `replyToEvent`: Reply with proper NIP-10 thread tagging.

## Messaging

28. `encryptNip04`: Encrypt plaintext with NIP-04.
29. `decryptNip04`: Decrypt NIP-04 ciphertext.
30. `sendDmNip04`: Send encrypted DM (kind 4).
31. `getDmConversationNip04`: Fetch/decrypt NIP-04 conversation.
32. `encryptNip44`: Encrypt plaintext with NIP-44.
33. `decryptNip44`: Decrypt NIP-44 ciphertext.
34. `sendDmNip44`: Send NIP-44 DM via NIP-17 gift wrap (kind 1059).
35. `decryptDmNip44`: Decrypt NIP-17 gift wrapped DM.
36. `getDmInboxNip44`: Fetch/decrypt NIP-44 inbox.

## Anonymous Actions

37. `sendAnonymousZap`: Prepare anonymous zap and invoice flow.
38. `postAnonymousNote`: Post a note with one-time generated identity.

## NIP-19 Entity Utilities

39. `convertNip19`: Convert among hex and NIP-19 entity encodings.
40. `analyzeNip19`: Decode/analyze NIP-19 entity payload.

## Input Normalization Notes

1. Public keys generally accept hex and `npub`.
2. Private keys generally accept hex and `nsec` for auth/signing flows.
3. Relay lists are optional for many tools; defaults are used when omitted.

## Agent Usage Heuristics

1. Prefer read-only tools first when gathering context.
2. Before write operations, confirm required key material is present.
3. For publishing failures, retry with explicit relay list and surfaced error details.
