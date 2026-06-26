
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
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => term.length >= 3);
}

/**
 * Finds query occurrences and prefers locations that look like actual statute
 * text rather than table of contents or metadata.
 *
 * This is intentionally generic:
 * - no pre-coded legal answers
 * - no hardcoded chapter mappings
 * - no mocked law text
 */
function extractAroundBestQueryMatch(
  text: string,
  query?: string,
  maxLength = 12000
): string | null {
  const terms = getQueryTerms(query);
  if (terms.length === 0) return null;

  const lowerText = text.toLowerCase();

  const candidates: { index: number; score: number }[] = [];

  for (const term of terms) {
    let idx = lowerText.indexOf(term);

    while (idx !== -1) {
      const before = text.slice(Math.max(0, idx - 1500), idx);
      const after = text.slice(idx, Math.min(text.length, idx + 3000));
      const window = `${before}\n${after}`;

      let score = 0;

      // Prefer actual statute body text containing section markers.
      if (/\n\s*\d+\s*§/.test(window)) score += 20;
      if (/\n\s*\d+\s*a\s*§/i.test(window)) score += 15;

      // Prefer chapter-like context.
      if (/\n\s*\d+\s+kap\./i.test(window)) score += 10;

      // Prefer dense matches.
      for (const otherTerm of terms) {
        if (window.toLowerCase().includes(otherTerm)) {
          score += 3;
        }
      }

      // Penalize very early metadata/table-of-contents area slightly.
      if (idx < 2000) score -= 5;

      candidates.push({ index: idx, score });

      idx = lowerText.indexOf(term, idx + term.length);
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);

  const bestIndex = candidates[0].index;

  const start = Math.max(0, bestIndex - 3000);
  const end = Math.min(text.length, start + maxLength);

  return text.slice(start, end);
}

/**
 * Generic chapter extraction when the best query match appears inside a chapter.
 * This tries to include the surrounding chapter body without hardcoding what
 * that chapter means legally.
 */
function expandToNearbyChapter(text: string, snippet: string): string {
  const snippetIndex = text.indexOf(snippet);
  if (snippetIndex === -1) return snippet;

  const before = text.slice(0, snippetIndex);
  const chapterMatches = [...before.matchAll(/\n\s*\d+\s+kap\.[^\n]*/gi)];

  if (chapterMatches.length === 0) {
    return snippet;
  }

  const lastChapter = chapterMatches[chapterMatches.length - 1];
  const chapterStart = lastChapter.index ?? snippetIndex;

  const afterChapter = text.slice(chapterStart + 1);
  const nextChapterMatch = /\n\s*\d+\s+kap\.[^\n]*/i.exec(afterChapter);

  if (!nextChapterMatch || nextChapterMatch.index === undefined) {
    return text.slice(chapterStart, Math.min(text.length, chapterStart + 12000));
  }

  const chapterEnd = chapterStart + 1 + nextChapterMatch.index;

  return text.slice(chapterStart, Math.min(chapterEnd, chapterStart + 12000));
}

function extractRelevantSection(
  text: string,
  title: string,
  query?: string
): string {
  const lowerTitle = title.toLowerCase();
  const lowerQuery = query?.toLowerCase();

  /**
   * If the query is the actual document title, returning the beginning is fine.
   */
  if (lowerQuery && lowerTitle.includes(lowerQuery)) {
    return truncateText(text, 12000);
  }

  const queryBasedSnippet = extractAroundBestQueryMatch(text, query, 12000);

  if (queryBasedSnippet && queryBasedSnippet.length > 300) {
    const expanded = expandToNearbyChapter(text, queryBasedSnippet);
    return truncateText(expanded, 12000);
  }

  return truncateText(text, 12000);
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

  /**
   * Generic ranking only.
   * No hardcoded legal conclusions.
   */
  if (normalizedTitle.includes(normalizedQuery)) score += 500;
  if (normalizedSfsNumber.includes(normalizedQuery)) score += 300;

  const queryTerms = getQueryTerms(query);

  for (const term of queryTerms) {
    if (normalizedTitle.includes(term)) score += 100;
    if (normalizedSfsNumber.includes(term)) score += 50;
  }

  if (result.id.startsWith("sfs-")) score += 25;

  return score;
}

export async function searchSfs(query: string): Promise<SfsSearchResult[]> {
  const trimmedQuery = query.trim();

  console.log("\n========================");
  console.log("SEARCH TOOL CALLED");
  console.log("Query:", trimmedQuery);
  console.log("========================\n");

  if (!trimmedQuery) {
    return [];
  }

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
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Riksdagen search failed: ${response.status}`);
  }

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

  if (!trimmedId) {
    return null;
  }

  const url =
    `${RIKSDAGEN_BASE_URL}/dokument/` +
    `${encodeURIComponent(trimmedId)}.json`;

  console.log("Retrieve URL:", url);

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    console.log("Retrieve failed:", response.status);
    return null;
  }

  const data = await response.json();
  const document = data?.dokumentstatus?.dokument;

  if (!document) {
    console.log("No document found");
    return null;
  }

  const html = document.html || "";
  const cleanedHtml = cleanHtml(html);

  const cleanedText = extractRelevantSection(
    cleanedHtml,
    document.titel || "",
    query
  );

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