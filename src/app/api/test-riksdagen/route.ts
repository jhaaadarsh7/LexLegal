import { searchSfs, getSfsDocument } from "@/lib/riksdagen/client";

export async function GET() {
  try {
    const query = "semester";
    const results = await searchSfs(query);

    const first = results[0] ? await getSfsDocument(results[0].id) : null;

    return Response.json({
      query,
      resultCount: results.length,
      results,
      firstDocumentPreview: first
        ? {
            id: first.id,
            title: first.title,
            sfsNumber: first.sfsNumber,
            textPreview: first.text.slice(0, 800),
          }
        : null,
    });
  } catch (error) {
    console.error("test-riksdagen route error:", error);

    return Response.json(
      {
        error: "Failed to fetch Riksdagen data",
      },
      { status: 500 }
    );
  }
}