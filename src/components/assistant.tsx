'use client';
/* Object URLs show local screenshot previews; no public image URLs are created. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Paperclip, Send, X, Trash2, FileText } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { prepareImage } from '@/lib/assistant/images';
import { documentType } from '@/lib/assistant/documents';
import { IMAGE_LIMIT } from '@/lib/assistant/schema';
import { createHistoryBatch } from '@/lib/assistant/history';
import { HistoryReview } from './history-review';
import { screenshotSchema, DEFAULT_BATCH_LIMIT, BATCH_BYTES_LIMIT } from '@/lib/assistant/schema';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import {
  batchSchema,
  createBatch,
  sanitizeBatch,
  type DraftBatch,
  type ListingContext,
} from '@/lib/assistant/drafts';
import { reconcileApprovedDrafts } from '@/lib/assistant/review-bulk';
import { AssistantReview } from './assistant-review';
import { marketplaceContextFromText } from '@/lib/assistant/vision';
import { prepareSpokenFulfillment, appendConversationRow } from '@/lib/assistant/conversation';
import { AssistantFulfillmentActions } from './assistant-fulfillment-actions';
import { correctBatch } from '@/lib/assistant/corrections';
import {
  chatMessageSchema,
  chatResponseSchema,
  type ChatDrafts,
  type ChatResponse,
} from '@/lib/assistant/chat-schema';

type Attachment = { id: string; file: File; url: string; kind?: 'pdf' | 'csv' };
type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: Attachment[];
  files?: { id: string; name: string; mime: string }[];
  replyTo?: string;
};
export function Assistant({
  open,
  onOpen,
  onClose,
  context,
  onClearContext,
  onView,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  context?: ListingContext;
  onClearContext?: () => void;
  onView: (kind: 'order' | 'listing', id: string) => void;
}) {
  const {
    demo,
    w,
    ready,
    saving,
    error: workspaceError,
    approveAssistant,
    notify,
  } = useWorkspace();
  const { scope, requestHeaders } = useWorkspace();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [batch, setBatch] = useState<DraftBatch | null>(null);
  const [historyBatch, setHistoryBatch] = useState<DraftBatch | null>(null);
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
  const [recentOrders, setRecentOrders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<{ enabled: boolean; batchLimit: number } | null>(null);
  const [chat, setChat] = useState<{
    ready: boolean;
    enabled: boolean;
    revision: number;
    model: string;
    setup?: string;
  } | null>(null);
  const [choices, setChoices] = useState<ChatResponse['choices']>([]);
  const [chatRunning, setChatRunning] = useState(false);
  const [chatRefresh, setChatRefresh] = useState(0);
  const chatRetry = useRef<{ key: string; id: string } | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const [restored, setRestored] = useState(false);
  const storageKey = `thrift-log.draft.assistant.${scope}`;
  const sourceFiles = useRef(new Map<string, File>());
  const urls = useRef(new Set<string>());
  const [sourceUrls, setSourceUrls] = useState(new Map<string, string>());
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) setBatch(sanitizeBatch(batchSchema.parse(JSON.parse(raw)), w.settings.timezone));
        const history = sessionStorage.getItem(`${storageKey}.history`);
        if (history) setHistoryBatch(batchSchema.parse(JSON.parse(history)));
      } catch {
        setError('A saved assistant draft could not be restored. Existing records are unchanged.');
      }
      setRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [storageKey, w.settings.timezone]);
  useEffect(() => {
    if (!restored) return;
    try {
      if (batch) sessionStorage.setItem(storageKey, JSON.stringify(batch));
      else sessionStorage.removeItem(storageKey);
      if (historyBatch)
        sessionStorage.setItem(`${storageKey}.history`, JSON.stringify(historyBatch));
      else sessionStorage.removeItem(`${storageKey}.history`);
    } catch {
      /* Keep the in-memory draft if this browser blocks session storage. */
    }
  }, [batch, historyBatch, storageKey, restored]);
  useEffect(() => {
    const all = urls.current;
    return () => {
      all.forEach(URL.revokeObjectURL);
      chatAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open || demo) return;
    let ignore = false;
    fetch('/api/assistant/extract', { cache: 'no-store', headers: requestHeaders })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (!ignore) setConfig(data);
      })
      .catch((e) => {
        if (!ignore) setError(e.message);
      });
    return () => {
      ignore = true;
    };
  }, [open, demo, requestHeaders]);
  useEffect(() => {
    if (!open || demo) return;
    let ignore = false;
    fetch('/api/assistant/chat', { cache: 'no-store', headers: requestHeaders })
      .then(async (response) => {
        const data = await response.json();
        if (ignore || !response.ok) return;
        const parsed = chatMessageSchema.array().safeParse(data.messages);
        if (!parsed.success || typeof data.ready !== 'boolean' || typeof data.revision !== 'number')
          return;
        setChat({
          ready: data.ready,
          enabled: data.enabled,
          revision: data.revision,
          model: data.model,
          setup: data.setup,
        });
        setMessages((old) =>
          old.length
            ? old
            : parsed.data.map((m) => ({ id: m.id, role: m.role, text: m.text, files: m.files })),
        );
        const saved = chatResponseSchema.safeParse(data.response);
        if (saved.success) {
          setChoices(saved.data.choices);
          const pending = (b: DraftBatch | null) =>
            b ? { ...b, rows: b.rows.filter((r) => !w.imports.some((i) => i.id === r.id)) } : null;
          const b = pending(saved.data.drafts.batch),
            h = pending(saved.data.drafts.historyBatch);
          if (b?.rows.length) setBatch((old) => (old?.rows.length ? old : b));
          if (h?.rows.length) setHistoryBatch((old) => (old?.rows.length ? old : h));
        }
      })
      .catch(() => {
        /* Existing import and draft review stay available. */
      });
    return () => {
      ignore = true;
    };
  }, [open, demo, requestHeaders, w.revision, w.imports, chatRefresh]);
  const reviewBatchId = batch?.id || historyBatch?.id;
  useEffect(() => {
    if (reviewBatchId) {
      if (!busy)
        end.current?.parentElement
          ?.querySelector('.assistant-review, .history-review')
          ?.scrollIntoView({ block: 'start' });
      return;
    }
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy, reviewBatchId]);
  const limit = config?.batchLimit || DEFAULT_BATCH_LIMIT;
  async function add(files: File[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const additions: Attachment[] = [];
    try {
      if (files.length + attachments.length > limit)
        throw new Error(`Choose up to ${limit} files per batch.`);
      for (const source of files) {
        const kind = documentType(source);
        if (!kind && !['image/jpeg', 'image/png', 'image/webp'].includes(source.type))
          throw new Error(
            'Use JPEG, PNG, WebP, PDF or CSV files. Export spreadsheets as CSV, or HEIC images as JPEG.',
          );
        if (kind && (!source.size || source.size > IMAGE_LIMIT))
          throw new Error('Each PDF or CSV must be smaller than 5 MB.');
        const file = kind ? source : await prepareImage(source);
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        const url = kind ? '' : URL.createObjectURL(file);
        if (!kind) {
          sourceFiles.current.set(hash, file);
          urls.current.add(url);
          setSourceUrls((previous) => new Map(previous).set(hash, url));
        }
        additions.push({ id: crypto.randomUUID(), file, url, kind: kind || undefined });
      }
      if (
        [...attachments, ...additions].reduce((n, a) => n + a.file.size, 0) >
        BATCH_BYTES_LIMIT - 100_000
      ) {
        additions.forEach((a) => {
          URL.revokeObjectURL(a.url);
          urls.current.delete(a.url);
        });
        throw new Error('Use fewer files so the batch stays below 16 MB.');
      }
      setAttachments((old) => [...old, ...additions]);
    } catch (e) {
      additions.forEach((a) => {
        URL.revokeObjectURL(a.url);
        urls.current.delete(a.url);
      });
      setError(e instanceof Error ? e.message : 'Could not read this attachment.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function clear() {
    if (
      (batch?.rows.length || historyBatch?.rows.length) &&
      !window.confirm(
        'Discard pending drafts, conversation and private chat attachments? Saved business records and inventory photos stay intact.',
      )
    )
      return;
    if (chat?.ready) {
      if (
        !batch?.rows.length &&
        !historyBatch?.rows.length &&
        !window.confirm(
          'Clear this conversation and its private attachments? Saved business records and inventory photos stay intact.',
        )
      )
        return;
      try {
        const response = await fetch(`/api/assistant/chat?revision=${chat.revision}`, {
          method: 'DELETE',
          headers: requestHeaders,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not clear the conversation.');
        setChat({ ...chat, revision: data.revision });
        if (data.notice) notify(data.notice);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Conversation was not cleared.');
        return;
      }
    }
    urls.current.forEach(URL.revokeObjectURL);
    urls.current.clear();
    setAttachments([]);
    setMessages([]);
    setBatch(null);
    setHistoryBatch(null);
    sourceFiles.current.clear();
    setSourceUrls(new Map());
    setError('');
    setChoices([]);
    chatRetry.current = null;
  }
  async function businessChat(
    prompt: string,
    drafts: ChatDrafts,
    selectedItemId: string | null = null,
    appendUser = true,
    files: Attachment[] = [],
  ) {
    if (!chat?.ready || !chat.enabled) return;
    const snapshot = {
      batch: JSON.stringify(drafts.batch),
      historyBatch: JSON.stringify(drafts.historyBatch),
    };
    const fileIds = files.map((f) => f.id);
    const key = JSON.stringify({ message: prompt, drafts, selectedItemId, fileIds });
    if (chatRetry.current?.key !== key) chatRetry.current = { key, id: crypto.randomUUID() };
    const id = chatRetry.current!.id;
    if (appendUser)
      setMessages((old) =>
        old.some((m) => m.id === id)
          ? old
          : [...old.slice(-39), { id, role: 'user', text: prompt, images: files }],
      );
    const controller = new AbortController();
    chatAbort.current = controller;
    setChatRunning(true);
    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          requestId: id,
          revision: chat.revision,
          message: prompt,
          drafts,
          selectedItemId,
          fileIds,
        }),
      });
      const data = await response.json().catch(() => ({
        error: 'The assistant could not finish. Your pending drafts are preserved.',
      }));
      if (!response.ok) throw new Error(data.error || 'Business chat could not finish.');
      const result = chatResponseSchema.parse(data.response);
      setChat((old) => (old ? { ...old, revision: data.revision } : old));
      setBatch((current) =>
        JSON.stringify(current) === snapshot.batch ? result.drafts.batch : current,
      );
      setHistoryBatch((current) =>
        JSON.stringify(current) === snapshot.historyBatch ? result.drafts.historyBatch : current,
      );
      setChoices(result.choices);
      setMessages((old) =>
        old.some((m) => m.replyTo === id)
          ? old
          : [
              ...old.slice(-38),
              ...(appendUser && !old.some((m) => m.id === id)
                ? [{ id, role: 'user' as const, text: prompt }]
                : []),
              { id: crypto.randomUUID(), role: 'assistant', text: result.message, replyTo: id },
            ],
      );
      setText('');
      if (files.length) setAttachments([]);
      setError('');
      chatRetry.current = null;
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error('Stopped. No business records changed; your message is ready to retry.');
      throw error;
    } finally {
      chatAbort.current = null;
      setChatRunning(false);
    }
  }
  async function sendChoice(choice: ChatResponse['choices'][number]) {
    if (lock.current || !chat?.ready) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await businessChat(choice.text, { batch, historyBatch }, choice.itemId);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Retry your reply.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function send() {
    if (lock.current || !ready || (!text.trim() && !attachments.length)) return;
    const prompt = text.trim() || 'Review these files for sale history or active listings.';
    if (chat?.ready && chat.enabled && !demo && !context) {
      lock.current = true;
      setBusy(true);
      setError('');
      try {
        for (const attachment of attachments) {
          const body = new FormData();
          body.set('id', attachment.id);
          body.set('file', attachment.file);
          const upload = await fetch('/api/assistant/files', {
            method: 'POST',
            headers: requestHeaders,
            body,
          });
          const result = await upload.json();
          if (!upload.ok)
            throw new Error(result.error || 'Private attachment upload failed. Retry this file.');
        }
        await businessChat(prompt, { batch, historyBatch }, null, true, attachments);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'The assistant could not finish. Your records are unchanged.',
        );
      } finally {
        lock.current = false;
        setBusy(false);
      }
      return;
    }
    if (!attachments.length && historyBatch?.rows.length) {
      setError('Edit the sale history cards directly, then approve or cancel the pending review.');
      return;
    }
    if (!attachments.length) {
      const fulfillment = prepareSpokenFulfillment(w, prompt);
      if (fulfillment) {
        if (fulfillment.row) setBatch(appendConversationRow(batch, w, fulfillment.row));
        setMessages((old) => [
          ...old.slice(-38),
          { id: crypto.randomUUID(), role: 'user', text: prompt },
          { id: crypto.randomUUID(), role: 'assistant', text: fulfillment.message },
        ]);
        setText('');
        return;
      }
    }
    if (!attachments.length && batch) {
      try {
        const corrected = correctBatch(batch, prompt, w);
        if (corrected.changed) setBatch(corrected.batch);
        setMessages((old) => [
          ...old.slice(-38),
          { id: crypto.randomUUID(), role: 'user', text: prompt },
          { id: crypto.randomUUID(), role: 'assistant', text: corrected.message },
        ]);
        setText('');
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That correction could not be applied.');
      }
      return;
    }
    if (!attachments.length) {
      setMessages((old) => [
        ...old,
        { id: crypto.randomUUID(), role: 'user', text: prompt },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'Attach PDF/CSV sale history or screenshots of completed sales and active listings. I’ll read the visible information for review before anything is saved.',
        },
      ]);
      setText('');
      return;
    }
    if (context && attachments.some((a) => a.kind)) {
      setError(
        'Choose Use general import before attaching PDF or CSV sale history. This scan is linked to one existing inventory item.',
      );
      return;
    }
    if (demo) {
      setError(
        'Sign in to your private workspace to analyze screenshots. Demo records stay separate.',
      );
      return;
    }
    if (batch?.rows.length || historyBatch?.rows.length) {
      setError(
        'Finish reviewing or cancel the pending batch before analyzing more screenshots. Your pending edits are preserved.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      attachments.forEach((a) => body.append('files', a.file));
      body.set('message', prompt);
      body.set('timeZone', w.settings.timezone);
      const response = await fetch('/api/assistant/extract', {
        method: 'POST',
        headers: requestHeaders,
        body,
      });
      const data = await response.json().catch(() => ({
        error: 'The file analysis could not finish. Try a smaller file; no records changed.',
      }));
      if (!response.ok || !Array.isArray(data.screenshots))
        throw new Error(
          data.error || 'File analysis could not finish. Your attachments are ready to retry.',
        );
      const parsed = screenshotSchema.array().safeParse(data.screenshots);
      if (!parsed.success)
        throw new Error(
          'The analysis returned an invalid draft. Retry with a smaller batch; no records changed.',
        );
      const extracted = parsed.data;
      const documents = extracted.filter((s) => s.sourceType === 'csv' || s.sourceType === 'pdf');
      const images = extracted.filter((s) => !s.sourceType || s.sourceType === 'image');
      const nextDrafts = {
        batch: images.length
          ? createBatch(images, w, context, marketplaceContextFromText(prompt))
          : batch,
        historyBatch: documents.length ? createHistoryBatch(documents, w) : historyBatch,
      };
      if (documents.length) setHistoryBatch(nextDrafts.historyBatch);
      if (images.length) setBatch(nextDrafts.batch);
      setMessages((old) => [
        ...old.slice(-38),
        { id: crypto.randomUUID(), role: 'user', text: prompt, images: attachments },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text:
            [...new Set(extracted.map((s) => s.extraction.message))].join('\n') ||
            'Review the extracted information below.',
        },
      ]);
      setText('');
      setAttachments([]);
      if (chat?.ready && chat.enabled) {
        try {
          await businessChat(prompt, nextDrafts, null, false);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : 'Your file review is ready; business chat did not finish.',
          );
        }
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'File analysis failed. Your attachments are ready to retry.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function approveHistory(ids: string[]) {
    if (lock.current || !historyBatch) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await approveAssistant(historyBatch, ids, 'history');
      if (saved) {
        setHistoryBatch((current) =>
          current && current.rows.some((r) => !ids.includes(r.id))
            ? {
                ...current,
                revision: saved.revision,
                rows: current.rows.filter((r) => !ids.includes(r.id)),
              }
            : null,
        );
        setMessages((old) => [
          ...old.slice(-39),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `Saved ${ids.length} approved sale-history records. Unknown purchase costs stay incomplete, not zero-cost profit.`,
          },
        ]);
        notify('Approved sale history saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed; your draft is preserved.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function approve(ids: string[]) {
    if (lock.current || !batch) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const approvedHashes = new Set(
        batch.rows.filter((r) => ids.includes(r.id)).map((r) => r.sourceHash),
      );
      const prepared = structuredClone(batch);
      if (!demo)
        for (const screenshot of prepared.screenshots) {
          if (
            !approvedHashes.has(screenshot.hash) ||
            screenshot.reference ||
            (screenshot.sourceType && screenshot.sourceType !== 'image')
          )
            continue;
          let file = sourceFiles.current.get(screenshot.originalHash || screenshot.hash);
          if (!file && screenshot.chatFileId) {
            const retained = await fetch(
              `/api/assistant/files?id=${encodeURIComponent(screenshot.chatFileId)}`,
              { headers: requestHeaders, cache: 'no-store' },
            );
            if (!retained.ok)
              throw new Error(
                'The private source image is unavailable. Reattach it before approval.',
              );
            const blob = await retained.blob();
            file = new File([blob], screenshot.name || 'source-image', { type: blob.type });
          }
          if (!file) continue;
          const body = new FormData();
          body.set('file', file);
          const upload = await fetch('/api/photos', {
            method: 'POST',
            headers: requestHeaders,
            body,
          });
          const uploaded = await upload.json();
          if (!upload.ok)
            throw new Error(
              uploaded.error ||
                'Could not preserve the private screenshot. No business records were saved.',
            );
          screenshot.reference = uploaded.path;
          // Keep successful upload references on failure/retry, avoiding another upload.
          setBatch(structuredClone(prepared));
        }
      const confirmed = await approveAssistant(prepared, ids);
      if (confirmed) {
        setRecentOrders((old) =>
          [
            ...new Set([
              ...old,
              ...prepared.rows
                .filter((r) => ids.includes(r.id) && r.facts.kind === 'sale')
                .map((r) => r.id),
            ]),
          ].slice(-20),
        );
        setBatch((current) =>
          current
            ? current.rows.some((r) => !ids.includes(r.id))
              ? reconcileApprovedDrafts(
                  {
                    ...current,
                    revision: confirmed.revision,
                    rows: current.rows.filter((r) => !ids.includes(r.id)),
                  },
                  confirmed,
                )
              : null
            : null,
        );
        setMessages((old) => [
          ...old.slice(-39),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: `Saved ${ids.length} approved record${ids.length === 1 ? '' : 's'}. Inventory, listings and financial reports are updated. Unresolved records remain pending.`,
          },
        ]);
        notify('Approved screenshot records saved.');
        for (const hash of approvedHashes) sourceFiles.current.delete(hash);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Approval failed. Your pending draft is preserved.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="assistant-launch"
        aria-label="Open AI assistant"
        disabled={!ready || !restored}
        onClick={onOpen}
      >
        <MessageCircle size={20} />
        <span>Assistant</span>
      </button>
      {open && (
        <Dialog
          open
          onClose={onClose}
          title="Your Thrift Log assistant"
          description="Attach screenshots, PDF or CSV files, review, then approve."
          className="assistant-panel"
        >
          <div
            className="assistant-body"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void add(Array.from(e.dataTransfer.files));
            }}
          >
            <div className="assistant-thread" role="log" aria-label="Assistant conversation">
              {context && (
                <div className="hint">
                  Scan listing for{' '}
                  {w.items.find((i) => i.id === context.itemId)?.title || 'selected inventory item'}
                  . Its cost, SKU, photos and sourcing history are preserved.
                  {batch && batch.context?.itemId !== context.itemId && (
                    <p>Finish or cancel the existing batch before starting this scan.</p>
                  )}
                  <Button variant="ghost" size="sm" disabled={busy} onClick={onClearContext}>
                    Use general import
                  </Button>
                </div>
              )}
              {!messages.length && !batch && !historyBatch && (
                <div className="assistant-intro">
                  <MessageCircle size={28} />
                  <h3>Less typing. More thrifting.</h3>
                  <p>
                    Ask about your business, describe a sale, or attach spreadsheets, PDFs and
                    photos. You can use your iPhone keyboard’s dictation. I’ll find records, ask
                    about missing details, and prepare changes for review.
                  </p>
                  <small>Your records change only after approval.</small>
                </div>
              )}
              {demo && (
                <p className="hint">
                  You’re in the fictional demo. Sign in to analyze your own screenshots.
                </p>
              )}
              {config?.enabled === false && (
                <p role="status" className="error-box">
                  Screenshot analysis needs OPENAI_API_KEY in the server environment. Manual entry
                  and CSV imports remain available.
                </p>
              )}
              {chat?.ready === false && (
                <p className="hint">
                  Business chat needs administrator setup. Your existing file imports and review
                  controls remain available.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`assistant-message assistant-${m.role}`}>
                  <small>{m.role === 'user' ? 'You' : 'Thrift Log'}</small>
                  <p>{m.text}</p>
                  {!!m.files?.length && (
                    <div className="assistant-thumbnails">
                      {m.files.map((file) => (
                        <span className="assistant-document" key={file.id}>
                          <FileText size={22} />
                          <span>
                            {file.name}
                            <small>{file.mime.split('/')[1].toUpperCase()}</small>
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {m.images && (
                    <div className="assistant-thumbnails">
                      {m.images.map((a) =>
                        a.kind ? (
                          <span className="assistant-document" key={a.id}>
                            <FileText size={22} />
                            <span>
                              {a.file.name}
                              <small>{a.kind.toUpperCase()}</small>
                            </span>
                          </span>
                        ) : (
                          <img key={a.id} src={a.url} alt={a.file.name} />
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!!choices.length && (
                <div className="assistant-choices" aria-label="Assistant reply choices">
                  {choices.map((choice, i) => (
                    <Button
                      key={`${choice.itemId || 'reply'}:${i}`}
                      variant="outline"
                      disabled={busy || saving}
                      onClick={() => void sendChoice(choice)}
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
              )}
              {batch && (
                <AssistantReview
                  batch={batch}
                  footerHost={footerHost}
                  sourceUrls={
                    new Map([
                      ...batch.screenshots
                        .filter((s) => s.chatFileId && (!s.sourceType || s.sourceType === 'image'))
                        .map(
                          (s) =>
                            [
                              s.hash,
                              `/api/assistant/files?id=${encodeURIComponent(s.chatFileId!)}`,
                            ] as const,
                        ),
                      ...sourceUrls,
                    ])
                  }
                  onChange={setBatch}
                  onApprove={(ids) => void approve(ids)}
                  onCancel={() => setBatch(null)}
                  busy={busy || saving}
                  onView={onView}
                />
              )}
              {historyBatch && (
                <HistoryReview
                  batch={historyBatch}
                  onChange={setHistoryBatch}
                  onApprove={(ids) => void approveHistory(ids)}
                  onCancel={() => setHistoryBatch(null)}
                  busy={busy || saving}
                />
              )}
              {!!recentOrders.length && <AssistantFulfillmentActions orderIds={recentOrders} />}
              {busy && (
                <div className="actions">
                  <p role="status">Reading and checking your workspace…</p>
                  {chatRunning && (
                    <Button variant="ghost" onClick={() => chatAbort.current?.abort()}>
                      Stop response
                    </Button>
                  )}
                </div>
              )}
              <div ref={end} />
            </div>
            {(error || workspaceError) && (
              <div className="error-box" role="alert">
                {error || workspaceError}
              </div>
            )}
            {!!attachments.length && (
              <div className="assistant-thumbnails">
                {attachments.map((a) => (
                  <div key={a.id}>
                    {a.kind ? (
                      <span className="assistant-document">
                        <FileText size={22} />
                        <span>
                          {a.file.name}
                          <small>{a.kind.toUpperCase()}</small>
                        </span>
                      </span>
                    ) : (
                      <img src={a.url} alt={a.file.name} />
                    )}
                    <button
                      aria-label={`Remove ${a.file.name}`}
                      disabled={busy}
                      onClick={() => {
                        setAttachments((old) => old.filter((v) => v.id !== a.id));
                        URL.revokeObjectURL(a.url);
                        urls.current.delete(a.url);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div ref={setFooterHost} className="assistant-review-footer-host" />
            <details
              className="assistant-compose-disclosure"
              open={chat?.ready ? true : batch || historyBatch ? undefined : true}
            >
              <summary
                className={chat?.ready ? 'sr-only' : batch || historyBatch ? undefined : 'sr-only'}
              >
                Message assistant / add files
              </summary>
              <form
                className="assistant-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  aria-label="Message assistant"
                  disabled={busy}
                  placeholder="Ask anything about your business…"
                  autoCapitalize="sentences"
                  spellCheck
                  value={text}
                  maxLength={4000}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length) {
                      e.preventDefault();
                      void add(files);
                    }
                  }}
                />
                <div className="actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    aria-label="Attach files"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip size={17} />
                    <span>Add files</span>
                  </Button>
                  <small>
                    {attachments.length}/{limit}
                  </small>
                  <Button
                    disabled={busy || !ready || (!text.trim() && !attachments.length)}
                    type="submit"
                  >
                    <Send size={16} />
                    {busy ? 'Reading…' : 'Send'}
                  </Button>
                </div>
                <input
                  ref={fileInput}
                  className="sr-only"
                  aria-label="Import files"
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,application/pdf,text/csv,.pdf,.csv"
                  onChange={(e) => {
                    void add(Array.from(e.target.files || []));
                    e.target.value = '';
                  }}
                />
              </form>
              <div className="assistant-footer">
                <small>
                  Review before saving · {scope === 'demo' ? 'Demo' : 'Private workspace'}
                </small>
                {chat?.ready && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setMessages([]);
                      setChoices([]);
                      setChatRefresh((n) => n + 1);
                    }}
                  >
                    Refresh chat
                  </Button>
                )}
                <Button variant="ghost" size="sm" disabled={busy} onClick={clear}>
                  <Trash2 size={13} />
                  Clear chat
                </Button>
              </div>
            </details>
          </div>
        </Dialog>
      )}
    </>
  );
}
