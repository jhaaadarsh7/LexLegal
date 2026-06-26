# LexLegal Take-Home Assignment

A working prototype of a Swedish legal assistant designed to answer user questions using live, grounded statutes retrieved from the Riksdagen SFS database.

The core principle is strict grounding: the assistant should never rely on model memory for legal facts. Instead, it follows a structured search-then-retrieve pattern to find and read actual law text before answering, citing the exact SFS reference and title, and falling back honestly if no relevant text can be found.

---

## How to Run

### 1. Install dependencies
Make sure you have `pnpm` installed, then run:
```bash
pnpm install
```

### 2. Configure environment variables
Create a `.env.local` file in the root of the project and add the Vercel AI Gateway key provided:
```env
AI_GATEWAY_API_KEY=Api key here
```

### 3. Start the dev server
Run the development server:
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run the test suite
To execute the unit and integration tests (built with Vitest):
```bash
pnpm test
```

---

## Key Decisions & Engineering Tradeoffs

### 1. Strict Two-Step Tool Execution
Rather than trying to search and retrieve in one massive step, I split the pipeline into two distinct tools: `searchSfs` (for finding search results and titles) and `getSfsDocument` (for fetching the actual document content). 
To prevent the model from inventing document IDs (hallucinating IDs that weren't returned by search), the `POST` handler maintains a request-scoped `validDocumentIds` Set. The retrieval tool rejects any ID not verified by the search step.

### 2. Relevant Text Extraction & Proximity Scoring
Swedish statutes (like the *Socialförsäkringsbalk* or *Jordabalk*) are massive. Feeding whole documents into the LLM would blow the context window, inflate costs, and increase latency. 
Instead of a heavy full-vector RAG setup, I built a lightweight, query-aware extraction algorithm. It scans the raw cleaned text, computes proximity scores around the search query terms, and prioritizes sections containing statute formatting (like chapter markers `kap.` and section paragraphs `§`). It then slices a window of up to 12k characters around the highest-scoring match to send to the model, ensuring the most legally dense passages are preserved.

### 3. User Experience & Tool Visibility
I wanted the user to see the "thought process" of the assistant. I utilized the Vercel AI SDK's UI elements to render the tool calls inline. The user sees a styled status header for `Sökning` and `Hämtning`, followed by expandable sources. The layout supports empty states, loading indicators, active error banners, and the ability to stop/cancel a live generation.

### 4. Google Translate Resilience
During testing, I noticed that when using browser extensions like Google Translate to view the app in English, React would occasionally crash with a `Failed to execute 'insertBefore' on 'Node'` error. This happens because translation extensions mutate the DOM directly. I resolved this by monkey patching `Node.prototype.insertBefore` and `Node.prototype.removeChild` in `layout.tsx` to safely handle elements moved out of the DOM tree by extensions, making the entire application highly resilient to in-browser translations.

---

## What I'd Do With More Time
* **Enhanced RAG Chunking:** For exceptionally large laws, a semantic search (embedding-based) RAG system on chunked versions of the Riksdagen database would yield cleaner snippets than pure string/regex match scoring.
* **Precise Section Citations:** Enhance the parser to return the exact section/paragraph coordinates so the UI can highlight or jump to the exact sentence used to construct the answer.
* **Robust Multi-Turn Memory:** Enhance tool history handling so that if the user asks a follow-up question, the model knows whether to reuse a previously fetched document or execute a fresh search.

---

## What Was New to Me & What I Learned
Working with the Vercel AI SDK (specifically `streamText` and multi-step tool calls) was a great learning experience. Orchestrating the tools so the model autonomously decides to search, wait for the response, choose a document, call the retrieve tool, and only then generate the final answer felt incredibly cohesive. I also gained a much better understanding of how public open data APIs (like Riksdagen) format legal texts and how critical truncation and DOM preparation are for LLM grounding.

---

## Time Spent
I spent roughly **9–10 hours** on this assignment in total.
* **~3 hours** understanding the Riksdagen API response schemas, refining the HTML-to-text cleaning, and writing the regex-based section extractor.
* **~3 hours** implementing the AI SDK multi-step tool calls, caching valid document IDs, and hardening the Swedish system prompts.
* **~2.5 hours** designing the responsive, premium-feeling chat layout, adding states (empty state chips, loading, cancel, error), and patching the Google Translate DOM bug.
* **~1 hour** setting up Vitest, writing unit tests for the core tools/client, and compiling this documentation.