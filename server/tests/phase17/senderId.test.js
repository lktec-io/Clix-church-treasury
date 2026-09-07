// Pure-unit coverage for the Beem sender-ID hygiene layer. No DB, no
// network — these pin exactly what is and is not allowed to change about a
// configured sender ID before it reaches Beem's exact-match check.
import { describe, it, expect } from 'vitest';
import { normalizeSenderId, senderIdWarning, wasNormalized } from '../../src/modules/sms/senderId.js';

describe('normalizeSenderId', () => {
  // The three ways a .env value looks right in an editor but is not the
  // string Beem approved.
  it.each([
    ['  ClixInvite  ', 'ClixInvite', 'surrounding whitespace'],
    ['ClixInvite\r', 'ClixInvite', 'a CR from a CRLF .env'],
    ['ClixInvite\n', 'ClixInvite', 'a trailing newline'],
    ['"ClixInvite"', 'ClixInvite', 'double quotes typed by hand'],
    ["'ClixInvite'", 'ClixInvite', 'single quotes typed by hand'],
    ['Clix  Invite', 'Clix Invite', 'a doubled internal space'],
  ])('strips %j -> %j (%s)', (raw, expected) => {
    expect(normalizeSenderId(raw)).toBe(expected);
  });

  // The load-bearing guarantee. Sender IDs are approved case-sensitively on
  // Beem's side and this process cannot know which casing was registered,
  // so "fixing" the case would break a correct deployment to repair a
  // broken one.
  it('never changes case in either direction', () => {
    expect(normalizeSenderId('clix invite')).toBe('clix invite');
    expect(normalizeSenderId('CLIX INVITE')).toBe('CLIX INVITE');
    expect(normalizeSenderId('Clix Invite')).toBe('Clix Invite');
  });

  it('leaves an already-clean value untouched', () => {
    expect(normalizeSenderId('ClixInvite')).toBe('ClixInvite');
    // The value the existing phase14 incident test configures — this must
    // stay byte-identical or that suite's "sent unmodified" assertion breaks.
    expect(normalizeSenderId('Clix Notify')).toBe('Clix Notify');
  });

  it('returns an empty string for a missing or non-string value', () => {
    expect(normalizeSenderId(undefined)).toBe('');
    expect(normalizeSenderId(null)).toBe('');
    expect(normalizeSenderId(42)).toBe('');
    expect(normalizeSenderId('   ')).toBe('');
  });
});

describe('wasNormalized', () => {
  it('is true only when normalisation actually changed the value', () => {
    expect(wasNormalized('ClixInvite ', 'ClixInvite')).toBe(true);
    expect(wasNormalized('ClixInvite', 'ClixInvite')).toBe(false);
  });
});

describe('senderIdWarning', () => {
  it('reports an unset sender ID', () => {
    expect(senderIdWarning('')).toMatch(/not set/);
  });

  // The production incident configuration.
  it('reports a space and suggests the space-free value', () => {
    const warning = senderIdWarning('Clix Notify');
    expect(warning).toMatch(/contains a space/);
    expect(warning).toContain('ClixNotify');
  });

  it('reports an over-long sender ID against the GSM 11-character cap', () => {
    expect(senderIdWarning('ThisIsWayTooLong')).toMatch(/11/);
  });

  it('reports punctuation', () => {
    expect(senderIdWarning('Clix-Invite')).toMatch(/other than letters\/digits/);
  });

  it('passes a conventional alphanumeric sender ID', () => {
    expect(senderIdWarning('ClixInvite')).toBeNull();
    expect(senderIdWarning('CLIX2026')).toBeNull();
  });
});
