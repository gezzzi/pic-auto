// npm install node-exiftool dist-exiftool
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ExiftoolProcess } from "node-exiftool";
import distExiftool from "dist-exiftool";
import sharp from "sharp";

type IPTCWritePayload = {
  title?: string;
  tags?: string[];
};

const JPEG_MIME = "image/jpeg";
const PNG_MIME = "image/png";
const WEBP_MIME = "image/webp";
const WEBP_MIME_ALT = "image/x-webp";

export const runtime = "nodejs";

const sanitizeFilenameForDownload = (baseName: string) => {
  const safeBase = baseName.replace(/[^a-zA-Z0-9-_]+/g, "_");
  return (safeBase || "image") + "-iptc.jpg";
};

const resolveDistExiftoolPath = (rawPath: string): string => {
  if (!rawPath) {
    return rawPath;
  }

  if (/^(?:\\|\/)ROOT[\\/]/.test(rawPath)) {
    const relative = rawPath.replace(/^(?:\\|\/)ROOT[\\/]/, "");
    const segments = relative.split(/[/\\]+/).filter(Boolean);
    return path.join(process.cwd(), ...segments);
  }

  return rawPath;
};

const getUploadFormat = (
  file: File,
): "jpeg" | "png" | "webp" | null => {
  const type = (file.type || "").toLowerCase();

  if (type === JPEG_MIME) {
    return "jpeg";
  }

  if (type === PNG_MIME) {
    return "png";
  }

  if (type === WEBP_MIME || type === WEBP_MIME_ALT) {
    return "webp";
  }

  const extension = path.extname(file.name || "").toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "jpeg";
  }
  if (extension === ".png") {
    return "png";
  }
  if (extension === ".webp") {
    return "webp";
  }
  return null;
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "画像ファイルを選択してください。" },
      { status: 400 },
    );
  }

  const uploadFormat = getUploadFormat(file);
  if (!uploadFormat) {
    return NextResponse.json(
      { error: "JPEG / PNG / WebP 形式のみ対応しています。" },
      { status: 400 },
    );
  }

  const titleValue = formData.get("title");
  const tagsValue = formData.get("tags");

  const payload: IPTCWritePayload = {};

  if (typeof titleValue === "string" && titleValue.trim().length > 0) {
    payload.title = titleValue.trim();
  }

  if (typeof tagsValue === "string") {
    const tagList = tagsValue
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    if (tagList.length > 0) {
      payload.tags = tagList;
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  let buffer: Buffer = Buffer.from(arrayBuffer);

  if (uploadFormat === "png" || uploadFormat === "webp") {
    buffer = await sharp(buffer).jpeg({ quality: 95 }).toBuffer();
  }

  const tempFilePath = path.join(
    os.tmpdir(),
    `iptc-${crypto.randomUUID()}.jpg`,
  );

  const downloadName = sanitizeFilenameForDownload(
    path.parse(file.name || "image").name,
  );

  try {
    await fs.writeFile(tempFilePath, buffer);

    const metadataUpdates: Record<string, string | string[]> = {};

    if (payload.title) {
      metadataUpdates["XMP-dc:Title"] = payload.title;
    }

    if (payload.tags) {
      metadataUpdates["XMP-dc:Subject"] = payload.tags;
      metadataUpdates["IPTC:Keywords"] = payload.tags;
      metadataUpdates["IPTC:CodedCharacterSet"] = "UTF8";
    }

    if (Object.keys(metadataUpdates).length > 0) {
      const exiftoolPath = resolveDistExiftoolPath(distExiftool as string);
      const exiftool = new ExiftoolProcess(exiftoolPath);

      await exiftool.open();
      try {
        await exiftool.writeMetadata(tempFilePath, metadataUpdates, [
          "overwrite_original",
        ]);
      } finally {
        await exiftool.close();
      }
    }

    const updatedBuffer = await fs.readFile(tempFilePath);

    return new NextResponse(updatedBuffer, {
      status: 200,
      headers: {
        "Content-Type": JPEG_MIME,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
      },
    });
  } catch (error) {
    console.error("Failed to write IPTC metadata", error);
    return NextResponse.json({ error: "IPTC 書き込み中にエラーが発生しました。" }, { status: 500 });
  } finally {
    await fs.unlink(tempFilePath).catch(() => undefined);
  }
}
