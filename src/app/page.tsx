"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

// Quick-pick chips for the empty state — Swedish legal questions
const EXAMPLE_CHIPS = [
  "Vad säger lagen om semester?",
  "Vad gäller vid uppsägning?",
  "Vilka rättigheter har en hyresgäst?",
  "Hur fungerar föräldraledighet?",
  "Vad är mina rättigheter vid sjukdom?",
];

/**
 * SFS numbers (e.g. "1991:1047") are identifiers, not prose — render them
 * in a monospace utility face wherever they appear, so the eye learns to
 * recognize "this is a verifiable statute reference" at a glance.
 */
function SfsTag({ sfsNumber }: { sfsNumber?: string }) {
  if (!sfsNumber) return null;
  return (
    <span className="rounded-[3px] border border-[#D8C9A0] bg-[#FAEEDA] px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-tight text-[#7A4E12]">
      {sfsNumber}
    </span>
  );
}

function SearchSfsTool({ part }: { part: any }) {
  return (
    <Tool>
      <ToolHeader
        type={part.type}
        state={part.state}
        title="Sökning i SFS-databasen"
      />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={
            part.output
              ? `${part.output.count ?? 0} dokument hittades för "${part.output.query ?? ""}"`
              : undefined
          }
          errorText={part.errorText}
        />
      </ToolContent>
    </Tool>
  );
}

function GetSfsDocumentTool({ part }: { part: any }) {
  const document = part.output?.document;

  return (
    <Tool>
      <ToolHeader
        type={part.type}
        state={part.state}
        title="Hämtning av rättskälla"
      />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={
            document
              ? `${document.sfsNumber ?? "SFS-nummer saknas"} — ${document.title ?? "Titel saknas"}`
              : part.output?.found === false
                ? "Dokumentet kunde inte hämtas från Riksdagen."
                : undefined
          }
          errorText={part.errorText}
        />
      </ToolContent>
    </Tool>
  );
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop, error } = useChat();

  const isLoading = status === "submitted" || status === "streaming";

  function handleSubmit(message: { text: string }) {
    if (!message.text?.trim() || isLoading) return;
    sendMessage({ text: message.text });
    setInput("");
  }

  function handleChipClick(text: string) {
    setInput(text);
  }

  return (
    <div className="flex h-screen w-full flex-col bg-[#F8F5EF]">
      {/* Letterhead-style header: double rule echoes an official document seal */}
      <header className="border-b-[3px] border-[#0D1B2A] bg-white">
        <div className="border-b border-[#E8E3DB] px-6 py-1">
          <p className="text-center text-[9px] font-medium uppercase tracking-[0.25em] text-[#B0A99E]">
            Grundat i Riksdagens SFS-databas
          </p>
        </div>
        <div className="flex items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#B8962E] text-[#B8962E]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[18px] w-[18px]">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div>
              <p className="font-serif text-[17px] leading-none text-[#0D1B2A]">
                Lex<span className="text-[#B8962E]">Legal</span>
              </p>
              <p className="mt-0.5 text-[10px] text-[#9A948B]">
                Svarar enbart med stöd i hämtad lagtext
              </p>
            </div>
          </div>
          <span className="rounded-[3px] border border-[#0D1B2A]/15 bg-[#F8F5EF] px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[#0D1B2A]">
            SFS · LIVE
          </span>
        </div>
      </header>

      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState title="" description="">
              <div className="mx-auto max-w-md text-center">
                <div className="mx-auto mb-5 h-px w-10 bg-[#B8962E]" />
                <h1 className="font-serif text-[28px] leading-tight text-[#0D1B2A]">
                  Fråga om svensk lag
                </h1>
                <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-[#8896A7]">
                  Assistenten söker i Riksdagens SFS-databas och svarar
                  enbart med stöd i hämtad lagtext.
                </p>

                <div className="mt-7 flex flex-wrap justify-center gap-2">
                  {EXAMPLE_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleChipClick(chip)}
                      className="rounded-full border border-[#D8D3CB] bg-white px-3.5 py-1.5 text-xs text-[#3A5068] transition-all hover:border-[#0D1B2A] hover:bg-[#0D1B2A] hover:text-[#F9F6F0]"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.parts.map((part: any, i: number) => {
                    switch (part.type) {
                      case "text":
                        return (
                          <MessageResponse key={`${message.id}-text-${i}`}>
                            {part.text}
                          </MessageResponse>
                        );

                      case "tool-searchSfs":
                        return (
                          <SearchSfsTool
                            key={part.toolCallId ?? `${message.id}-search-${i}`}
                            part={part}
                          />
                        );

                      case "tool-getSfsDocument":
                        return (
                          <GetSfsDocumentTool
                            key={part.toolCallId ?? `${message.id}-doc-${i}`}
                            part={part}
                          />
                        );

                      default:
                        return null;
                    }
                  })}

                  {/* Citations: styled as a wax-seal stamp, not a generic pill */}
                  {message.role === "assistant" &&
                    (() => {
                      const sourceParts = message.parts.filter(
                        (p: any) =>
                          p.type === "tool-getSfsDocument" && p.output?.document
                      );

                      if (sourceParts.length === 0) return null;

                      return (
                        <div className="mt-3 border-t border-dashed border-[#E2DDD6] pt-3">
                          <Sources>
                            <SourcesTrigger count={sourceParts.length}>
                              {sourceParts.length === 1
                                ? "1 källa använd"
                                : `${sourceParts.length} källor använda`}
                            </SourcesTrigger>
                            <SourcesContent>
                              {sourceParts.map((p: any) => {
                                const doc = p.output.document;
                                return (
                                  <Source
                                    key={p.toolCallId ?? doc.sfsNumber}
                                    href={`https://data.riksdagen.se/dokument/${doc.id}.json`}
                                    title={doc.title}
                                  >
                                    <span className="flex items-center gap-2">
                                      <SfsTag sfsNumber={doc.sfsNumber} />
                                      <span>{doc.title}</span>
                                    </span>
                                  </Source>
                                );
                              })}
                            </SourcesContent>
                          </Sources>
                        </div>
                      );
                    })()}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <div className="mx-6 mb-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Ett fel uppstod: {error.message}
        </div>
      )}

      <div className="border-t border-[#E8E3DB] bg-white px-6 py-4">
        <PromptInput
          onSubmit={(message, event) => {
            event.preventDefault();
            handleSubmit({ text: input });
          }}
          className="mx-auto flex max-w-3xl items-end gap-3"
        >
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Skriv din fråga på svenska — t.ex. Vad gäller vid avsked utan saklig grund?"
            disabled={isLoading}
            rows={2}
            className="flex-1 border-[#D8D3CB] bg-[#F9F6F0] focus-visible:border-[#B8962E] focus-visible:ring-[#B8962E]/15"
          />

          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="h-11 flex-shrink-0 rounded-xl border border-[#D8D3CB] px-4 text-[12px] font-medium text-[#5A6B7A] transition-all hover:bg-[#F0EDE8]"
            >
              Stoppa
            </button>
          ) : (
            <PromptInputSubmit
              status={status}
              disabled={!input.trim()}
              className="h-11 w-11 flex-shrink-0 bg-[#0D1B2A] hover:bg-[#1A3350]"
            />
          )}
        </PromptInput>

        <p className="mt-2 text-center text-[10px] text-[#C5C0B8]">
          Svarar enbart med stöd i hämtad lagtext
        </p>
      </div>
    </div>
  );
}