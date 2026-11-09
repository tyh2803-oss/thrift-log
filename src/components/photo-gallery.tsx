'use client';
/* Native images use authenticated private-storage routes; public image optimization is inappropriate. */
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Item } from '@/lib/model';
import { ItemPhoto } from './shared';
const source = (path: string) =>
  path.startsWith('data:') ? path : `/api/photos?path=${encodeURIComponent(path)}`;
export function PhotoGallery({ item }: { item: Item }) {
  const [index, setIndex] = useState(0);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  if (!item.photos.length) return <ItemPhoto item={item} large />;
  const selected = Math.min(index, item.photos.length - 1),
    path = item.photos[selected];
  return (
    <section className="photo-gallery" aria-label="Inventory photos">
      <div className="gallery-main">
        {unavailable.includes(path) ? (
          <div className="empty">
            <p>Photo unavailable. Check your connection and reopen this item.</p>
          </div>
        ) : (
          <img
            src={source(path)}
            alt={`${item.title}, photo ${selected + 1}`}
            onError={() => setUnavailable((current) => [...current, path])}
          />
        )}
        {item.photos.length > 1 && (
          <>
            <button
              className="gallery-prev"
              aria-label="Previous photo"
              onClick={() => setIndex((selected + item.photos.length - 1) % item.photos.length)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="gallery-next"
              aria-label="Next photo"
              onClick={() => setIndex((selected + 1) % item.photos.length)}
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
        <span className="gallery-count" aria-live="polite">
          {selected + 1} / {item.photos.length}
        </span>
      </div>
      {item.photos.length > 1 && (
        <div className="gallery-thumbnails">
          {item.photos.map((photo, i) => (
            <button
              key={`${photo}-${i}`}
              aria-label={`View photo ${i + 1}`}
              aria-pressed={selected === i}
              onClick={() => setIndex(i)}
            >
              <img src={source(photo)} alt="" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
