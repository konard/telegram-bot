# Case Study: Issue #13 - Add Chat Users To Contacts

## Summary

Issue #13 asks for automation that adds users from a Telegram chat to the current account's contact list, so those users can more easily open private conversations with the account. The issue also explicitly requires a repository-local case study with online research, requirement extraction, solution options, and a single pull request implementation.

This PR implements a new `add-chat-users-to-contacts.mjs` script and documents the research behind the approach.

## Requirements

1. Compile issue-related data under `docs/case-studies/issue-13`.
2. Perform a deeper case study analysis using repository context and online facts.
3. List every requirement from the issue.
4. Propose possible solutions and solution plans for each requirement.
5. Check existing components and libraries that solve, or help solve, the problem.
6. Execute the selected solution in one pull request.
7. Add a script that automates adding chat users into contacts.
8. Avoid a workflow that requires manually adding each chat user.

## Repository Findings

The repository already uses a user account through GramJS, not a Telegram Bot API token:

- `utils.mjs` initializes a `TelegramClient` and stores `.telegram_session`.
- `chat-users.mjs` already discovers users from participants, message authors, service actions, forwards, mentions, and shared contact media.
- `message-members.mjs` already filters out bots, deleted, fake, and scam accounts before private-message operations.
- Existing tests use `bun:test` and import pure helpers from ESM scripts.

These patterns make a GramJS-based script the lowest-risk implementation path.

## Online Research Findings

### Telegram Contact APIs

Telegram documents two relevant MTProto contact workflows:

- `contacts.importContacts` imports phone contacts using `inputPhoneContact` values. It needs phone numbers and is intended for syncing a local address book. Source: https://core.telegram.org/api/contacts
- `contacts.addContact` adds an existing Telegram user as a contact, and Telegram explicitly says it can work without knowing the user's phone number. Source: https://core.telegram.org/api/contacts and https://core.telegram.org/method/contacts.addContact

The `contacts.addContact` method parameters include:

- `id`: the target `InputUser`
- `first_name` and `last_name`
- `phone`, which Telegram says may be omitted to add without a phone number
- `add_phone_privacy_exception`, which allows the other user to see our phone number if enabled

The method is marked "Only users can use this method", so a Bot API implementation is not suitable for this exact requirement. Source: https://core.telegram.org/method/contacts.addContact

### GramJS Support

GramJS exposes `Api.contacts.AddContact` with camelCase arguments (`firstName`, `lastName`, `addPhonePrivacyException`) and accepts an entity-like `id`. Source: https://gram.js.org/tl/contacts/AddContact

GramJS also supports `iterParticipants` for participant discovery in groups and channels, which matches the existing `chat-users.mjs` approach. Source: https://painor.gitbook.io/gramjs/getting-started/available-methods/getting-participants-of-a-group-channel

### Telegram Constraints

Participant discovery is not guaranteed to return every historical user:

- Channel or supergroup participant access can be limited by Telegram permissions and privacy.
- Message scanning can find additional users from senders, service actions, forwards, mentions, and contact media.
- Some users may be inaccessible, deleted, bots, or already contacts.
- Telegram can return flood-wait errors for repeated API actions. The script should delay requests and respect flood-wait responses.

### Privacy Constraint

The script must not share the current account's phone number by default. Telegram's `add_phone_privacy_exception` flag exists specifically for allowing the other user to see the phone number, so the safe default is `false`. The implementation exposes this only as an explicit `--share-phone` option.

## Existing Components And Library Options

### Option A: GramJS In This Repository

Use the current `telegram` package through `use-m`, the existing `.telegram_session`, and `Api.contacts.AddContact`.

Pros:

- Matches current repo architecture.
- No package manager setup required.
- Reuses Telegram login/session flow.
- Supports the exact official MTProto method required.

Cons:

- Uses a user account, so real runs affect the operator's Telegram contacts.
- Needs rate limiting and dry-run behavior.

Chosen for this PR.

### Option B: Extend `chat-users.mjs` Output

Run `chat-users.mjs`, then add contacts from `data/{chat}/users.json`.

Pros:

- Separates discovery from mutation.
- Lets the user review discovered users first.

Cons:

- The existing JSON output does not preserve access hashes or full input entities.
- Numeric IDs alone are often not enough to call `contacts.addContact`.
- Adds a fragile two-step workflow.

Useful as a future enhancement if `chat-users.mjs` starts writing enough entity metadata.

### Option C: Phone Contact Import

Use `contacts.importContacts` or a wrapper library's import contacts helper.

Pros:

- Good for a trusted phone-number list.
- Official Telegram workflow.

Cons:

- Does not solve the main chat-user case when phone numbers are unavailable.
- More likely to expose or depend on phone address book data.

Rejected for the primary workflow.

### Option D: Bot API

Use a Telegram bot to add contacts.

Pros:

- Bot token setup can be simpler for many automations.

Cons:

- Telegram marks `contacts.addContact` as user-only.
- Bot API does not provide an equivalent "add this user to my contacts" operation.

Rejected.

### Option E: Other MTProto Libraries

Telethon, Pyrogram/Hydrogram, TDLib, and MadelineProto expose raw MTProto contact methods.

Pros:

- Mature alternatives exist in Python, C++/JSON, and PHP ecosystems.

Cons:

- This repository is already JavaScript/Bun and GramJS-based.
- Switching libraries would add unnecessary runtime and session complexity.

Not chosen for this PR.

## Selected Solution

Add `add-chat-users-to-contacts.mjs`:

1. Parse CLI options before any Telegram connection, so `--help` is safe.
2. Default to dry-run mode.
3. Require `--apply` before mutating the Telegram contact list.
4. Resolve the target chat from `--chat`, `TELEGRAM_CHAT_USERNAME`, `TELEGRAM_CHAT_ID`, or an interactive prompt.
5. Collect visible users from `iterParticipants`.
6. Scan messages for additional sender, service-action, forward, mention, and shared-contact user IDs.
7. Resolve message-only user IDs where Telegram allows it.
8. Skip self, bots, deleted, fake, scam, support accounts, and existing contacts by default.
9. Build non-empty `contacts.addContact` names, falling back to username or `User {id}`.
10. Add contacts through `Api.contacts.AddContact` only in `--apply` mode.
11. Use a delay between mutations and retry once after Telegram flood-wait responses.
12. Write a JSON report to `data/{chat}/contact-add-report-{timestamp}.json`.

## Usage

Preview only:

```zsh
bun add-chat-users-to-contacts.mjs --chat @your_chat_username
```

Apply a limited batch:

```zsh
bun add-chat-users-to-contacts.mjs --chat @your_chat_username --apply --limit 20
```

Apply and intentionally allow added users to see your phone number:

```zsh
bun add-chat-users-to-contacts.mjs --chat @your_chat_username --apply --share-phone
```

## Verification Plan

Automated tests cover the pure parts of the new script:

- CLI parsing defaults to dry-run.
- `--apply`, limits, delays, and privacy flags parse correctly.
- `t.me/c` links normalize to Telegram private chat IDs.
- GramJS BigInt-like IDs normalize safely.
- Candidate filtering skips unsafe or irrelevant accounts.
- `contacts.addContact` arguments never use an empty first name.
- JSON reports serialize BigInt IDs.
- Flood-wait seconds are parsed from Telegram-style errors.

Manual live verification requires valid Telegram credentials and a real chat. The safe command is the dry-run command above, because it connects and scans without changing contacts.

## Follow-Up Ideas

- Add `--from-users-json` if `chat-users.mjs` is later extended to preserve enough entity information for reliable contact addition.
- Add resumable apply reports that can skip users already processed in a prior report.
- Add a configurable maximum flood-wait threshold for unattended runs.

## References

- Telegram Core API contacts overview: https://core.telegram.org/api/contacts
- Telegram `contacts.addContact`: https://core.telegram.org/method/contacts.addContact
- GramJS `contacts.AddContact`: https://gram.js.org/tl/contacts/AddContact
- GramJS participants helper: https://painor.gitbook.io/gramjs/getting-started/available-methods/getting-participants-of-a-group-channel
- Telegram channels and supergroups behavior: https://core.telegram.org/api/channel
