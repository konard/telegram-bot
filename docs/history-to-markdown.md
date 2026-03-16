# History to Markdown - Full Flow Guide

This document describes the complete flow for exporting Telegram chat history to Markdown.

## Prerequisites

1. Telegram API credentials (API ID and API Hash) — see [README](../README.md#how-to-get-your-telegram-api-id-and-api-hash)
2. [Bun](https://bun.sh/) or Node.js 20+ installed
3. A `.env` file configured with your credentials (or enter them interactively)

## Quick Start: Export Current Active Dialog

The simplest way to export the current conversation (messages since the last 4-hour gap):

```bash
# Using environment variable for chat target
TELEGRAM_CHAT_USERNAME=@username bun history-to-markdown.mjs

# Or using CLI argument
bun history-to-markdown.mjs --chat @username
```

This exports only recent, active messages — typically today's conversation.

## Export Entire History

To download all available messages:

```bash
bun history-to-markdown.mjs --chat @username --all
```

## Export by Chat ID

If you know the numeric chat ID:

```bash
bun history-to-markdown.mjs --chat 123456789
```

## Configuration Options

All options can be set via CLI arguments, environment variables, or `.env` file.

| CLI Argument     | Environment Variable    | Default | Description                                       |
|------------------|-------------------------|---------|---------------------------------------------------|
| `--chat`         | `TELEGRAM_CHAT_USERNAME` or `TELEGRAM_CHAT_ID` | *(prompt)* | Target chat username or ID |
| `--all`          | —                       | `false` | Export entire history                              |
| `--gap-hours`    | `TELEGRAM_GAP_HOURS`    | `4`     | Hours of inactivity defining a dialog boundary     |
| `--max-lines`    | `TELEGRAM_MAX_LINES`    | `1500`  | Max lines per markdown/JSON file before splitting  |
| `--verbose`, `-v`| —                       | `false` | Enable verbose logging                             |
| `--help`         | —                       | —       | Show help and exit                                 |

### Configuration via lino-arguments

This script uses [lino-arguments](https://github.com/link-foundation/lino-arguments) for configuration. The priority order is:

1. **CLI arguments** (highest priority)
2. **Environment variables**
3. **`.lenv` file** (if present)
4. **Default values** (lowest priority)

## Output Structure

Each export creates a timestamped directory:

```
data/
  history-{yourTelegramUserId}-{timestamp}/
    history.md              # Main markdown file (or history_part1.md, history_part2.md, ...)
    history.json            # Source data in JSON (or history_part1.json, history_part2.json, ...)
    files/                  # Downloaded media files (images, audio, video, documents)
      photo_123.jpg
      video_456.mp4
      document_789.pdf
```

### Markdown Format

The `history.md` file contains:

1. **Header** with export metadata (timestamp, message count, mode)
2. **Links** to all JSON data files
3. **Messages** in chronological order, each with:
   - Sender username and timestamp
   - Message text
   - Embedded images (as `![type](files/filename)`)
   - Links to other media files (as `[type: filename](files/filename)`)

### JSON Format

The `history.json` file contains structured data:

```json
{
  "part": 1,
  "totalParts": 1,
  "totalMessages": 42,
  "messagesInPart": 42,
  "messages": [
    {
      "id": 12345,
      "date": "2025-05-18 14:30:00",
      "senderId": 67890,
      "senderName": "@username",
      "text": "Hello!",
      "mediaType": "photo",
      "mediaFilePath": "files/photo_12345.jpg"
    }
  ]
}
```

### File Partitioning

When markdown or JSON files exceed `--max-lines` (default: 1500), they are automatically split into parts:
- `history_part1.md`, `history_part2.md`, etc.
- Each part has navigation links to the previous and next parts at the top and bottom.
- JSON parts include `previousPart` and `nextPart` fields for programmatic navigation.

### Media Support

The script downloads the following media types:
- **Photos** (`.jpg`)
- **Videos** (`.mp4`, `.webm`, `.mov`)
- **Audio** (`.mp3`, `.ogg`, `.wav`, `.m4a`)
- **Voice messages** (`.ogg`)
- **Round videos** (video messages)
- **Documents** (`.pdf`, `.zip`, and other files with original filenames preserved)
- **Images** sent as documents (`.png`, `.gif`, `.webp`)

Non-downloadable media (polls, contacts, locations, etc.) are noted in the markdown as `*[type]*`.

## Examples

### Export today's active dialog with verbose output

```bash
bun history-to-markdown.mjs --chat @mychat --verbose
```

### Export full history with custom gap threshold

```bash
bun history-to-markdown.mjs --chat @mychat --gap-hours 8
```

### Export with smaller file parts

```bash
bun history-to-markdown.mjs --chat @mychat --all --max-lines 500
```

### Using .env file

Create a `.env` file:

```dotenv
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=+1234567890
TELEGRAM_CHAT_USERNAME=@target_chat
TELEGRAM_GAP_HOURS=4
TELEGRAM_MAX_LINES=1500
```

Then simply run:

```bash
bun history-to-markdown.mjs
```

## Navigating the Export

All data is traversable from `history.md`:
- Open `history.md` (or `history_part1.md`) in any Markdown viewer
- Click embedded images to view full-size media
- Click media links to open audio, video, and document files
- Click JSON data links to view structured source data
- Use prev/next navigation links for multi-part exports
