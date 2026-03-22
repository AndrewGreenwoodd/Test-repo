# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**UIGen** is an AI-powered React component generator with live preview. Users describe components in a chat interface; Claude generates JSX files into a virtual (in-memory) file system, which are then Babel-transpiled and rendered in an iframe.

## Commands

```bash
npm run setup        # First-time: install deps, generate Prisma client, run migrations
npm run dev          # Start dev server (http://localhost:3000) with Turbopack
npm run build        # Production build
npm run lint         # ESLint (Next.js config)
npm test             # Run all Vitest tests
npm test -- src/path/to/test.ts  # Run a single test file
npm run db:reset     # Reset and re-run all Prisma migrations
```

The dev server requires `node-compat.cjs` loaded via `NODE_OPTIONS` (already in the npm scripts).

## Environment

Create a `.env` file at the root:
```
ANTHROPIC_API_KEY=your_key_here
```
Without this key, the app falls back to a mock provider that returns static example components.

## Architecture

### Request Flow

1. User types in `ChatInterface` → `ChatContext` streams to `/api/chat`
2. `/api/chat/route.ts` calls Claude (`claude-haiku-4-5`) via Vercel AI SDK with two tools: `str_replace_editor` (create/view/edit files) and `file_manager`
3. Tool calls update `FileSystemContext` (in-memory `Map`-based virtual FS)
4. `PreviewFrame` watches the virtual FS, picks up `/App.jsx` as the entry point, Babel-transpiles all JSX/TSX via `src/lib/transform/jsx-transformer.ts`, and renders in an iframe using import maps pointing to `esm.sh`
5. If the user is authenticated, the project (messages + file state) is persisted to SQLite via Prisma

### Key Abstractions

| Module | Purpose |
|--------|---------|
| `src/lib/file-system.ts` | Virtual FS class — `createFile`, `replaceInFile`, `insertInFile`, etc. Serializable to JSON for DB persistence |
| `src/lib/contexts/file-system-context.tsx` | React context wrapping the virtual FS; drives both the editor and preview |
| `src/lib/contexts/chat-context.tsx` | Manages messages, streaming state, and API calls |
| `src/lib/provider.ts` | Returns real Anthropic provider or mock (no API key). Mock simulates streaming with delays |
| `src/lib/transform/jsx-transformer.ts` | Babel standalone transpiles JSX→JS, generates blob URLs + HTML with import maps |
| `src/lib/prompts/generation.tsx` | System prompt for Claude: instructs it to use `/App.jsx` as root, Tailwind for styling, `@/` alias for local imports |
| `src/lib/auth.ts` | JWT sessions (HS256, 7-day, HTTP-only cookies) |
| `src/actions/` | Next.js server actions for auth (sign in/up/out) and project CRUD |

### Database Schema (SQLite via Prisma)

- `User`: id, email, hashed password
- `Project`: belongs to optional `User`; stores `messages` and `data` (virtual FS snapshot) as JSON strings

Anonymous users can generate components without an account; projects are only persisted for registered users.

### AI Generation Rules (from system prompt)

- Entry point must be `/App.jsx`
- Use Tailwind CSS for all styling
- Local imports use `@/` alias (e.g., `@/components/Button`)
- External packages are available via `esm.sh` import maps in the iframe
