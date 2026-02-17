# Zap Tools

This module implements zap-related functionality (NIP-57 + LNURL/LUD flows) used by Nostr Agent Interface.

The same zap contracts are available through MCP, CLI, and API surfaces, with CLI/API as the preferred operational paths and MCP retained for compatibility.

## Files

1. `zap-tools.ts` - zap parsing/validation, LNURL flow handling, anonymous zap preparation.

## Capabilities

1. Validate zap receipts (NIP-57).
2. Parse BOLT11 invoices and extract sats values.
3. Classify zap direction (`sent`, `received`, `self`, `unknown`).
4. Prepare anonymous zap requests to profiles/events.
5. Integrate with LNURL-pay / Lightning Address targets.

## Usage

```typescript
import {
  processZapReceipt,
  validateZapReceipt,
  formatZapReceipt,
  prepareAnonymousZap,
} from "./zap/zap-tools.js";

const processed = processZapReceipt(zapReceipt, userPubkey);
const valid = validateZapReceipt(zapReceipt);
const formatted = formatZapReceipt(processed, userPubkey);
const anon = await prepareAnonymousZap("npub1...", 1000, "Great post");

void valid;
void formatted;
void anon;
```
