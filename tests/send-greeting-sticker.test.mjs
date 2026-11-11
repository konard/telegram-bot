import { describe, it, expect } from 'bun:test';
import { collectMaskStickerDocuments, dedupeDocuments } from '../send-greeting-sticker.mjs';

// Minimal Api stand-in mirroring the TL constructors used by the script.
class Req { constructor(args) { Object.assign(this, args); this.className = this.constructor.name; } }
const Api = {
  messages: {
    GetMaskStickers: class GetMaskStickers extends Req {},
    GetStickerSet: class GetStickerSet extends Req {},
  },
  InputStickerSetID: class InputStickerSetID extends Req {},
};

const silentLog = { error() {} };

function makeClient(handlers) {
  const calls = [];
  return {
    calls,
    async invoke(req) {
      calls.push(req);
      return handlers[req.className](req);
    },
  };
}

describe('collectMaskStickerDocuments', () => {
  it('fetches documents of mask-only sets from messages.AllStickers.sets (issue #16)', async () => {
    const maskSet = { id: 1n, accessHash: 2n, title: 'Fixture masks', shortName: 'Fixture_masks', count: 1, hash: 3, masks: true };
    const maskDoc = { id: 10n, accessHash: 11n, attributes: [{ className: 'DocumentAttributeSticker', alt: '👋', mask: true }] };
    const client = makeClient({
      // messages.AllStickers has `sets`, never `stickers`
      GetMaskStickers: () => ({ className: 'messages.AllStickers', hash: 0n, sets: [maskSet] }),
      GetStickerSet: () => ({ set: maskSet, documents: [maskDoc] }),
    });
    const { documents, errors } = await collectMaskStickerDocuments({ client, Api, log: silentLog });
    expect(documents).toEqual([maskDoc]);
    expect(errors).toEqual([]);
    const setReq = client.calls.find(c => c.className === 'GetStickerSet');
    expect(setReq.stickerset.id).toBe(1n);
    expect(setReq.stickerset.accessHash).toBe(2n);
  });

  it('keeps going when one set fails, reports the error and dedupes ids', async () => {
    const sets = [{ id: 1n, accessHash: 1n, shortName: 'bad' }, { id: 2n, accessHash: 2n }, { id: 3n, accessHash: 3n }];
    const doc = { id: 5n, attributes: [] };
    const client = makeClient({
      GetMaskStickers: () => ({ sets }),
      GetStickerSet: req => {
        if (req.stickerset.id === 1n) throw new Error('boom');
        return { documents: [doc] };
      },
    });
    const { documents, errors } = await collectMaskStickerDocuments({ client, Api, log: silentLog });
    expect(documents).toEqual([doc]);
    expect(errors.length).toBe(1);
    expect(errors[0].set.shortName).toBe('bad');
  });

  it('handles messages.AllStickersNotModified (no sets)', async () => {
    const client = makeClient({ GetMaskStickers: () => ({ className: 'messages.AllStickersNotModified' }) });
    const { documents } = await collectMaskStickerDocuments({ client, Api, log: silentLog });
    expect(documents).toEqual([]);
  });
});

describe('dedupeDocuments', () => {
  it('dedupes by id across bigint, Integer-like and nested documents', () => {
    const a = { id: 1n };
    const b = { id: { value: 1n } };
    const c = { document: { id: 2n } };
    const d = { document: { id: 2n } };
    expect(dedupeDocuments([a, b, c, d])).toEqual([a, c]);
  });
});
