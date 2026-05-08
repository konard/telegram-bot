# Issue #13 Data

## GitHub Metadata

- Issue: https://github.com/konard/telegram-bot/issues/13
- Title: We need a script, to add all chat users into contacts, so they can freely access my private messages
- Author: konard
- Created: 2026-05-08T05:52:08Z
- Updated: 2026-05-08T05:52:08Z
- State at implementation time: open
- Labels: documentation, enhancement
- Prepared PR: https://github.com/konard/telegram-bot/pull/14
- Branch: issue-13-83ec1ed74413

## Original Issue Body

> I want to automate manual routing of adding list of users in chat to contacts, if I do it manually it takes a lot of time, which can be free to do something more valuable.
>
> We need to collect data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), list of each and all requirements from the issue, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).
>
> Please plan and execute everything in a single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.

## Comments And Reviews

- Issue comments: none at implementation time.
- PR conversation comments: none at implementation time.
- PR review comments: none at implementation time.
- PR reviews: none at implementation time.

## Related Repository Context

- `chat-users.mjs` already extracts unique users from a chat using participants, message authors, service events, forwards, mentions, and shared contacts.
- `message-members.mjs` already demonstrates iterating chat participants and filtering bots/deleted/fake/scam accounts before private-message operations.
- Prior case studies exist under `docs/case-studies/issue-5` and `docs/case-studies/issue-7`, both focused on Telegram user extraction behavior and GramJS runtime issues.
