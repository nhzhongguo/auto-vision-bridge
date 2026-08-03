#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto Vision Bridge 演示素材生成器
=================================
生成 README 里的两张图：
  docs/demo-terminal.png   端到端实测（真实运行输出渲染成终端样式）
  docs/deploy-demo.gif     AI 一键部署流程动画

用法：
  python docs/make-demo-assets.py
依赖：Pillow（pip install pillow），Windows 自带字体。
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
F_ASCII = "C:/Windows/Fonts/consola.ttf"
F_ASCII_B = "C:/Windows/Fonts/consolab.ttf"
F_CJK = "C:/Windows/Fonts/msyh.ttc"
F_CJK_B = "C:/Windows/Fonts/msyhbd.ttc"
F_EMOJI = "C:/Windows/Fonts/seguiemj.ttf"

BG = "#0d1117"
TITLE_BG = "#161b22"
TITLE_FG = "#8b949e"
BORDER = "#21262d"
FG = "#e6edf3"
GREEN = "#3fb950"
GREEN_B = "#7ee787"
YELLOW = "#d29922"
BLUE = "#79c0ff"
GRAY = "#8b949e"
LIGHT = "#c9d1d9"
CURSOR = "#3fb950"

CJK_EXTRA = set("—‘’“”…·、。，：；！？（）【】《》")


def make_fonts(size, bold=False):
    return {
        "a": ImageFont.truetype(F_ASCII_B if bold else F_ASCII, size),
        "c": ImageFont.truetype(F_CJK_B if bold else F_CJK, size),
        "e": ImageFont.truetype(F_EMOJI, size),
    }


def is_emoji(ch):
    o = ord(ch)
    return o >= 0x1F000 or 0x2700 <= o <= 0x27BF


def is_cjk(ch):
    o = ord(ch)
    return (
        0x2E80 <= o <= 0x9FFF
        or 0xF900 <= o <= 0xFAFF
        or 0xFF00 <= o <= 0xFFEF
        or ch in CJK_EXTRA
    )


def pick(ch, fonts):
    if is_emoji(ch):
        return fonts["e"]
    if is_cjk(ch):
        return fonts["c"]
    return fonts["a"]


def text_w(text, fonts):
    return sum(pick(ch, fonts).getlength(ch) for ch in text)


def draw_text(d, xy, text, fonts, fill):
    x, y = xy
    for ch in text:
        f = pick(ch, fonts)
        d.text((x, y), ch, font=f, fill=fill)
        x += f.getlength(ch)


def wrap(text, fonts, max_w):
    if not text:
        return [""]
    lines, cur = [], ""
    for ch in text:
        if text_w(cur + ch, fonts) > max_w:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def terminal(w, h, title):
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 34], fill=TITLE_BG)
    for cx, col in ((14, "#ff5f56"), (30, "#ffbd2e"), (46, "#27c93f")):
        d.ellipse([cx, 11, cx + 12, 23], fill=col)
    draw_text(d, (70, 10), title, make_fonts(13), TITLE_FG)
    d.line([0, 34, w, 34], fill=BORDER)
    return img, d


def build_png(path, title, body, w=980, pad=18, size=15):
    fonts = make_fonts(size)
    boldf = make_fonts(size, True)
    line_h = int(size * 1.5)
    rows = []
    for text, color, bold in body:
        f = boldf if bold else fonts
        for ln in wrap(text, f, w - pad * 2):
            rows.append((ln, color, bold))
    h = 34 + pad + len(rows) * line_h + pad + 10
    img, d = terminal(w, h, title)
    y = 34 + pad
    for text, color, bold in rows:
        draw_text(d, (pad, y), text, boldf if bold else fonts, color)
        y += line_h
    img.save(path)
    print(f"PNG saved: {path} ({w}x{h})")


def build_gif(path, title, body, w=900, h=580, pad=18, size=15, pause=5, fps=110):
    fonts = make_fonts(size)
    boldf = make_fonts(size, True)
    line_h = int(size * 1.5)
    rows = []
    for text, color, bold in body:
        f = boldf if bold else fonts
        for ln in wrap(text, f, w - pad * 2):
            rows.append((ln, color, bold))

    frames = []
    for i in range(len(rows) + 1):
        for _ in range(pause):
            img, d = terminal(w, h, title)
            y = 34 + pad
            for j, (text, color, bold) in enumerate(rows):
                if j >= i:
                    break
                draw_text(d, (pad, y), text, boldf if bold else fonts, color)
                y += line_h
            if i < len(rows):
                f = boldf if rows[i][2] else fonts
                cx = pad + text_w(rows[i][0], f)
                cy = 34 + pad + i * line_h
                d.rectangle([cx, cy + 2, cx + 9, cy + line_h - 3], fill=CURSOR)
            frames.append(img)

    # 结尾：全部行 + 光标闪烁两下
    for k in range(4):
        img, d = terminal(w, h, title)
        y = 34 + pad
        for text, color, bold in rows:
            draw_text(d, (pad, y), text, boldf if bold else fonts, color)
            y += line_h
        if k % 2 == 0:
            f = boldf if rows[-1][2] else fonts
            cx = pad + text_w(rows[-1][0], f)
            cy = 34 + pad + (len(rows) - 1) * line_h
            d.rectangle([cx, cy + 2, cx + 9, cy + line_h - 3], fill=CURSOR)
        frames.append(img)

    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=fps,
        loop=0,
        optimize=True,
    )
    print(f"GIF saved: {path} ({len(frames)} frames, {fps}ms/frame)")


# ---------------------------------------------------------------- PNG：端到端实测
PNG_TITLE = "Auto Vision Bridge - 端到端实测 (真实运行输出)"
PNG_BODY = [
    ("PS C:\\Users\\...\\glm-vision-mcp> node bridge/test-bridge.mjs --image test-vision.png", FG, False),
    ("", None, False),
    ("===== 1) deepseek-v4-flash + 图片（应自动转换） =====", FG, True),
    ("HTTP 200 | 1775ms", GREEN, False),
    ("图片里写的文字是：**“Hello 42 Vision”**。", LIGHT, False),
    ("→ ✅ 自动识别验证通过：图片已由视觉模型转成文字，上游正常回答", GREEN, False),
    ("", None, False),
    ("===== 2) gpt-4o + 图片（应原样透传） =====", FG, True),
    ("HTTP 400 | 95ms", YELLOW, False),
    ("错误: Failed to deserialize the JSON body into the target type: messages[0]: unknown variant `image_url`, expected `text` at line 1 column 7089", GRAY, False),
    ("→ ✅ 透传验证通过：图片原样到达上游（未调用视觉 API）", GREEN, False),
    ("", None, False),
    ("===== 3) 无图普通请求（应正常透传） =====", FG, True),
    ("HTTP 200 | 1012ms", GREEN, False),
    ("好", LIGHT, False),
    ("→ ✅ 透传验证通过：无图请求零开销", GREEN, False),
    ("", None, False),
    ("🎉 全部通过！Auto Vision Bridge 工作正常。", GREEN_B, True),
]

# ---------------------------------------------------------------- GIF：AI 一键部署
GIF_TITLE = "Auto Vision Bridge - AI 一键部署演示"
GIF_BODY = [
    ("[用户 → AI 助手]", GRAY, True),
    ("用户: 请克隆并部署这个仓库，部署前先确认我是否同意 👍", BLUE, False),
    ("AI: 好的！我先检查环境，再逐项问你配置，最后验证交付。", GREEN_B, False),
    ("AI: 是否同意现在开始部署？(y/n)", GREEN_B, False),
    ("用户: y，同意 ✅", BLUE, False),
    ("", None, False),
    ("[1/6] 环境检查: Node.js v20.11.0 已安装 ✅", FG, True),
    ("[2/6] 克隆仓库 auto-vision-bridge ✅", FG, True),
    ("[3/6] 询问配置", FG, True),
    ("      · 视觉模型: 1) 智谱 glm-4.6v (推荐)  2) 硅基流动 Qwen2.5-VL  3) 自定义", LIGHT, False),
    ("用户: 选 1，智谱 glm-4.6v", BLUE, False),
    ("      · 视觉 API Key: •••••••••••• (静默输入，不进 git)", LIGHT, False),
    ("[4/6] 写入 bridge/config.json（Key 不进 git）✅", FG, True),
    ("[5/6] 启动 bridge → http://127.0.0.1:57399 ✅", FG, True),
    ("[6/6] 验证: /health OK · 端到端识图通过 ✅", FG, True),
    ("", None, False),
    ("🎉 部署完成！以后直接发图即可:", GREEN_B, True),
    ("    模型支持视觉 → 原样透传", GREEN, False),
    ("    模型不支持 → 自动识图转文字", GREEN, False),
]

if __name__ == "__main__":
    build_png(os.path.join(ROOT, "demo-terminal.png"), PNG_TITLE, PNG_BODY)
    build_gif(os.path.join(ROOT, "deploy-demo.gif"), GIF_TITLE, GIF_BODY)
    print("done")
