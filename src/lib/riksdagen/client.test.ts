import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSfs, getSfsDocument } from "./client";

describe("Riksdagen API Client & Tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchSfs", () => {
    it("should return empty list when query is empty", async () => {
      const results = await searchSfs("");
      expect(results).toEqual([]);
    });

    it("should fetch, parse and rank SFS search results correctly", async () => {
      const mockApiResponse = {
        dokumentlista: {
          dokument: [
            {
              id: "sfs-1991-1047",
              titel: "Lag (1991:1047) om sjuklön",
              beteckning: "1991:1047",
              datum: "1991-06-13",
            },
            {
              id: "sfs-2010-110",
              titel: "Socialförsäkringsbalk (2010:110)",
              beteckning: "2010:110",
              datum: "2010-03-04",
            },
          ],
        },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });
      global.fetch = fetchMock;

      const results = await searchSfs("sjuklön");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain("sok=sjukl%C3%B6n");
      expect(fetchMock.mock.calls[0][0]).toContain("doktyp=sfs");

      expect(results).toHaveLength(2);
      // Sjuklön should be ranked first because its title matches the query exactly
      expect(results[0].id).toBe("sfs-1991-1047");
      expect(results[0].title).toBe("Lag (1991:1047) om sjuklön");
      expect(results[1].id).toBe("sfs-2010-110");
    });
  });

  describe("getSfsDocument", () => {
    it("should return null if ID is empty", async () => {
      const doc = await getSfsDocument("");
      expect(doc).toBeNull();
    });

    it("should retrieve, clean and extract relevant section from document HTML", async () => {
      const mockApiResponse = {
        dokumentstatus: {
          dokument: {
            id: "sfs-1991-1047",
            titel: "Lag (1991:1047) om sjuklön",
            beteckning: "1991:1047",
            html: `
              <html>
                <body>
                  <p>Inledande bestämmelser</p>
                  <p>1 § En arbetstagare har enligt vad som följer av denna lag rätt att vid sjukdom behålla lön och andra anställningsförmåner (sjuklön).</p>
                  <p>2 § Avtal som innebär att arbetstagares rättigheter inskränks är ogiltiga.</p>
                </body>
              </html>
            `,
          },
        },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });
      global.fetch = fetchMock;

      const doc = await getSfsDocument("sfs-1991-1047", "sjuklön");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain("sfs-1991-1047.json");
      expect(doc).not.toBeNull();
      expect(doc?.id).toBe("sfs-1991-1047");
      expect(doc?.title).toBe("Lag (1991:1047) om sjuklön");
      expect(doc?.sfsNumber).toBe("1991:1047");
      // The text extraction should contain sections matching the query terms
      expect(doc?.text).toContain("sjuklön");
      expect(doc?.text).toContain("arbetstagare");
    });
  });
});
