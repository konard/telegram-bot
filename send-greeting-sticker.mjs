#!/usr/bin/env bun
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { usingTelegram } from './utils.mjs';

// send-greeting-sticker.mjs
//
// Usage:
// 1. Just run: bun send-greeting-sticker.mjs
//
// This script will prompt for your API credentials (or use environment variables), connect to Telegram,
// search for "hi" sticker sets, pick a random sticker, and send it to the public chat @The_Jacque_Fresco.

// Define target chat
const chatUsername = '@The_Jacque_Fresco';

export async function sendGreetingSticker({ client, Api, chatUsername }) {
  const channel = await client.getEntity(chatUsername);

  // Caching logic: load from or write to ./data/stickers.json
  const cacheDir = path.resolve('./data');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const cacheFile = path.join(cacheDir, 'stickers.json');

  let docs;
  if (fs.existsSync(cacheFile)) {
    // console.log(`Loading stickers data from cache: ${cacheFile}`);
    try {
      docs = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
    } catch (e) {
      console.error('Error reading cache file, will refetch:', e);
      docs = [];
    }
    // Restore Buffer objects for fileReference
    docs.forEach(docItem => {
      const raw = docItem.document ? docItem.document : docItem;
      const ref = raw.fileReference;
      if (ref && ref.type === 'Buffer' && Array.isArray(ref.data)) {
        raw.fileReference = Buffer.from(ref.data);
      }
    });
  } else {
    console.log('No cache found, fetching stickers data...');
    docs = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const res = await client.invoke(new Api.messages.GetOldFeaturedStickers({ offset, limit, hash: 0 }));
      const featured = res.sets;
      if (!featured.length) break;
      for (const cover of featured) {
        const shortName = cover.set.shortName;
        try {
          const detail = await client.invoke(new Api.messages.GetStickerSet({ stickerset: new Api.InputStickerSetShortName({ shortName }), hash: 0 }));
          docs.push(...detail.documents);
        } catch (e) {
          console.error(`Error fetching featured set ${shortName}:`, e);
        }
      }
      offset += featured.length;
      if (featured.length < limit) break;
    }
    const recent = await client.invoke(new Api.messages.GetRecentStickers({ hash: 0 }));
    docs.push(...(recent.stickers ?? []));
    const mask = await client.invoke(new Api.messages.GetMaskStickers({ hash: 0 }));
    docs.push(...(mask.stickers ?? []));
    const faved = await client.invoke(new Api.messages.GetFavedStickers({ hash: 0 }));
    docs.push(...(faved.stickers ?? []));
    try {
      await fs.promises.writeFile(cacheFile, JSON.stringify(docs, null, 2), 'utf8');
      console.log(`Cached stickers data to ${cacheFile}`);
    } catch (e) {
      console.error('Error writing cache file:', e);
    }
  }

  if (!docs.length) {
    console.error('No stickers collected from featured or user sets.');
    process.exit(1);
  }

  // Filter by alt text only (hi/hello words or wave emojis)
  const filtered = docs.filter(doc => {
    const attributes = doc.document ? doc.document.attributes : doc.attributes;
    const stickerAttr = attributes.find(a => a.className === 'DocumentAttributeSticker');
    if (!stickerAttr?.alt) return false;
    return /\b(hi|hello)\b/i.test(stickerAttr.alt) || /👋/.test(stickerAttr.alt);
  });
  if (!filtered.length) {
    console.error('No hi/hello stickers found in featured sets.');
    process.exit(1);
  }

  // DEBUG: inspect filtered candidates
  // console.log(`Total docs: ${docs.length}. Filtered candidates: ${filtered.length}`);
  // console.log('Filtered candidates:');
  filtered.forEach((doc, idx) => {
    const attributes = doc.document ? doc.document.attributes : doc.attributes;
    const stickerAttr = attributes.find(a => a.className === 'DocumentAttributeSticker');
    const alt = stickerAttr?.alt || '';
    // console.log(`${idx}: alt="${alt}"`);
  });

  // Pick a random hi/hello sticker and send it
  const index = Math.floor(Math.random() * filtered.length);
  // console.log(`Selecting sticker #${index}`);
  const doc = filtered[index];
  // Some Document objects nest the real fields under `doc.document`
  const docRaw = doc.document ? doc.document : doc;
  // Unwrap Integer-like types to BigInt
  const idRaw = docRaw.id;
  const accessHashRaw = docRaw.accessHash;
  const fileReference = docRaw.fileReference;
  const id = typeof idRaw === 'object' && 'value' in idRaw ? idRaw.value : idRaw;
  const accessHash = typeof accessHashRaw === 'object' && 'value' in accessHashRaw ? accessHashRaw.value : accessHashRaw;
  if (id === undefined || accessHash === undefined || fileReference === undefined) {
    console.error('Failed to extract id/accessHash/fileReference from doc:', doc);
    process.exit(1);
  }

  // Wrap the sticker into the InputDocument type for sending
  const inputDoc = new Api.InputDocument({ id, accessHash, fileReference });
  // Create the media payload with InputDocument as 'id'
  const media = new Api.InputMediaDocument({ id: inputDoc, ttlSeconds: 0 });
  const randomId = BigInt(Date.now() * 1000 + Math.floor(Math.random() * 1000));

  const res = await client.invoke(new Api.messages.SendMedia({
    peer: channel,
    media: media,
    randomId: randomId,
    message: '',
  }));
  
  // Extract sticker information for return
  const attributes = doc.document ? doc.document.attributes : doc.attributes;
  const stickerAttr = attributes.find(a => a.className === 'DocumentAttributeSticker');
  const stickerInfo = {
    id: id,
    accessHash: accessHash,
    alt: stickerAttr?.alt || '',
    stickerset: stickerAttr?.stickerset,
    maskCoords: stickerAttr?.maskCoords,
    originalDoc: doc
  };
  
  // Return the response along with comprehensive sticker data
  // console.log('Sticker sent!');
  return { res, stickerInfo };
}

if (import.meta.main) {
  await usingTelegram(async ({ client, Api }) => {
    await sendGreetingSticker({ client, Api, chatUsername });
  });
}