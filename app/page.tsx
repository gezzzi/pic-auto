"use client";

import Image from "next/image";
import JSZip from "jszip";
import { ChangeEvent, useEffect, useRef, useState } from "react";

type StatusState =
  | { type: "idle"; message: "" }
  | { type: "loading"; message: string }
  | { type: "error" | "success"; message: string };

const initialStatus: StatusState = { type: "idle", message: "" };

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/x-webp",
]);
const SUPPORTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MAX_GEMINI_FILES = 50;

const isSupportedFile = (file: File | null) => {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  if (type && SUPPORTED_MIME_TYPES.has(type)) {
    return true;
  }
  const parts = (file.name || "").toLowerCase().split(".");
  const ext = parts.length > 1 ? parts.pop() : "";
  return !!ext && SUPPORTED_EXTENSIONS.has(ext);
};

const createClientId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getDownloadName = (file: File) => {
  const base = file.name?.replace(/\.[^/.]+$/, "") || "image";
  return `${base}-iptc.jpg`;
};

const getFileSignature = (file: File) => {
  const name = file.name || "image";
  return `${name}-${file.size}-${file.lastModified}`;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
};

type FileEntry = {
  id: string;
  file: File;
  previewUrl: string;
  signature: string;
  title: string;
  tags: string;
  writeStatus: StatusState;
};

type GeminiApiResult = {
  id?: string;
  title?: string;
  tags?: string[] | string;
};

type GeminiApiResponse = {
  results?: GeminiApiResult[];
  error?: string;
};

type WriteMetadataOptions = {
  skipDownload?: boolean;
};

type WriteResult =
  | { success: true; blob: Blob; downloadName: string }
  | { success: false };

export default function Home() {
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [aiStatus, setAiStatus] = useState<StatusState>(initialStatus);
  const [bulkStatus, setBulkStatus] = useState<StatusState>(initialStatus);
  const entriesRef = useRef<FileEntry[]>([]);

  useEffect(() => {
    entriesRef.current = fileEntries;
  }, [fileEntries]);

  useEffect(() => {
    return () => {
      entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    };
  }, []);

  const resetAiStatus = () => setAiStatus(initialStatus);
  const resetBulkStatus = () => setBulkStatus(initialStatus);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) return;

    const supported = files.filter(isSupportedFile);
    if (supported.length !== files.length) {
      setAiStatus({ type: "error", message: "JPEG / PNG / WebP 形式のみ対応しています。" });
    } else {
      resetAiStatus();
    }

    if (fileEntries.length >= MAX_GEMINI_FILES) {
      setAiStatus({ type: "error", message: `これ以上追加できません（最大 ${MAX_GEMINI_FILES} 枚）。` });
      return;
    }

    const existingSignatures = new Set(fileEntries.map((entry) => entry.signature));
    let availableSlots = MAX_GEMINI_FILES - fileEntries.length;
    const newEntries: FileEntry[] = [];
    let skippedDuplicates = 0;

    for (const file of supported) {
      if (availableSlots <= 0) {
        break;
      }
      const signature = getFileSignature(file);
      if (existingSignatures.has(signature)) {
        skippedDuplicates += 1;
        continue;
      }
      newEntries.push({
        id: createClientId(),
        file,
        previewUrl: URL.createObjectURL(file),
        signature,
        title: "",
        tags: "",
        writeStatus: initialStatus,
      });
      existingSignatures.add(signature);
      availableSlots -= 1;
    }

    if (newEntries.length === 0) {
      if (skippedDuplicates > 0) {
        setAiStatus({ type: "error", message: "すでに追加されている画像です。" });
      } else {
        setAiStatus({ type: "error", message: `これ以上追加できません（最大 ${MAX_GEMINI_FILES} 枚）。` });
      }
      return;
    }

    if (skippedDuplicates > 0 || newEntries.length < supported.length) {
      setAiStatus({
        type: "error",
        message: `一部の画像はスキップされました。現在の上限は ${MAX_GEMINI_FILES} 枚です。`,
      });
    } else {
      resetAiStatus();
    }

    setFileEntries((prev) => [...prev, ...newEntries]);
    resetBulkStatus();
  };

  const updateEntry = (entryId: string, updater: (entry: FileEntry) => FileEntry) => {
    setFileEntries((entries) => entries.map((entry) => (entry.id === entryId ? updater(entry) : entry)));
  };

  const handleTitleChange = (entryId: string, value: string) => {
    updateEntry(entryId, (entry) => ({ ...entry, title: value, writeStatus: initialStatus }));
  };

  const handleTagsChange = (entryId: string, value: string) => {
    updateEntry(entryId, (entry) => ({ ...entry, tags: value, writeStatus: initialStatus }));
  };

const handleRemoveEntry = (entryId: string) => {
  if (entryId === "__all__") {
    setFileEntries((entries) => {
      entries.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
      return [];
    });
    resetAiStatus();
    resetBulkStatus();
    return;
  }

  let removed = false;
  let nextLength = fileEntries.length;
  setFileEntries((entries) => {
    const target = entries.find((entry) => entry.id === entryId);
    if (!target) {
      nextLength = entries.length;
      return entries;
    }
    removed = true;
    URL.revokeObjectURL(target.previewUrl);
    const next = entries.filter((entry) => entry.id !== entryId);
    nextLength = next.length;
    return next;
  });

  if (removed && nextLength === 0) {
    resetAiStatus();
    resetBulkStatus();
  }
};

  const handleAskAI = async () => {
    if (fileEntries.length === 0) {
      setAiStatus({ type: "error", message: "先に画像を選択してください。" });
      return;
    }

    if (fileEntries.length > MAX_GEMINI_FILES) {
      setAiStatus({
        type: "error",
        message: `Gemini 解析に投げられるのは最大 ${MAX_GEMINI_FILES} 枚です。`,
      });
      return;
    }

    const formData = new FormData();
    formData.append(
      "meta",
      JSON.stringify(fileEntries.map((entry) => ({ id: entry.id, name: entry.file.name }))),
    );
    fileEntries.forEach((entry) => {
      formData.append("files", entry.file, entry.file.name);
    });

    try {
      setAiStatus({ type: "loading", message: "Gemini で解析中…" });
      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        body: formData,
      });

      let body: GeminiApiResponse | null = null;
      try {
        body = (await response.json()) as GeminiApiResponse;
      } catch {
        body = null;
      }

      if (!response.ok) {
        const errorMessage =
          body && typeof body.error === "string" && body.error.length > 0
            ? body.error
            : "タイトルとタグの生成に失敗しました。";
        setAiStatus({ type: "error", message: errorMessage });
        return;
      }

      const results = Array.isArray(body?.results) ? body.results : [];
      if (results.length === 0) {
        setAiStatus({ type: "error", message: "生成結果を取得できませんでした。" });
        return;
      }

      const resultMap = new Map<string, GeminiApiResult>();
      results.forEach((item) => {
        if (item && typeof item.id === "string") {
          resultMap.set(item.id, item);
        }
      });

      if (resultMap.size === 0) {
        setAiStatus({ type: "error", message: "生成結果の形式が不正です。" });
        return;
      }

      const snapshot = fileEntries;
      setFileEntries((entries) =>
        entries.map((entry) => {
          const match = resultMap.get(entry.id);
          if (!match) {
            return entry;
          }

          let nextTags = entry.tags;
          if (Array.isArray(match.tags)) {
            const sanitized = match.tags
              .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
              .filter((tag) => tag.length > 0);
            if (sanitized.length > 0) {
              nextTags = sanitized.join(", ");
            }
          } else if (typeof match.tags === "string" && match.tags.trim().length > 0) {
            nextTags = match.tags;
          }

          const nextTitle = typeof match.title === "string" && match.title.trim().length > 0 ? match.title.trim() : entry.title;

          return {
            ...entry,
            title: nextTitle,
            tags: nextTags,
            writeStatus: initialStatus,
          };
        }),
      );

      const missingCount = snapshot.filter((entry) => !resultMap.has(entry.id)).length;
      if (missingCount > 0) {
        setAiStatus({
          type: "error",
          message: `一部の画像で結果を取得できませんでした (未取得 ${missingCount} 件)。`,
        });
      } else {
        setAiStatus({
          type: "success",
          message: "タイトルとタグを取得しました。必要に応じて編集してください。",
        });
      }
    } catch (error) {
      console.error("Gemini generation failed", error);
      setAiStatus({ type: "error", message: "Gemini へのリクエストに失敗しました。" });
    }
  };

  const handleWriteMetadata = async (
    entryId: string,
    options?: WriteMetadataOptions,
  ): Promise<WriteResult> => {
    const entry = fileEntries.find((item) => item.id === entryId);
    if (!entry) return { success: false };

    updateEntry(entryId, (current) => ({
      ...current,
      writeStatus: { type: "loading", message: "メタデータを書き込み中…" },
    }));

    const formData = new FormData();
    formData.append("file", entry.file);
    formData.append("title", entry.title);
    formData.append("tags", entry.tags);

    try {
      const response = await fetch("/api/iptc/write", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = "メタデータの書き込みに失敗しました。";
        try {
          const errorBody = (await response.json()) as { error?: unknown };
          if (typeof errorBody?.error === "string") {
            errorMessage = errorBody.error;
          }
        } catch {
          // ignore
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const downloadName = getDownloadName(entry.file);

      if (!options?.skipDownload) {
        downloadBlob(blob, downloadName);
      }

      updateEntry(entryId, (current) => ({
        ...current,
        writeStatus: {
          type: "success",
          message: options?.skipDownload ? "書き込み済み (ZIP に追加)" : "書き込みが完了しました。",
        },
      }));
      return { success: true, blob, downloadName };
    } catch (error) {
      const message =
        error instanceof Error && typeof error.message === "string"
          ? error.message
          : "予期しないエラーが発生しました。";
      updateEntry(entryId, (current) => ({
        ...current,
        writeStatus: { type: "error", message },
      }));
    }

    return { success: false };
  };

  const handleWriteAll = async () => {
    if (fileEntries.length === 0) {
      setBulkStatus({ type: "error", message: "先に画像を選択してください。" });
      return;
    }

    setBulkStatus({ type: "loading", message: "順番に書き込み中…" });
    let successCount = 0;
    const zip = new JSZip();

    for (const entry of fileEntries) {
      const result = await handleWriteMetadata(entry.id, { skipDownload: true });
      if (result.success) {
        successCount += 1;
        zip.file(result.downloadName, result.blob);
      }
    }

    if (successCount === 0) {
      setBulkStatus({ type: "error", message: "書き込みに失敗しました。各画像のステータスをご確認ください。" });
      return;
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipName = `iptc-batch-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    downloadBlob(zipBlob, zipName);

    if (successCount === fileEntries.length) {
      setBulkStatus({ type: "success", message: `${successCount} 件すべて ZIP にまとめてダウンロードしました。` });
    } else {
      setBulkStatus({
        type: "error",
        message: `${fileEntries.length - successCount} 件でエラーが発生しました。成功したファイルのみ ZIP に含まれています。`,
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 text-slate-900">
      <main className="mx-auto w-full max-w-5xl rounded-2xl bg-white p-8 shadow-lg">
        <header className="mb-8 space-y-4">
          <p className="text-sm font-semibold tracking-wide text-blue-600">IPTC WRITER</p>
          <h1 className="text-3xl font-bold text-slate-900">JPEG に IPTC タイトルとタグを書き込む</h1>
          <p className="text-sm text-slate-600">
            JPEG / PNG / WebP ファイルを最大 {MAX_GEMINI_FILES} 枚まで選び、Gemini によるタイトルとタグの提案をもらって IPTC/XMP を書き込みます。
          </p>
        </header>

        <section className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="files" className="block text-sm font-semibold text-slate-800">
              画像ファイル (最大 {MAX_GEMINI_FILES} 枚)
            </label>
            <input
              id="files"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleFileChange}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
            />
            <p className="text-xs text-slate-500">
              対応形式: JPEG（.jpg, .jpeg）/ PNG（.png）/ WebP（.webp） ※Gemini 解析は最大 {MAX_GEMINI_FILES} 枚、出力は常に JPEG です
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={handleAskAI}
              disabled={aiStatus.type === "loading" || fileEntries.length === 0}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300 sm:w-auto"
            >
              Gemini でタイトルとタグを生成
            </button>
            <div className="text-xs text-slate-500">
              <p>1 回のリクエストで最大 {MAX_GEMINI_FILES} 枚をまとめて解析します。</p>
              <p>現在の枚数: {fileEntries.length} / {MAX_GEMINI_FILES}</p>
            </div>
          </div>

          <div className="min-h-[1.5rem] text-sm">
            {aiStatus.type === "loading" && <p className="text-blue-600">{aiStatus.message}</p>}
            {aiStatus.type === "error" && <p className="text-red-600">{aiStatus.message}</p>}
            {aiStatus.type === "success" && <p className="text-green-600">{aiStatus.message}</p>}
          </div>

          {fileEntries.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white/70 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex w-full flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleWriteAll}
                    disabled={bulkStatus.type === "loading"}
                    className="flex w-full items-center justify-center rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    表示中のすべての画像に書き込んでダウンロード
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveEntry("__all__")}
                    disabled={bulkStatus.type === "loading"}
                    className="flex w-full items-center justify-center rounded-lg border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed"
                  >
                    全削除
                  </button>
                </div>
                <p className="text-xs text-slate-500">各ファイルは順番に処理されます。</p>
              </div>
              <div className="min-h-[1.25rem] text-sm">
                {bulkStatus.type === "loading" && <p className="text-blue-600">{bulkStatus.message}</p>}
                {bulkStatus.type === "error" && <p className="text-red-600">{bulkStatus.message}</p>}
                {bulkStatus.type === "success" && <p className="text-green-600">{bulkStatus.message}</p>}
              </div>
            </div>
          )}
        </section>

        {fileEntries.length === 0 ? (
          <p className="mt-10 text-sm text-slate-500">画像を選択するとここにプレビューと入力欄が表示されます。</p>
        ) : (
          <>
            <section className="mt-10 space-y-8">
              {fileEntries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row">
                  <div className="flex-shrink-0">
                    <Image
                      src={entry.previewUrl}
                      alt={entry.file.name || "preview"}
                      width={320}
                      height={320}
                      sizes="160px"
                      unoptimized
                      className="h-40 w-40 rounded-xl object-cover object-center"
                    />
                  </div>
                  <div className="flex-1 space-y-2 text-sm text-slate-600">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-slate-800">{entry.file.name || "image"}</p>
                        <p>書き込み後のファイル名: {getDownloadName(entry.file)}</p>
                        <p>ファイルサイズ: {(entry.file.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveEntry(entry.id)}
                        className="rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>

                  <div className="mt-6 space-y-4">
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-slate-800" htmlFor={`title-${entry.id}`}>
                        タイトル
                      </label>
                      <input
                        id={`title-${entry.id}`}
                        type="text"
                        value={entry.title}
                        onChange={(e) => handleTitleChange(entry.id, e.target.value)}
                        placeholder="例: 深夜の渋谷スクランブル交差点"
                        className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-slate-800" htmlFor={`tags-${entry.id}`}>
                        タグ（カンマ区切り）
                      </label>
                      <input
                        id={`tags-${entry.id}`}
                        type="text"
                        value={entry.tags}
                        onChange={(e) => handleTagsChange(entry.id, e.target.value)}
                        placeholder="夜景, 都市, 雨, 光跡, 日本"
                        className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    <button
                      type="button"
                      onClick={() => handleWriteMetadata(entry.id)}
                      disabled={entry.writeStatus.type === "loading"}
                      className="flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      この画像に書き込んでダウンロード
                    </button>

                    <div className="min-h-[1.25rem] text-sm">
                      {entry.writeStatus.type === "loading" && (
                        <p className="text-blue-600">{entry.writeStatus.message}</p>
                      )}
                      {entry.writeStatus.type === "error" && (
                        <p className="text-red-600">{entry.writeStatus.message}</p>
                      )}
                      {entry.writeStatus.type === "success" && (
                        <p className="text-green-600">{entry.writeStatus.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
