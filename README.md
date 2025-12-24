# telegram-bot
Scripts to work with telegram

## Features & Workflow

- Export Telegram chat history to Markdown using your user account (not a bot)
- Extract all unique users from a chat (authors, joins/leaves, mentions, forwards)
- Uses only use-m for dynamic dependency loading (no package.json or npm install required)
- Reads API credentials and defaults from a `.env` file (see `.env.example`)
- Supports headless/automated operation via environment variables
- Saves chat history to `data/{chat_username}/history.md` (not in repo root)
- Ignores all exported data and secrets in git
- Handles Telegram nicknames/usernames in export (not just numeric IDs)
- Dates are formatted as `YYYY-MM-DD HH:mm:ss` (ISO-like, human readable)
- Handles Telegram client TIMEOUT errors gracefully
- Uses top-level await (no main function)
- Compatible with Node.js ESM (.mjs)

## How to Get Your Telegram API ID and API Hash

1. Go to [https://my.telegram.org](https://my.telegram.org) and log in with your Telegram phone number.
2. Click on **API development tools**.
3. Fill in the required fields:
   - **App title**: Any name you like (e.g., MyApp).
   - **Short name**: Any short identifier (e.g., myapp).
   - **URL**: You can use any valid URL (e.g., https://example.com).
4. Click **Create application**.
5. After creation, you will see your **API ID** and **API Hash** displayed on the page.
6. Copy these values. You can either:
   - Create a `.env` file in this directory with:
     ```
     TELEGRAM_API_ID=your_api_id
     TELEGRAM_API_HASH=your_api_hash
     TELEGRAM_PHONE=+1234567890
     TELEGRAM_CHAT_USERNAME=@yourusername
     TELEGRAM_CHAT_ID=
     ```
   - Or, enter them manually when prompted by the script.

## Usage

1. Create a `.env` file in this directory with the following variables:
   ```dotenv
   TELEGRAM_API_ID=your_api_id
   TELEGRAM_API_HASH=your_api_hash
   TELEGRAM_PHONE=+1234567890
   TELEGRAM_CHAT_USERNAME=@your_chat_username
   TELEGRAM_CHAT_ID=
   TELEGRAM_MAX_GREETINGS=0
   ```
2. Run one of the available scripts:

   **Export chat history to Markdown:**
   ```zsh
   bun history-to-markdown.mjs
   ```
   Saves chat history to `data/{chat_username}/history.md`.

   **Extract all unique users from a chat:**
   ```zsh
   bun chat-users.mjs
   ```
   Searches for chats by name (fuzzy matching). If multiple chats match, you'll be prompted to use a more specific query. Collects users from:
   - Message authors
   - User joined/left/added/removed events
   - Forwarded message sources
   - User mentions in messages
   - Shared contacts

   Saves users list to `data/{chat_username}/users.json`.

3. If any required values are missing in `.env`, the script will prompt you interactively.

## Security & Git

- `.env`, `data/`, and all secrets are ignored by git (see `.gitignore`).
- Only `.env.example` is tracked for sharing variable names.

## Example Output

```
**@user** [2025-05-17 21:54:04]:
Доброй ночи

**@drakonard** [2025-05-18 01:31:49]:
Привет
```

## Notes

- The script uses only dynamic imports via use-m for all non-built-in dependencies.
- All built-in modules (like `fs`) are imported directly.
- The script is robust to accidental terminal input artifacts and handles errors gracefully.
- If you see a TIMEOUT error after export, it is handled and can be ignored.
- The script is ready for automation and can be run repeatedly with different `.env` settings.
