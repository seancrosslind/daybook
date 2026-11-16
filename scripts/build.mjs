// Fetches every source in feeds.json and writes site/data/items.json.
// Run by the GitHub workflow every hour; run locally with `npm run build`.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEEDS_FILE = process.env.FEEDS_FILE || path.join(ROOT, "feeds.json");
const OUT_FILE = path.join(ROOT, "site", "data", "items.json");

const MAX_PER_FEED = 30; // newest items kept from each source
const MAX_AGE_DAYS = 60; // older items are dropped
const MAX_HTML = 80_000; // characters of article body kept per item
const TIMEOUT_MS = 20_000;
const UA = "Mozilla/5.0 (compatible; Daybook/1.0; personal feed reader)";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => ["item", "entry", "link", "enclosure", "media:content"].includes(name),
});

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const hash = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 12);

function text(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v["#text"] ?? v["@_href"] ?? "");
  return "";
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
function plain(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(html, n = 220) {
  const t = plain(html);
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 30)) + "…";
}

function toDate(v) {
  const d = new Date(text(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime() > Date.now() ? new Date() : d; // some feeds post-date items
}

function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    try {
      return new URL(href).href;
    } catch {
      return "";
    }
  }
}

async function get(url) {
  if (!/^https?:/i.test(url)) return readFile(path.resolve(ROOT, url), "utf8"); // local file, for testing
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The site answered ${res.status} ${res.statusText}`.trim());
  return res.text();
}

const looksLikeFeed = (body) => /<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 4000));

// A pasted website or YouTube channel address is turned into its feed address.
function discover(body, pageUrl) {
  if (/(^|\.)youtube\.com$/i.test(new URL(pageUrl).hostname)) {
    const id = body.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/) || body.match(/channel_id=(UC[\w-]{20,})/);
    if (id) return `https://www.youtube.com/feeds/videos.xml?channel_id=${id[1]}`;
  }
  for (const tag of body.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i);
    if (href) return absolute(href[1].replace(/&amp;/g, "&"), pageUrl);
  }
  return null;
}

function youtubeFeedFor(url) {
  const m = url.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i);
  return m ? `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}` : null;
}

function pickLink(links, base) {
  const list = arr(links);
  for (const l of list) {
    if (typeof l === "object" && l["@_href"] && (!l["@_rel"] || l["@_rel"] === "alternate")) return absolute(l["@_href"], base);
  }
  for (const l of list) {
    const t = typeof l === "object" ? l["@_href"] || l["#text"] : l;
    if (t) return absolute(String(t), base);
  }
  return "";
}

function firstImage(html) {
  const m = String(html || "").match(/<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["']/i);
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

function parseFeed(xml, source, feedUrl) {
  const doc = parser.parse(xml);
  const rss = doc.rss?.channel || doc["rdf:RDF"]?.channel;
  const atom = doc.feed;
  if (!rss && !atom) throw new Error("This address did not return a feed");

  const rawItems = rss ? arr(doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item) : arr(atom.entry);
  const title = plain(text(rss ? rss.title : atom.title));
  const site = rss ? pickLink(rss.link, feedUrl) : pickLink(atom.link, feedUrl);
  const isYouTube = /youtube\.com\/feeds/i.test(feedUrl);

  const items = [];
  for (const it of rawItems) {
    const media = it["media:group"] || it;
    const videoId = text(it["yt:videoId"]);
    const link = pickLink(it.link, site || feedUrl) || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    const guid = text(it.guid) || text(it.id) || link;
    if (!link && !guid) continue;

    const body = text(it["content:encoded"]) || text(it.content) || text(it.description) || text(it.summary) || text(media["media:description"]) || "";
    const enclosure = arr(it.enclosure).find((e) => /^audio\//i.test(e?.["@_type"] || "") || /\.(mp3|m4a|ogg)(\?|$)/i.test(e?.["@_url"] || ""));
    const thumb = media["media:thumbnail"]?.["@_url"] || arr(it["media:content"]).find((m) => /^image\//i.test(m?.["@_type"] || "") || m?.["@_medium"] === "image")?.["@_url"] || text(it["itunes:image"]?.["@_href"]) || firstImage(body);
    const date = toDate(it.pubDate ?? it.published ?? it["dc:date"] ?? it.updated);

    let kind = source.kind || "article";
    if (isYouTube || videoId) kind = "video";
    else if (enclosure && !source.kind) kind = "podcast";

    const html = isYouTube ? String(body).replace(/[<>]/g, "") : body; // video notes are plain text
    items.push({
      id: hash(guid || link),
      kind,
      title: plain(text(it.title)) || "(untitled)",
      url: link,
      published: (date || new Date(0)).toISOString(),
      author: plain(text(it["dc:creator"]) || text(it.author?.name ?? it.author) || text(it["itunes:author"])),
      excerpt: excerpt(body),
      html: html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html,
      image: /^https:/.test(thumb || "") ? thumb : "",
      audio: enclosure?.["@_url"] || "",
      videoId,
    });
  }
  return { title, site, items };
}

async function loadSource(source) {
  let url = youtubeFeedFor(source.url) || source.url;
  let body = await get(url);
  if (!looksLikeFeed(body)) {
    const found = discover(body, url);
    if (!found) throw new Error("No feed found at this address. Try the site's RSS link instead.");
    url = found;
    body = await get(url);
  }
  return { ...parseFeed(body, source, url), feedUrl: url };
}

async function main() {
  const sources = JSON.parse(await readFile(FEEDS_FILE, "utf8"));
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const feeds = [];
  const items = [];

  const results = await Promise.allSettled(sources.map(loadSource));
  results.forEach((r, i) => {
    const source = sources[i];
    const id = hash(source.url);
    if (r.status === "rejected") {
      const reason = r.reason?.name === "TimeoutError" ? "The site took too long to answer" : r.reason?.message || "Could not be fetched";
      feeds.push({ id, name: source.name || source.url, url: source.url, kind: source.kind || "article", ok: false, error: reason, count: 0 });
      console.warn(`✗ ${source.name || source.url}: ${reason}`);
      return;
    }
    const { title, site, items: found } = r.value;
    const name = source.name || title || source.url;
    const kept = found
      .filter((it) => new Date(it.published).getTime() === 0 || new Date(it.published).getTime() >= cutoff)
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, MAX_PER_FEED);
    for (const it of kept) items.push({ ...it, id: `${id.slice(0, 4)}${it.id}`, feed: id, source: name });
    feeds.push({ id, name, url: source.url, site, kind: kept[0]?.kind || source.kind || "article", ok: true, count: kept.length });
    console.log(`✓ ${name}: ${kept.length} items`);
  });

  items.sort((a, b) => b.published.localeCompare(a.published));
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), feeds, items }));
  console.log(`Wrote ${items.length} items from ${feeds.filter((f) => f.ok).length}/${feeds.length} sources`);
  if (feeds.length && feeds.every((f) => !f.ok)) process.exitCode = 1; // nothing worked: keep the last good site
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
