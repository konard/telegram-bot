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
    history.md              # Single-part export
    history.json            # Source data in JSON
    files/                  # Downloaded media files (images, audio, video, documents)
```

When files exceed `--max-lines`, they are partitioned:

```
data/
  history-{yourTelegramUserId}-{timestamp}/
    history-1.md            # Part 1
    history-1.json          # Part 1 source data (same messages as history-1.md)
    history-2.md            # Part 2
    history-2.json          # Part 2 source data (same messages as history-2.md)
    ...
    files/                  # Downloaded media files
```

### Synchronized Partitioning

Each `history-N.md` and `history-N.json` contain **exactly the same messages**. The partitioning algorithm adds messages one at a time, checking that both the markdown and JSON representations stay under `--max-lines` (default: 1500). If adding a message would cause either file to exceed the limit, a new part is started.

Each `history-N.md` contains a single link to its corresponding `history-N.json`.

### Markdown Format

Each `history-N.md` file contains:

1. **Header** with export metadata (timestamp, message count, mode) — on the first part
2. **Link** to the corresponding JSON file
3. **Navigation** links (previous/next part) for multi-part exports
4. **Messages** in chronological order, each with:
   - Sender username and timestamp
   - Message text
   - Embedded images (as `![type](files/filename)`)
   - Links to other media files (as `[type: filename](files/filename)`)

### JSON Format

Each `history-N.json` file contains structured data with 2-space indentation:

```json
{
  "part": 1,
  "totalParts": 2,
  "totalMessages": 42,
  "messagesInPart": 21,
  "nextPart": "history-2.json",
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

## Library Usage

`history-to-markdown.mjs` can be imported as a library (auto-detected — no CLI execution when imported):

```javascript
import {
  normalizeDate,
  formatDate,
  getMediaType,
  filterCurrentActiveDialog,
  partitionMessages,
  writeParts,
  renderMessageMarkdown,
  renderMessageJson,
} from './history-to-markdown.mjs';

// Example: partition messages with custom max lines
const parts = partitionMessages(messages, userMap, 500);
const { mdFiles, jsonFiles } = writeParts(parts, outputDir, 'history', exportMeta);
```

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

All data is traversable from `history.md` (or `history-1.md`):
- Open the markdown file in any Markdown viewer
- Click the JSON link to view the structured source data
- Click embedded images to view full-size media
- Click media links to open audio, video, and document files
- Use prev/next navigation links for multi-part exports

## Running Tests

Unit tests cover the core partitioning logic and utility functions:

```bash
bun test tests/history-to-markdown.test.mjs
```
