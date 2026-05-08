import { describe, it, expect } from 'bun:test';
import {
  buildAddContactRequestArgs,
  createJsonReplacer,
  getUserIdKey,
  parseCliArgs,
  parseFloodWaitSeconds,
  sanitizeChatTarget,
  shouldAddContactCandidate,
  unwrapTelegramId,
} from '../add-chat-users-to-contacts.mjs';

describe('parseCliArgs', () => {
  it('defaults to dry-run mode unless --apply is present', () => {
    const config = parseCliArgs(['--chat', '@team']);
    expect(config.chat).toBe('@team');
    expect(config.apply).toBe(false);
    expect(config.dryRun).toBe(true);
    expect(config.delayMs).toBe(10000);
  });

  it('parses apply, limits, delay, phone sharing, and verbose flags', () => {
    const config = parseCliArgs([
      '--chat', '@team',
      '--apply',
      '--limit', '25',
      '--delay-ms', '5000',
      '--participants-limit', '100',
      '--messages-limit', '200',
      '--share-phone',
      '--verbose',
    ]);

    expect(config.apply).toBe(true);
    expect(config.dryRun).toBe(false);
    expect(config.limit).toBe(25);
    expect(config.delayMs).toBe(5000);
    expect(config.participantsLimit).toBe(100);
    expect(config.messagesLimit).toBe(200);
    expect(config.sharePhone).toBe(true);
    expect(config.verbose).toBe(true);
  });

  it('allows negative Telegram chat IDs as --chat values', () => {
    const config = parseCliArgs(['--chat', '-1001234567890']);
    expect(config.chat).toBe('-1001234567890');
  });
});

describe('sanitizeChatTarget', () => {
  it('converts private t.me/c links to -100 chat IDs', () => {
    expect(sanitizeChatTarget('https://t.me/c/123456/789')).toBe('-100123456');
  });

  it('keeps usernames and strips unsafe characters', () => {
    expect(sanitizeChatTarget('@my-team!!')).toBe('@my-team');
  });
});

describe('Telegram ID helpers', () => {
  it('unwraps BigInt-like GramJS integer values', () => {
    expect(unwrapTelegramId({ value: 123n })).toBe(123n);
  });

  it('creates stable string keys for primitive and wrapped IDs', () => {
    expect(getUserIdKey(123n)).toBe('123');
    expect(getUserIdKey({ value: 456n })).toBe('456');
    expect(getUserIdKey(null)).toBeNull();
  });
});

describe('shouldAddContactCandidate', () => {
  const meId = 100n;

  it('accepts regular non-contact users', () => {
    const result = shouldAddContactCandidate({ id: 200n, firstName: 'Ada' }, { meId });
    expect(result).toEqual({ ok: true, reason: 'eligible' });
  });

  it('skips the current account', () => {
    const result = shouldAddContactCandidate({ id: 100n, firstName: 'Me' }, { meId });
    expect(result).toEqual({ ok: false, reason: 'self' });
  });

  it('skips bots, deleted, fake, scam, and support accounts', () => {
    expect(shouldAddContactCandidate({ id: 1, bot: true }, { meId }).reason).toBe('bot');
    expect(shouldAddContactCandidate({ id: 2, deleted: true }, { meId }).reason).toBe('deleted');
    expect(shouldAddContactCandidate({ id: 3, fake: true }, { meId }).reason).toBe('fake');
    expect(shouldAddContactCandidate({ id: 4, scam: true }, { meId }).reason).toBe('scam');
    expect(shouldAddContactCandidate({ id: 5, support: true }, { meId }).reason).toBe('support');
  });

  it('skips existing contacts by default but can include them', () => {
    const user = { id: 300n, contact: true, firstName: 'Existing' };
    expect(shouldAddContactCandidate(user, { meId }).reason).toBe('already-contact');
    expect(shouldAddContactCandidate(user, { meId, includeExisting: true }).ok).toBe(true);
  });
});

describe('buildAddContactRequestArgs', () => {
  it('builds contacts.addContact arguments without requiring a phone number', () => {
    const user = { id: 123n, username: 'ada_dev', firstName: '', lastName: '' };
    const args = buildAddContactRequestArgs(user, { sharePhone: false });

    expect(args.id).toBe(user);
    expect(args.firstName).toBe('ada_dev');
    expect(args.lastName).toBe('');
    expect(args.phone).toBe('');
    expect(args.addPhonePrivacyException).toBe(false);
  });

  it('guarantees a non-empty contact name when Telegram user names are absent', () => {
    const args = buildAddContactRequestArgs({ id: 12345n }, { sharePhone: false });
    expect(args.firstName).toBe('User 12345');
  });

  it('can opt in to phone privacy exception', () => {
    const args = buildAddContactRequestArgs({ id: 1, firstName: 'Ada' }, { sharePhone: true });
    expect(args.addPhonePrivacyException).toBe(true);
  });
});

describe('report serialization and flood waits', () => {
  it('serializes BigInt values in JSON reports', () => {
    const json = JSON.stringify({ id: 123n }, createJsonReplacer(), 2);
    expect(json).toContain('"123"');
  });

  it('extracts FLOOD_WAIT seconds from Telegram errors', () => {
    expect(parseFloodWaitSeconds({ seconds: 5 })).toBe(5);
    expect(parseFloodWaitSeconds({ message: 'FLOOD_WAIT_17' })).toBe(17);
    expect(parseFloodWaitSeconds({ errorMessage: 'A wait of 23 seconds is required' })).toBe(23);
    expect(parseFloodWaitSeconds({ message: 'CONTACT_ID_INVALID' })).toBeNull();
  });
});
