import { ArrowDown, ArrowUp, ImagePlus, Trash } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/format';
import type { ImageRef } from '../../lib/types';
import { Alert, Spinner } from '../ui/Feedback';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Uploads images to the server (which stores them in Cloudinary), then lets
 * staff reorder, label and remove them. The first image is the cover.
 * Removed images are deleted from storage only after the product is saved.
 */
export function ImageManager({ images, onChange, max = 10, single = false }: { images: ImageRef[]; onChange: (imgs: ImageRef[]) => void; max?: number; single?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const limit = single ? 1 : max;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const list = [...files].slice(0, limit - images.length);
    let next = [...images];
    for (const file of list) {
      if (!ACCEPT.includes(file.type)) {
        setError(`${file.name}: only JPEG, PNG, WebP or AVIF images are allowed.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name}: images must be 5 MB or smaller.`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.append('file', file);
        const stored = await api.upload<{ url: string; publicId: string; width: number; height: number }>('/admin/uploads/images', form);
        next = single ? [{ ...stored, alt: '' }] : [...next, { ...stored, alt: '' }];
        onChange(next);
      } catch (err) {
        setError(err instanceof ApiError && err.code === 'UPLOADS_NOT_CONFIGURED' ? err.message : `${file.name}: ${errorMessage(err)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (input.current) input.current.value = '';
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...images];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <ul className={cn('grid gap-3', single ? 'grid-cols-1 sm:max-w-[220px]' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
        {images.map((img, i) => (
          <li key={img.publicId ?? img.url} className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="relative aspect-square bg-blush-50">
              <img src={img.url} alt={img.alt || ''} className="size-full object-cover" />
              {i === 0 && !single && <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Cover</span>}
            </div>
            <div className="space-y-2 p-2">
              <input
                aria-label={`Alt text for image ${i + 1}`}
                placeholder="Alt text (describe the image)"
                value={img.alt ?? ''}
                onChange={(e) => onChange(images.map((x, k) => (k === i ? { ...x, alt: e.target.value } : x)))}
                maxLength={200}
                className="h-8 w-full rounded-lg border border-line-strong px-2 text-xs focus:border-rose-600 focus:outline-none"
              />
              <div className="flex justify-between">
                {!single && (
                  <div className="flex">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier" className="rounded-lg p-1.5 text-muted hover:bg-blush-50 disabled:opacity-30">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label="Move later" className="rounded-lg p-1.5 text-muted hover:bg-blush-50 disabled:opacity-30">
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => onChange(images.filter((_, k) => k !== i))} aria-label="Remove image" className="ml-auto rounded-lg p-1.5 text-muted hover:bg-danger-bg hover:text-danger">
                  <Trash className="size-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
        {images.length < limit && (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={uploading > 0}
              className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-sm text-muted transition-colors hover:border-rose-600 hover:text-rose-700"
            >
              {uploading > 0 ? <Spinner /> : <ImagePlus className="size-6" />}
              {uploading > 0 ? 'Uploading…' : single ? 'Upload image' : 'Add images'}
            </button>
          </li>
        )}
      </ul>
      <input ref={input} type="file" accept={ACCEPT.join(',')} multiple={!single} className="sr-only" onChange={(e) => upload(e.target.files)} aria-label="Upload images" />
      <p className="mt-2 text-xs text-muted">JPEG, PNG, WebP or AVIF up to 5 MB.{!single && ' The first image is used as the cover; the second appears on hover.'}</p>
    </div>
  );
}
