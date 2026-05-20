"use client";

import { useEffect, useState } from "react";
import { Trash2, X, FolderOpen, Calendar } from "lucide-react";
import {
  listProjects, deleteProject, formatDate,
  type ProjectListItem,
} from "@/lib/storage";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (id: string) => void;
}

export default function ProjectHistory({ open, onClose, onLoad }: Props) {
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setError(null);
      const list = await listProjects();
      setItems(list);
    } catch (e) {
      console.error(e);
      setError("Could not read saved projects.");
      setItems([]);
    }
  }

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  if (!open) return null;

  async function handleDelete(id: string) {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    await deleteProject(id);
    refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-amber-500" />
            <h2 className="text-lg font-bold text-stone-900">Saved Projects</h2>
            <span className="text-xs text-stone-400">{items?.length ?? "…"}</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {items === null && <p className="text-sm text-stone-400">Loading…</p>}
          {items && items.length === 0 && !error && (
            <div className="text-center py-12">
              <FolderOpen size={36} className="mx-auto text-stone-300 mb-2" />
              <p className="text-sm text-stone-500">No saved projects yet.</p>
              <p className="text-xs text-stone-400 mt-1">
                Complete an analysis through Step 5 — it&apos;ll be auto-saved here.
              </p>
            </div>
          )}
          {items && items.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((p) => (
                <div
                  key={p.id}
                  className="border border-stone-200 rounded-xl overflow-hidden bg-white hover:border-amber-300 hover:shadow-sm transition-all flex flex-col"
                >
                  {/* Thumbnail */}
                  <button
                    onClick={() => onLoad(p.id)}
                    className="block w-full aspect-[4/3] bg-stone-100 overflow-hidden cursor-pointer"
                  >
                    {p.thumbDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbDataUrl} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-400">
                        <FolderOpen size={28} />
                      </div>
                    )}
                  </button>

                  {/* Body */}
                  <div className="p-3 flex-1 flex flex-col">
                    <p className="font-semibold text-stone-900 text-sm truncate">{p.name}</p>
                    {p.clientName && (
                      <p className="text-xs text-stone-500 truncate">{p.clientName}</p>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-stone-400 mt-1">
                      <Calendar size={10} /> {formatDate(p.updatedAt)}
                    </div>
                    <div className="mt-2 pt-2 border-t border-stone-100 grid grid-cols-2 gap-1 text-[11px]">
                      <div>
                        <p className="text-stone-400">Capacity</p>
                        <p className="font-semibold text-stone-700 num">{p.summary.activeSystemKwp.toFixed(2)} kWp</p>
                      </div>
                      <div>
                        <p className="text-stone-400">Payback</p>
                        <p className="font-semibold text-stone-700 num">
                          {p.summary.paybackYears != null ? `${p.summary.paybackYears.toFixed(1)} yr` : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => onLoad(p.id)}
                        className="flex-1 text-xs font-medium bg-amber-500 hover:bg-amber-400 text-white py-1.5 rounded-lg transition-colors"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-xs text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
