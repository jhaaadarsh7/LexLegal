import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSfs, getSfsDocument } from "@/lib/riksdagen/client";

// Define the tool execute functions exactly as they are defined in route.ts
const makeSearchSfsToolExecute = (validDocumentIds: Set<string>) => {
  return async ({ query }: { query: string }) => {
    const results = await searchSfs(query);

    for (const result of results) {
      validDocumentIds.add(result.id);
    }

    if (results.length === 0) {
      return {
        query,
        count: 0,
        requiresRetrieval: false,
        instruction:
          "No matching SFS documents were found. If another short Swedish legal keyword is clearly appropriate, search once more. Otherwise use the fallback answer.",
        results: [],
      };
    }

    return {
      query,
      count: results.length,
      suggestedId: results[0]?.id,
      suggestedTitle: results[0]?.title,
      suggestedSfsNumber: results[0]?.sfsNumber,
      requiresRetrieval: true,
      instruction:
        "These search results are only for locating documents. Choose the most relevant result and call getSfsDocument before making any legal claim.",
      results,
    };
  };
};

const makeGetSfsDocumentToolExecute = (validDocumentIds: Set<string>) => {
  return async ({ id, query }: { id: string; query?: string }) => {
    if (!validDocumentIds.has(id)) {
      return {
        found: false,
        invalidId: true,
        id,
        instruction:
          "This document ID was not returned by searchSfs in this request. Search first and choose a valid document ID.",
      };
    }

    const document = await getSfsDocument(id, query);

    if (!document) {
      return {
        found: false,
        id,
        instruction:
          "The document could not be retrieved from Riksdagen. Search again only if another specific Swedish legal keyword is clearly appropriate.",
      };
    }

    return {
      found: true,
      retrieved: true,
      instruction:
        "Use only this retrieved document text as legal evidence. If the text supports the answer, answer now. Do not continue searching unless the user's question clearly asks about another separate legal area.",
      document,
    };
  };
};

vi.mock("@/lib/riksdagen/client", () => ({
  searchSfs: vi.fn(),
  getSfsDocument: vi.fn(),
}));

describe("Chat Route Tools", () => {
  let validDocumentIds: Set<string>;
  let searchSfsExecute: ReturnType<typeof makeSearchSfsToolExecute>;
  let getSfsDocumentExecute: ReturnType<typeof makeGetSfsDocumentToolExecute>;

  beforeEach(() => {
    vi.restoreAllMocks();
    validDocumentIds = new Set<string>();
    searchSfsExecute = makeSearchSfsToolExecute(validDocumentIds);
    getSfsDocumentExecute = makeGetSfsDocumentToolExecute(validDocumentIds);
  });

  describe("searchSfs Tool", () => {
    it("should return requiresRetrieval = false when no documents are found", async () => {
      vi.mocked(searchSfs).mockResolvedValue([]);

      const result = await searchSfsExecute({ query: "unknownlaw" });

      expect(searchSfs).toHaveBeenCalledWith("unknownlaw");
      expect(result.count).toBe(0);
      expect(result.requiresRetrieval).toBe(false);
      expect(result.results).toEqual([]);
      expect(validDocumentIds.size).toBe(0);
    });

    it("should register valid SFS document IDs and suggest retrieval", async () => {
      const mockResult = {
        id: "sfs-1991-1047",
        title: "Lag (1991:1047) om sjuklön",
        sfsNumber: "1991:1047",
      };
      vi.mocked(searchSfs).mockResolvedValue([mockResult]);

      const result = await searchSfsExecute({ query: "sjuklön" });

      expect(searchSfs).toHaveBeenCalledWith("sjuklön");
      expect(result.count).toBe(1);
      expect(result.requiresRetrieval).toBe(true);
      expect(result.suggestedId).toBe("sfs-1991-1047");
      expect(result.suggestedTitle).toBe("Lag (1991:1047) om sjuklön");
      expect(validDocumentIds.has("sfs-1991-1047")).toBe(true);
    });
  });

  describe("getSfsDocument Tool", () => {
    it("should block document retrieval if the ID was not returned in a searchSfs step", async () => {
      // sfs-1991-1047 was not added to validDocumentIds
      const result = await getSfsDocumentExecute({ id: "sfs-1991-1047", query: "sjuklön" });

      expect(result.found).toBe(false);
      expect(result.invalidId).toBe(true);
      expect(getSfsDocument).not.toHaveBeenCalled();
    });

    it("should allow document retrieval and return contents if the ID is valid", async () => {
      validDocumentIds.add("sfs-1991-1047");
      const mockDoc = {
        id: "sfs-1991-1047",
        title: "Lag (1991:1047) om sjuklön",
        sfsNumber: "1991:1047",
        text: "Cleaned law text content",
      };
      vi.mocked(getSfsDocument).mockResolvedValue(mockDoc);

      const result = await getSfsDocumentExecute({ id: "sfs-1991-1047", query: "sjuklön" });

      expect(getSfsDocument).toHaveBeenCalledWith("sfs-1991-1047", "sjuklön");
      expect(result.found).toBe(true);
      expect(result.document).toEqual(mockDoc);
    });

    it("should return found = false if the document fails to retrieve from Riksdagen", async () => {
      validDocumentIds.add("sfs-1991-1047");
      vi.mocked(getSfsDocument).mockResolvedValue(null);

      const result = await getSfsDocumentExecute({ id: "sfs-1991-1047", query: "sjuklön" });

      expect(result.found).toBe(false);
      expect(result.document).toBeUndefined();
    });
  });
});
