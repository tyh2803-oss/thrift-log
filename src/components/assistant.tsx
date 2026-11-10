'use client';
/* Object URLs show local screenshot previews; no public image URLs are created. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Paperclip, Send, X, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { prepareImage } from '@/lib/assistant/images';
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

type Attachment = { id: string; file: File; url: string };
type Message = { id: string; role: 'user' | 'assistant'; text: string; images?: Attachment[] };
export function Assistant({
  open,
  onOpen,
  onClose,
  scope,
  context,
  onClearContext,
  onView,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  scope: string;
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
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [batch, setBatch] = useState<DraftBatch | null>(null);
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
  const [recentOrders, setRecentOrders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<{ enabled: boolean; batchLimit: number } | null>(null);
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
    } catch {
      /* Keep the in-memory draft if this browser blocks session storage. */
    }
  }, [batch, storageKey, restored]);
  useEffect(() => {
    const all = urls.current;
    return () => all.forEach(URL.revokeObjectURL);
  }, []);
  useEffect(() => {
    if (!open || demo) return;
    let ignore = false;
    fetch('/api/assistant/extract', { cache: 'no-store' })
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
  }, [open, demo]);
  const reviewBatchId = batch?.id;
  useEffect(() => {
    if (reviewBatchId) {
      if (!busy)
        end.current?.parentElement
          ?.querySelector('.assistant-review')
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
        throw new Error(`Choose up to ${limit} screenshots per batch.`);
      for (const source of files) {
        const file = await prepareImage(source);
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        sourceFiles.current.set(hash, file);
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        setSourceUrls((previous) => new Map(previous).set(hash, url));
        additions.push({ id: crypto.randomUUID(), file, url });
      }
      if (
        [...attachments, ...additions].reduce((n, a) => n + a.file.size, 0) >
        BATCH_BYTES_LIMIT - 100_000
      ) {
        additions.forEach((a) => {
          URL.revokeObjectURL(a.url);
          urls.current.delete(a.url);
        });
        throw new Error('Use fewer screenshots so the batch stays below 16 MB.');
      }
      setAttachments((old) => [...old, ...additions]);
    } catch (e) {
      additions.forEach((a) => {
        URL.revokeObjectURL(a.url);
        urls.current.delete(a.url);
      });
      setError(e instanceof Error ? e.message : 'Could not read this screenshot.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function clear() {
    if (
      batch?.rows.length &&
      !window.confirm('Discard pending drafts and clear chat? Saved records stay intact.')
    )
      return;
    urls.current.forEach(URL.revokeObjectURL);
    urls.current.clear();
    setAttachments([]);
    setMessages([]);
    setBatch(null);
    sourceFiles.current.clear();
    setSourceUrls(new Map());
    setError('');
  }
  async function send() {
    if (lock.current || !ready || (!text.trim() && !attachments.length)) return;
    const prompt = text.trim() || 'Review these screenshots.';
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
          text: 'Attach screenshots of completed sales or active listings. I’ll read the visible information for review before anything is saved.',
        },
      ]);
      setText('');
      return;
    }
    if (demo) {
      setError(
        'Sign in to your private workspace to analyze screenshots. Demo records stay separate.',
      );
      return;
    }
    if (batch?.rows.length) {
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
      attachments.forEach((a) => body.append('images', a.file));
      const response = await fetch('/api/assistant/extract', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const extracted = screenshotSchema.array().parse(data.screenshots);
      setBatch(createBatch(extracted, w, context, marketplaceContextFromText(prompt)));
      setMessages((old) => [
        ...old.slice(-38),
        { id: crypto.randomUUID(), role: 'user', text: prompt, images: attachments },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text:
            extracted.map((s) => s.extraction.message).join('\n') ||
            'Review the extracted information below.',
        },
      ]);
      setText('');
      setAttachments([]);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Screenshot analysis failed. Your attachments are ready to retry.',
      );
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
          if (!approvedHashes.has(screenshot.hash) || screenshot.reference) continue;
          const file = sourceFiles.current.get(screenshot.hash);
          if (!file) continue;
          const body = new FormData();
          body.set('file', file);
          const upload = await fetch('/api/photos', { method: 'POST', body });
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
          description="Upload screenshots, review the details, then approve."
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
              {!messages.length && !batch && (
                <div className="assistant-intro">
                  <MessageCircle size={28} />
                  <h3>Less typing. More thrifting.</h3>
                  <p>
                    Drop in sale or listing screenshots from Depop, Vinted, eBay or Whatnot. I’ll
                    help you review the details.
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
              {messages.map((m) => (
                <div key={m.id} className={`assistant-message assistant-${m.role}`}>
                  <small>{m.role === 'user' ? 'You' : 'Thrift Log'}</small>
                  <p>{m.text}</p>
                  {m.images && (
                    <div className="assistant-thumbnails">
                      {m.images.map((a) => (
                        <img key={a.id} src={a.url} alt={a.file.name} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {batch && (
                <AssistantReview
                  batch={batch}
                  footerHost={footerHost}
                  sourceUrls={sourceUrls}
                  onChange={setBatch}
                  onApprove={(ids) => void approve(ids)}
                  onCancel={() => setBatch(null)}
                  busy={busy || saving}
                  onView={onView}
                />
              )}
              {!!recentOrders.length && <AssistantFulfillmentActions orderIds={recentOrders} />}
              {busy && <p role="status">Working on your screenshots…</p>}
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
                    <img src={a.url} alt={a.file.name} />
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
            <details className="assistant-compose-disclosure" open={batch ? undefined : true}>
              <summary className={batch ? undefined : 'sr-only'}>
                Message assistant / add screenshots
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
                  placeholder="Log these sales…"
                  value={text}
                  maxLength={2000}
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
                    aria-label="Attach screenshots"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip size={17} />
                    <span>Add images</span>
                  </Button>
                  <small>
                    {attachments.length}/{limit}
                  </small>
                  <Button disabled={busy || (!text.trim() && !attachments.length)} type="submit">
                    <Send size={16} />
                    {busy ? 'Reading…' : 'Send'}
                  </Button>
                </div>
                <input
                  ref={fileInput}
                  className="sr-only"
                  aria-label="Screenshot files"
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
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
