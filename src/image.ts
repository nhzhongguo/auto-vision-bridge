/**
 * 图片输入归一化工具
 * 支持：本地路径（含 file://）、http(s) 远程地址、data URL、纯 base64
 * 统一输出为 data URL / http(s) URL，供各视觉模型提供商使用。
 */
import { access, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB 软上限

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
};

/** 通过文件魔数识别图片 MIME 类型 */
export function mimeFromBuffer(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 6 && buf.subarray(0, 6).toString("latin1") === "GIF89a") return "image/gif";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) return "image/heic";
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export interface NormalizedImage {
  url: string;
  note: string;
}

/** 读取本地图片文件 → data URL */
async function readLocalFile(p: string): Promise<NormalizedImage> {
  const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
  const st = await stat(abs).catch(() => null);
  if (!st) throw new Error(`文件不存在：${abs}`);
  if (!st.isFile()) throw new Error(`不是文件：${abs}`);
  if (st.size > MAX_IMAGE_BYTES)
    throw new Error(`图片过大（${(st.size / 1024 / 1024).toFixed(1)}MB > 15MB），请压缩后再试`);

  const buf = await readFile(abs);
  const mime = mimeFromBuffer(buf) ?? EXT_MIME[extname(abs).toLowerCase()] ?? null;
  if (!mime) throw new Error(`无法识别图片格式：${abs}（支持 jpg/png/gif/webp/bmp/avif/heic）`);

  return {
    url: `data:${mime};base64,${buf.toString("base64")}`,
    note: `本地文件 ${abs}（${mime}，${(st.size / 1024).toFixed(0)}KB）`,
  };
}

/**
 * 把用户给的图片输入统一归一化为模型可用的 URL / data URL。
 */
export async function normalizeImageSource(image: string): Promise<NormalizedImage> {
  const s = image.trim();
  if (!s) throw new Error("image 参数不能为空");

  if (s.startsWith("data:")) return { url: s, note: "data URL 原样传递" };

  if (/^https?:\/\//i.test(s)) return { url: s, note: "远程 URL 原样传递（需公网可达）" };

  if (s.startsWith("file://")) return readLocalFile(fileURLToPath(s));

  if (await pathExists(s)) return readLocalFile(s);

  // 兜底：当作 base64 解析
  const compact = s.replace(/\s+/g, "");
  if (compact.length > 64 && /^[A-Za-z0-9+/]+=*$/.test(compact)) {
    const buf = Buffer.from(compact, "base64");
    if (buf.length > 0) {
      const mime = mimeFromBuffer(buf);
      if (mime) return { url: `data:${mime};base64,${compact}`, note: `base64 字符串（识别为 ${mime}）` };
      throw new Error("base64 数据无法识别为常见图片格式（jpg/png/gif/webp/bmp/avif/heic）");
    }
  }

  throw new Error(`无法识别的图片输入（不是文件路径、URL 或 base64）：${s.slice(0, 80)}`);
}
