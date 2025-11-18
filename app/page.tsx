"use client";

import Image from "next/image";
import { ChangeEvent, useEffect, useState } from "react";

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
const MAX_GEMINI_FILES = 3;

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

type FileEntry = {
  id: string;
  file: File;
  previewUrl: string;
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

export default function Home() {
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [aiStatus, setAiStatus] = useState<StatusState>(initialStatus);
  const [bulkStatus, setBulkStatus] = useState<StatusState>(initialStatus);

  useEffect(() => {
    return () => {
      fileEntries.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    };
  }, [fileEntries]);

  const resetAiStatus = () => setAiStatus(initialStatus);
  const resetBulkStatus = () => setBulkStatus(initialStatus);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      setFileEntries((prev) => {
        prev.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
        return [];
      });
      resetAiStatus();
      resetBulkStatus();
      return;
    }

    const supported = files.filter(isSupportedFile);
    if (supported.length !== files.length) {
      setAiStatus({ type: "error", message: "JPEG / PNG / WebP 形式のみ対応しています。" });
    } else {
      resetAiStatus();
    }
    resetBulkStatus();

    let limited = supported;
    if (supported.length > MAX_GEMINI_FILES) {
      limited = supported.slice(0, MAX_GEMINI_FILES);
      setAiStatus({
        type: "error",
        message: `Gemini 解析に投げられるのは最大 ${MAX_GEMINI_FILES} 枚です。先頭 ${MAX_GEMINI_FILES} 枚のみを使用します。`,
      });
    }

    if (limited.length === 0) {
      setFileEntries((prev) => {
        prev.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
        return [];
      });
      resetBulkStatus();
      return;
    }

    const nextEntries = limited.map((file) => ({
      id: createClientId(),
      file,
      previewUrl: URL.createObjectURL(file),
      title: "",
      tags: "",
      writeStatus: initialStatus,
    }));

    setFileEntries((prev) => {
      prev.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
      return nextEntries;
    });
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

  const handleWriteMetadata = async (entryId: string): Promise<boolean> => {
    const entry = fileEntries.find((item) => item.id === entryId);
    if (!entry) return false;

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
      const downloadUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = getDownloadName(entry.file);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      updateEntry(entryId, (current) => ({
        ...current,
        writeStatus: { type: "success", message: "書き込みが完了しました。" },
      }));
      return true;
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

    return false;
  };

  const handleWriteAll = async () => {
    if (fileEntries.length === 0) {
      setBulkStatus({ type: "error", message: "先に画像を選択してください。" });
      return;
    }

    setBulkStatus({ type: "loading", message: "順番に書き込み中…" });
    let successCount = 0;

    for (const entry of fileEntries) {
      const result = await handleWriteMetadata(entry.id);
      if (result) {
        successCount += 1;
      }
    }

    if (successCount === fileEntries.length) {
      setBulkStatus({ type: "success", message: `${successCount} 件すべて書き込みました。` });
    } else if (successCount === 0) {
      setBulkStatus({ type: "error", message: "書き込みに失敗しました。各画像のステータスをご確認ください。" });
    } else {
      setBulkStatus({
        type: "error",
        message: `${fileEntries.length - successCount} 件でエラーが発生しました。各画像のステータスをご確認ください。`,
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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleAskAI}
              disabled={aiStatus.type === "loading" || fileEntries.length === 0}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300 sm:w-auto"
            >
              Gemini でタイトルとタグを生成
            </button>
            <p className="text-xs text-slate-500">
              1 回のリクエストで最大 {MAX_GEMINI_FILES} 枚をまとめて解析します。
            </p>
          </div>

          <div className="min-h-[1.5rem] text-sm">
            {aiStatus.type === "loading" && <p className="text-blue-600">{aiStatus.message}</p>}
            {aiStatus.type === "error" && <p className="text-red-600">{aiStatus.message}</p>}
            {aiStatus.type === "success" && <p className="text-green-600">{aiStatus.message}</p>}
          </div>

          {fileEntries.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white/70 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handleWriteAll}
                  disabled={bulkStatus.type === "loading"}
                  className="flex w-full items-center justify-center rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300 sm:w-auto"
                >
                  表示中のすべての画像に書き込んでダウンロード
                </button>
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
                      <p className="font-semibold text-slate-800">{entry.file.name || "image"}</p>
                      <p>書き込み後のファイル名: {getDownloadName(entry.file)}</p>
                      <p>ファイルサイズ: {(entry.file.size / 1024).toFixed(1)} KB</p>
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
