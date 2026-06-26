

import { cleanHtml, truncateText } from "./clean-html";
import type { SfsDocument, SfsSearchResult } from "./types";

const RIKSDAGEN_BASE_URL = "https://data.riksdagen.se";
const USER_AGENT = "LexLegal-TakeHome/1.0 (Next.js server-side)";

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getQueryTerms(query?: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3);
}

/**
 * Returns { start, end } indices of the best chapter window around
 * the highest-scoring query match. Never re-searches for the snippet
 * by value — works entirely with indices.
 */
function findBestChapterWindow(
  text: string,
  query: string,
  maxLength = 12000
): { start: number; end: number } | null {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return null;

  const lowerText = text.toLowerCase();
  const candidates: { index: number; score: number }[] = [];

  for (const term of terms) {
    let idx = lowerText.indexOf(term);
    while (idx !== -1) {
      const winStart = Math.max(0, idx - 1500);
      const winEnd = Math.min(text.length, idx + 3000);
      const window = text.slice(winStart, winEnd);

      let score = 0;
      if (/\n\s*\d+\s*§/.test(window)) score += 20;
      if (/\n\s*\d+\s*a\s*§/i.test(window)) score += 15;
      if (/\n\s*\d+\s+kap\./i.test(window)) score += 10;
      for (const other of terms) {
        if (window.toLowerCase().includes(other)) score += 3;
      }
      if (idx < 2000) score -= 5;

      candidates.push({ index: idx, score });
      idx = lowerText.indexOf(term, idx + term.length);
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const bestIdx = candidates[0].index;

  // Walk backward to find the start of the enclosing chapter
  const before = text.slice(0, bestIdx);
  const chapterMatches = [...before.matchAll(/\n\s*\d+\s+kap\.[^\n]*/gi)];

  let chapterStart: number;
  if (chapterMatches.length > 0) {
    const last = chapterMatches[chapterMatches.length - 1];
    chapterStart = last.index ?? Math.max(0, bestIdx - 3000);
  } else {
    chapterStart = Math.max(0, bestIdx - 3000);
  }

  // Walk forward to find the end of the enclosing chapter
  const afterChapter = text.slice(chapterStart + 1);
  const nextChapter = /\n\s*\d+\s+kap\.[^\n]*/i.exec(afterChapter);

  let chapterEnd: number;
  if (nextChapter && nextChapter.index !== undefined) {
    chapterEnd = chapterStart + 1 + nextChapter.index;
  } else {
    chapterEnd = text.length;
  }

  // Enforce a minimum window size of 500 chars.
  // When the chapter boundaries land on adjacent headers (e.g. in a
  // table of contents), the window can be as small as 1 character.
  const MIN_WINDOW = 500;
  if (chapterEnd - chapterStart < MIN_WINDOW) {
    chapterEnd = Math.min(text.length, chapterStart + maxLength);
  }

  // Clamp to maxLength
  const end = Math.min(chapterEnd, chapterStart + maxLength);
  return { start: chapterStart, end };
}

function extractRelevantSection(
  text: string,
  title: string,
  query?: string
): string {
  if (!text || text.length < 10) return text;

  if (query) {
    const window = findBestChapterWindow(text, query, 12000);
    if (window) {
      const extracted = text.slice(window.start, window.end);
      console.log("Chapter window found, length:", extracted.length);

      // Quality gate: only use the chapter window if it contains
      // meaningful content. Otherwise fall back to the full text.
      if (extracted.trim().length > 200) {
        return truncateText(extracted, 12000);
      }
      console.log("Chapter window too small, falling back to full text");
    } else {
      console.log("No chapter window found — returning full text truncated");
    }
  }

  return truncateText(text, 12000);
}

function extractRawText(document: any): string {
  const sources = [
    document.html,
    document.text,
    document.anforande?.anforandetext,
    document.filbilaga?.text,
  ];

  for (const source of sources) {
    if (typeof source === "string" && source.trim().length > 200) {
      const cleaned = cleanHtml(source);
      if (cleaned.length > 200) {
        console.log("Text source: document field, cleaned length:", cleaned.length);
        return cleaned;
      }
    }
  }

  const fallback = Object.values(document)
    .filter((v): v is string => typeof v === "string" && v.length > 100)
    .map((v) => cleanHtml(v))
    .join("\n\n");

  console.log("Text source: fallback concat, length:", fallback.length);
  return fallback;
}

function scoreSearchResult(
  result: SfsSearchResult,
  query: string,
  index: number
): number {
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(result.title);
  const normalizedSfsNumber = normalizeText(result.sfsNumber);

  let score = 1000 - index;
  if (normalizedTitle.includes(normalizedQuery)) score += 500;
  if (normalizedSfsNumber.includes(normalizedQuery)) score += 300;

  for (const term of getQueryTerms(query)) {
    if (normalizedTitle.includes(term)) score += 100;
    if (normalizedSfsNumber.includes(term)) score += 50;
  }

  if (result.id.startsWith("sfs-")) score += 25;

  // Boost primary legislation (balkar and named lagar) over förordningar.
  // Balkar are comprehensive statutes that cover entire legal areas —
  // they are almost always the correct primary source.
  if (/balk\b/i.test(normalizedTitle)) score += 300;
  if (/^lag\s/i.test(normalizedTitle)) score += 150;

  // Penalize förordningar — they are secondary regulations, rarely the
  // primary source a user needs for general legal questions.
  if (/förordning/i.test(normalizedTitle)) score -= 200;

  return score;
}

export async function searchSfs(query: string): Promise<SfsSearchResult[]> {
  const trimmedQuery = query.trim();

  console.log("\n========================");
  console.log("SEARCH TOOL CALLED");
  console.log("Query:", trimmedQuery);
  console.log("========================\n");

  if (!trimmedQuery) return [];

  const url =
    `${RIKSDAGEN_BASE_URL}/dokumentlista/` +
    `?sok=${encodeURIComponent(trimmedQuery)}` +
    `&doktyp=sfs` +
    `&utformat=json` +
    `&sort=rel` +
    `&sortorder=desc` +
    `&a=s`;

  console.log("Search URL:", url);

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Riksdagen search failed: ${response.status}`);

  const data = await response.json();
  const docs = toArray(data?.dokumentlista?.dokument);

  console.log("Results found:", docs.length);

  const results: SfsSearchResult[] = docs
    .map((doc: any) => ({
      id: doc.id || doc.dok_id || "",
      title: doc.titel || "",
      sfsNumber: doc.beteckning || doc.dokumentnamn || "",
      publishedAt: doc.datum || "",
    }))
    .filter((doc) => doc.id && doc.title);

  const rankedResults = results
    .map((result, index) => ({
      result,
      score: scoreSearchResult(result, trimmedQuery, index),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ result }) => result);

  console.log(
    "Top Results:",
    rankedResults.slice(0, 5).map((r) => ({
      id: r.id,
      title: r.title,
      sfsNumber: r.sfsNumber,
    }))
  );

  return rankedResults.slice(0, 5);
}

export async function getSfsDocument(
  id: string,
  query?: string
): Promise<SfsDocument | null> {
  const trimmedId = id.trim();

  console.log("\n========================");
  console.log("RETRIEVE TOOL CALLED");
  console.log("Document ID:", trimmedId);
  console.log("Query:", query);
  console.log("========================\n");

  if (!trimmedId) return null;

  const url =
    `${RIKSDAGEN_BASE_URL}/dokument/` +
    `${encodeURIComponent(trimmedId)}.json`;

  console.log("Retrieve URL:", url);

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    console.log("Retrieve failed:", response.status);
    return null;
  }

  const data = await response.json();
  const document = data?.dokumentstatus?.dokument;

  if (!document) {
    console.log("No document found in response");
    return null;
  }

  console.log("html field length:", (document.html ?? "").length);
  console.log("text field length:", (document.text ?? "").length);

  const rawText = extractRawText(document);
  const cleanedText = extractRelevantSection(rawText, document.titel || "", query);

  console.log("Document Title:", document.titel);
  console.log("SFS Number:", document.beteckning);
  console.log("Extracted Length:", cleanedText.length);
  console.log("\nTEXT PREVIEW:");
  console.log(cleanedText.slice(0, 500));
  console.log("\n========================\n");

  return {
    id: document.id || trimmedId,
    title: document.titel || "",
    sfsNumber: document.beteckning || document.dokumentnamn || "",
    text: cleanedText,
  };
}