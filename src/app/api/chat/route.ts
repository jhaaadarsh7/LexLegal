

import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { LEGAL_MODEL, assertGatewayConfigured } from "@/lib/ai/gateway";
import { SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { getSfsDocument, searchSfs } from "@/lib/riksdagen/client";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertGatewayConfigured();

    /**
     * This is not legal-content caching.
     * It only prevents the model from inventing document IDs.
     */
    const validDocumentIds = new Set<string>();

    const { messages }: { messages: UIMessage[] } = await req.json();

    console.log("\n=================================");
    console.log("NEW CHAT REQUEST");
    console.log("=================================");

    console.log(
      "Last User Message:",
      JSON.stringify(messages[messages.length - 1], null, 2)
    );

    const result = streamText({
      model: LEGAL_MODEL,

      system: SYSTEM_PROMPT,

      messages: await convertToModelMessages(messages),

      /**
       * Enough for:
       * search -> retrieve -> answer
       * or a few searches for multi-topic questions.
       *
       * Lowering this prevents tool loops.
       */
      stopWhen: stepCountIs(8),

      tools: {
        searchSfs: tool({
          description:
            "Search Swedish SFS statutes from Riksdagen. " +
            "Use this only to find possible SFS documents. " +
            "Search results are not legal evidence. " +
            "Use short Swedish legal keywords, usually one to three words.",

          inputSchema: z.object({
            query: z
              .string()
              .min(1)
              .describe(
                "Short Swedish legal search keyword, e.g. mord, brottsbalken, uppsägning, sjuklön, hyresrätt."
              ),
          }),

          execute: async ({ query }) => {
            console.log("\n-------------------------");
            console.log("TOOL EXECUTE -> searchSfs");
            console.log("query:", query);
            console.log("-------------------------\n");

            const results = await searchSfs(query);

            for (const result of results) {
              validDocumentIds.add(result.id);
            }

            console.log("returned results:", results.length);

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
          },
        }),

        getSfsDocument: tool({
          description:
            "Retrieve the current text of an SFS document from Riksdagen. " +
            "Must be called before answering a Swedish legal question. " +
            "Only use IDs returned by searchSfs.",

          inputSchema: z.object({
            id: z
              .string()
              .min(1)
              .describe("Riksdagen document id returned by searchSfs"),

            query: z
              .string()
              .optional()
              .describe(
                "The Swedish keyword used to search, used only to trim the retrieved document text."
              ),
          }),

          execute: async ({ id, query }) => {
            console.log("\n-------------------------");
            console.log("TOOL EXECUTE -> getSfsDocument");
            console.log("id:", id);
            console.log("query:", query);
            console.log("-------------------------\n");

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

            console.log("document found:", !!document);

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
          },
        }),
      },

      onFinish: ({ content, finishReason, usage }) => {
        console.log("\n-------------------------");
        console.log("FINAL RESPONSE content[0]");
        console.log(JSON.stringify(content[0], null, 2));
        console.log("finishReason:", finishReason);
        console.log("usage:", usage);

        if (finishReason !== "stop") {
          console.warn(
            `⚠️  Generation ended with finishReason="${finishReason}" ` +
              `instead of "stop" — the answer may be truncated. ` +
              `Check stepCountIs(8) and maxDuration limits.`
          );
        }

        console.log("-------------------------\n");
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("CHAT ROUTE ERROR:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown server error",
      },
      { status: 500 }
    );
  }
}