'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="empty">
      <h1>Something interrupted your workspace.</h1>
      <p>Your saved records are safe. Try again or check your connection.</p>
      <button className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
