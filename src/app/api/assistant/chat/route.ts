import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireUser, checkOrigin } from '@/lib/supabase/server';
import { loadWorkspace } from '@/lib/supabase/workspace';
import { ConfigurationError, DatabaseReadinessError } from '@/lib/supabase/config';
import { AssistantError } from '@/lib/assistant/openai';
import { businessAssistantConfig } from '@/lib/assistant/config';
import { chatContextSchema, type ChatMessage } from '@/lib/assistant/chat-schema';
import { chatStore } from '@/lib/assistant/chat-store';
import { runBusinessAssistant } from '@/lib/assistant/business-agent';
import { chatFiles, clearChatFiles } from '@/lib/assistant/chat-files';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const options = { headers: { 'Cache-Control': 'no-store' } };
const inputSchema = z.strictObject({
  requestId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(4000),
  selectedItemId: z.string().uuid().nullable().default(null),
  fileIds: z.array(z.string().uuid()).max(10).default([]),
  drafts: chatContextSchema,
});

export async function GET() {
  try {
    const user = await requireUser();
    const config = businessAssistantConfig();
    try {
      const state = await chatStore(user.id, 'load');
      const ids = [...new Set((state?.messages || []).flatMap((m) => m.fileIds || []))];
      const files = ids.length ? await chatFiles(user.id, ids) : [];
      return NextResponse.json(
        {
          ...config,
          ready: true,
          ...state,
          messages: state?.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            fileIds: m.fileIds,
            files: files
              .filter((f) => m.fileIds?.includes(f.id))
              .map(({ id, name, mime }) => ({ id, name, mime })),
          })),
        },
        options,
      );
    } catch (error) {
      if (error instanceof AssistantError && error.status === 503)
        return NextResponse.json(
          {
            ...config,
            ready: false,
            setup: error.message,
            revision: 0,
            messages: [],
            response: null,
          },
          options,
        );
      throw error;
    }
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const revision = z
      .number()
      .int()
      .nonnegative()
      .parse(Number(new URL(request.url).searchParams.get('revision')));
    const state = await chatStore(user.id, 'clear', { revision });
    try {
      const filesRemoved = await clearChatFiles(user.id);
      return NextResponse.json({ ...state, filesRemoved, attachmentsCleared: true }, options);
    } catch {
      return NextResponse.json(
        {
          ...state,
          attachmentsCleared: false,
          notice:
            'Conversation cleared. Some private attachments could not be removed; retry Clear chat. Saved business records are unchanged.',
        },
        options,
      );
    }
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let lease: string | undefined, actor: string | undefined, requestId: string | undefined;
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    actor = user.id;
    if (!request.body) throw new AssistantError('Enter a message.');
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 3000000) {
        await reader.cancel();
        throw new AssistantError('Review a smaller file batch before chatting about it.', 413);
      }
      chunks.push(value);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AssistantError(
        'The message could not be read. Retry without changing saved records.',
      );
    }
    const input = inputSchema.parse(raw);
    requestId = input.requestId;
    const w = await loadWorkspace(user.id);
    const files = await chatFiles(user.id);
    if (input.fileIds.some((id) => !files.some((f) => f.id === id)))
      throw new AssistantError('Choose attachments in your own workspace.', 404);
    if (input.selectedItemId && !w.items.some((i) => i.id === input.selectedItemId))
      throw new AssistantError('Choose an item in your current workspace.');
    if (!businessAssistantConfig().enabled)
      throw new AssistantError(
        'Business chat needs OPENAI_API_KEY in the server environment.',
        503,
      );
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify({
          message: input.message,
          selectedItemId: input.selectedItemId,
          fileIds: input.fileIds,
          drafts: input.drafts,
        }),
      )
      .digest('hex');
    const claim = await chatStore(user.id, 'claim', {
      requestId: input.requestId,
      revision: input.revision,
      inputHash,
    });
    if (claim?.replayed && claim.response)
      return NextResponse.json(
        { response: claim.response, revision: claim.revision, replayed: true },
        options,
      );
    if (!claim?.lease)
      throw new AssistantError('The conversation could not be reserved. Reload and retry.', 409);
    lease = claim.lease;
    const rows = [...(input.drafts.batch?.rows || []), ...(input.drafts.historyBatch?.rows || [])];
    const context = JSON.stringify({
      files: [
        ...files
          .filter((f) => input.fileIds.includes(f.id))
          .map((f) => ({ id: f.id, name: f.name, type: f.mime })),
        ...[
          ...(input.drafts.batch?.screenshots || []),
          ...(input.drafts.historyBatch?.screenshots || []),
        ].map((s) => ({
          name: s.name,
          type: s.sourceType || 'image',
          hash: s.hash,
          message: s.extraction.message,
        })),
      ],
      pendingRecordCount: rows.length,
      firstRecords: rows.slice(0, 20).map((r) => ({
        id: r.id,
        kind: r.facts.kind,
        marketplace: r.facts.marketplace,
        date: r.facts.date,
        fees: r.facts.fees,
        items: r.facts.lines.map((l) => ({
          title: l.title,
          price: l.price,
          purchaseCost: l.purchaseCost,
        })),
      })),
    });
    const message: ChatMessage = {
      id: input.requestId,
      role: 'user',
      text: input.message,
      context: rows.length || input.fileIds.length ? context.slice(0, 48000) : undefined,
      fileIds: input.fileIds.length ? input.fileIds : undefined,
    };
    const response = await runBusinessAssistant({
      userId: user.id,
      workspace: w,
      messages: [...claim.messages, message],
      drafts: input.drafts,
      selectedItemId: input.selectedItemId,
      files,
      signal: request.signal,
      authorize: async () => {
        const current = await requireUser(request);
        if (current.id !== user.id) throw new Error('Unauthorized');
      },
    });
    const answer: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: response.message,
    };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 2400000)
      throw new AssistantError(
        'This conversation draft is too large. Review a smaller batch before retrying.',
        413,
      );
    const saved = await chatStore(user.id, 'finish', {
      requestId: input.requestId,
      lease,
      messages: [message, answer],
      response,
    });
    lease = undefined;
    return NextResponse.json({ response, revision: saved!.revision }, options);
  } catch (error) {
    if (actor && lease && requestId) {
      try {
        await chatStore(actor, 'cancel', { requestId, lease });
      } catch {
        /* Lease expires; a revoked account stays denied. */
      }
    }
    return failure(error);
  }
}
function failure(error: unknown) {
  const unauthorized = error instanceof Error && error.message === 'Unauthorized';
  return NextResponse.json(
    {
      error: unauthorized
        ? 'Sign in to your private workspace to use the assistant.'
        : error instanceof AssistantError
          ? error.message
          : error instanceof z.ZodError
            ? 'Check the message and pending drafts; no business records changed.'
            : error instanceof ConfigurationError || error instanceof DatabaseReadinessError
              ? 'Business chat needs a verified private workspace configuration.'
              : 'The assistant could not complete this turn. Your business records were not changed.',
    },
    {
      status: unauthorized
        ? 401
        : error instanceof AssistantError
          ? error.status
          : error instanceof ConfigurationError || error instanceof DatabaseReadinessError
            ? 503
            : 400,
      ...options,
    },
  );
}
