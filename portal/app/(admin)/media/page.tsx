'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { api, type AudioMediaItem } from '@/lib/api';

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; progress: number; filename: string }
  | { phase: 'confirming'; filename: string }
  | { phase: 'error'; message: string };

export default function MediaPage() {
  const [items, setItems] = useState<AudioMediaItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMedia = useCallback(() => {
    startTransition(async () => {
      try {
        const list = await api.listMedia();
        setItems(list);
        setLoadError(null);
      } catch {
        setLoadError('Could not load media library. Is the backend running and S3 configured?');
      }
    });
  }, []);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  async function handleFile(file: File) {
    if (!file.type.startsWith('audio/')) {
      setUpload({ phase: 'error', message: 'Only audio files are accepted.' });
      return;
    }

    setUpload({ phase: 'uploading', progress: 0, filename: file.name });

    let uploadUrl: string;
    let objectKey: string;

    try {
      const resp = await api.requestUploadUrl(file.name, file.type);
      uploadUrl = resp.upload_url;
      objectKey = resp.object_key;
    } catch (e) {
      setUpload({ phase: 'error', message: `Could not get upload URL: ${String(e)}` });
      return;
    }

    // PUT directly to S3/MinIO — do NOT route through the portal proxy.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setUpload({ phase: 'uploading', progress: Math.round((ev.loaded / ev.total) * 100), filename: file.name });
        }
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 PUT ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(file);
    }).catch((e: unknown) => {
      setUpload({ phase: 'error', message: `Upload failed: ${String(e)}. Check that S3_ENDPOINT is publicly reachable and the bucket has CORS enabled for PUT.` });
      return Promise.reject(e);
    }).then(async () => {
      setUpload({ phase: 'confirming', filename: file.name });
      try {
        const item = await api.confirmUpload(objectKey, file.size, null);
        setItems((prev) => [item, ...prev]);
        setUpload({ phase: 'idle' });
      } catch (e) {
        setUpload({ phase: 'error', message: `Upload complete but confirm failed: ${String(e)}` });
      }
    }).catch(() => {
      // already set error above
    });
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function copyRegionUrl(id: string) {
    const base = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    navigator.clipboard.writeText(`${base}/media/${id}`).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function handleDelete(id: string, filename: string) {
    startTransition(async () => {
      try {
        await api.deleteMedia(id);
        setItems((prev) => prev.filter((item) => item.id !== id));
      } catch {
        alert(`Failed to delete "${filename}". Check relay/storage logs.`);
      }
    });
  }

  const busy = upload.phase === 'uploading' || upload.phase === 'confirming';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Media Library</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Upload audio files to S3/MinIO. Copy a file&apos;s region URL, then set it as
          the <code className="font-mono text-xs text-zinc-400">audio-src</code> WorldGuard flag on any region.
        </p>
      </div>

      {/* How-to callout */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400 space-y-1">
        <p className="font-medium text-zinc-300">How to wire a file to a region</p>
        <ol className="list-decimal list-inside space-y-0.5 text-zinc-500">
          <li>Upload a file below and click <span className="text-zinc-300">Copy region URL</span>.</li>
          <li>In-game: <code className="font-mono text-zinc-400">/rg flag &lt;region&gt; audio-src &lt;pasted URL&gt;</code></li>
          <li>Optionally: <code className="font-mono text-zinc-400">/rg flag &lt;region&gt; audio-loop allow</code></li>
        </ol>
        <p className="text-zinc-600">
          The relay serves a stable permalink that 302-redirects to a fresh S3 URL on each request.
        </p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer select-none
          ${busy ? 'cursor-default opacity-60 border-zinc-700' : isDragging ? 'border-sky-500 bg-sky-950/20' : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/40'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="sr-only"
          onChange={onFileInput}
          disabled={busy}
        />

        {upload.phase === 'idle' && (
          <>
            <p className="text-sm font-medium text-zinc-300">Drop an audio file here, or click to browse</p>
            <p className="text-xs text-zinc-600 mt-1">MP3, OGG, WAV, FLAC — any audio/* MIME type</p>
          </>
        )}

        {upload.phase === 'uploading' && (
          <div className="w-full max-w-sm space-y-2">
            <p className="text-sm text-zinc-300 truncate">{upload.filename}</p>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-150"
                style={{ width: `${upload.progress}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500 text-right">{upload.progress}%</p>
          </div>
        )}

        {upload.phase === 'confirming' && (
          <p className="text-sm text-zinc-400">Confirming upload…</p>
        )}

        {upload.phase === 'error' && (
          <div className="text-center space-y-1">
            <p className="text-sm text-red-400">{upload.message}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setUpload({ phase: 'idle' }); }}
              className="text-xs text-zinc-500 underline hover:text-zinc-300"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* File list */}
      {loadError ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-400">
          {loadError}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 p-10 text-center">
          <p className="text-zinc-500 text-sm">No files uploaded yet.</p>
          <p className="text-xs text-zinc-600 mt-1">
            Files appear here after a successful upload and confirm.
            Requires both PostgreSQL and S3 to be configured.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60">
                <Th>Filename</Th>
                <Th>Type</Th>
                <Th>Size</Th>
                <Th>Uploaded</Th>
                <Th>Region URL</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/40">
                  <Td>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-sky-400 hover:text-sky-300 truncate max-w-[240px] block"
                      title={item.filename}
                    >
                      {item.filename}
                    </a>
                    <span className="text-[10px] text-zinc-600 font-mono block truncate max-w-[240px]" title={item.object_key}>
                      {item.object_key}
                    </span>
                  </Td>
                  <Td>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {item.content_type}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-zinc-400">{item.size_bytes != null ? formatBytes(item.size_bytes) : '—'}</span>
                  </Td>
                  <Td>
                    <span className="text-zinc-400">{formatAge(item.created_at)}</span>
                  </Td>
                  <Td>
                    <button
                      onClick={() => copyRegionUrl(item.id)}
                      className="text-xs transition-colors px-2 py-1 rounded font-mono
                        text-sky-600 hover:text-sky-300 hover:bg-sky-950/20"
                      title={`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000'}/media/${item.id}`}
                    >
                      {copiedId === item.id ? 'Copied!' : 'Copy URL'}
                    </button>
                  </Td>
                  <Td>
                    <button
                      onClick={() => handleDelete(item.id, item.filename)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-950/20"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 align-top">{children}</td>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
