"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";

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

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<StatusState>(initialStatus);

  const downloadName = useMemo(() => {
    if (!selectedFile) return "image-iptc.jpg";
    const base = selectedFile.name?.replace(/\.[^/.]+$/, "") || "image";
    return `${base}-iptc.jpg`;
  }, [selectedFile]);

  const resetStatus = () => setStatus(initialStatus);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    resetStatus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedFile) {
      setStatus({ type: "error", message: "JPEG ファイルを選択してください。" });
      return;
    }

    if (!isSupportedFile(selectedFile)) {
      setStatus({
        type: "error",
        message: "JPEG / PNG / WebP 形式のみ対応しています。",
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("title", title);
    formData.append("tags", tags);

    try {
      setStatus({ type: "loading", message: "処理中…" });
      const response = await fetch("/api/iptc/write", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = "メタデータの書き込みに失敗しました。";
        try {
          const errorBody = await response.json();
          if (errorBody?.error) {
            errorMessage = errorBody.error;
          }
        } catch {
          // JSON パースに失敗した場合はデフォルトメッセージを使用
        }
        setStatus({ type: "error", message: errorMessage });
        return;
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      setStatus({
        type: "success",
        message: "書き込みが完了し、ダウンロードが開始されました。",
      });
    } catch (error) {
      console.error("IPTC write request failed", error);
      setStatus({
        type: "error",
        message: "予期しないエラーが発生しました。",
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 text-slate-900">
      <main className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-8 shadow-lg">
        <header className="mb-8 space-y-4">
          <p className="text-sm font-semibold tracking-wide text-blue-600">
            IPTC WRITER
          </p>
          <h1 className="text-3xl font-bold text-slate-900">
            JPEG に IPTC タイトルとタグを書き込む
          </h1>
          <p className="text-sm text-slate-600">
            JPEG ファイルをアップロードし、タイトルとタグ（カンマ区切り）を設定して
            IPTC/XMP 情報を書き込みます。
          </p>
        </header>

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label
              htmlFor="file"
              className="block text-sm font-semibold text-slate-800"
            >
              画像ファイル
            </label>
            <input
              id="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
            />
            <p className="text-xs text-slate-500">
              対応形式: JPEG（.jpg, .jpeg）/ PNG（.png）/ WebP（.webp） ※出力は常に
              JPEG です
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="title"
              className="block text-sm font-semibold text-slate-800"
            >
              タイトル
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                resetStatus();
              }}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="例: Midnight cityscape"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="tags"
              className="block text-sm font-semibold text-slate-800"
            >
              タグ（カンマ区切り）
            </label>
            <input
              id="tags"
              type="text"
              value={tags}
              onChange={(event) => {
                setTags(event.target.value);
                resetStatus();
              }}
              placeholder="night, city, bokeh, tokyo"
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <button
            type="submit"
            className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
            disabled={status.type === "loading"}
          >
            メタデータを書き込んでダウンロード
          </button>

          <div className="min-h-[1.5rem] text-sm">
            {status.type === "loading" && (
              <p className="text-blue-600">{status.message}</p>
            )}
            {status.type === "error" && (
              <p className="text-red-600">{status.message}</p>
            )}
            {status.type === "success" && (
              <p className="text-green-600">{status.message}</p>
            )}
          </div>
        </form>

        {selectedFile && (
          <p className="mt-8 text-xs text-slate-500">
            書き込み後のファイル名: <span className="font-semibold">{downloadName}</span>
          </p>
        )}
      </main>
    </div>
  );
}
