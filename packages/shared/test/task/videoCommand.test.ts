import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

import { genMergeAssMp4Command, burnFontFamily, readFontFamily } from "../../src/task/video.js";

// fluent-ffmpeg 命令对象：取最终传给 ffmpeg 的参数
const getArgs = (command: unknown): string[] => (command as any)._getArguments();

const getFilterValue = (args: string[]): string => {
  const index = args.indexOf("-filter_complex");
  if (index === -1) return "";
  return args[index + 1] ?? "";
};

/**
 * 构造带 name 表的最小 sfnt 字体（TTF/OTF 容器）：
 * 仅含 nameID=1（family）的 Windows 平台记录，UTF-16BE 编码。
 * 用于验证 readFontFamily 从字体文件内部解析 family 名
 */
const buildTestFont = (family: string): Buffer => {
  const nameString = Buffer.from(family, "utf16le");
  nameString.swap16(); // 转为 UTF-16BE
  // name 表：format(2) count(2) stringOffset(2) + 1 条记录(12) + 字符串数据
  const nameTable = Buffer.alloc(6 + 12 + nameString.length);
  nameTable.writeUInt16BE(0, 0); // format
  nameTable.writeUInt16BE(1, 2); // count
  nameTable.writeUInt16BE(6 + 12, 4); // stringOffset
  nameTable.writeUInt16BE(3, 6); // platformID: Windows
  nameTable.writeUInt16BE(1, 8); // encodingID: Unicode BMP
  nameTable.writeUInt16BE(0x409, 10); // languageID: en-US
  nameTable.writeUInt16BE(1, 12); // nameID: family
  nameTable.writeUInt16BE(nameString.length, 14);
  nameTable.writeUInt16BE(0, 16); // 字符串相对 stringOffset 的偏移
  nameString.copy(nameTable, 18);
  // sfnt 头：version(4) numTables(2) searchRange(2) entrySelector(2) rangeShift(2) + 表目录记录(16)
  const font = Buffer.alloc(12 + 16 + nameTable.length);
  font.writeUInt32BE(0x00010000, 0); // TTF version
  font.writeUInt16BE(1, 4); // numTables
  font.write("name", 12, "latin1"); // 表标签
  font.writeUInt32BE(0, 16); // checksum（解析不校验）
  font.writeUInt32BE(12 + 16, 20); // 表偏移
  font.writeUInt32BE(nameTable.length, 24); // 表长度
  nameTable.copy(font, 28);
  return font;
};

let fontTmpFile = "";
let customFontFile = "";

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), "blt-font-test");
  await fs.ensureDir(dir);
  // 空文件：命令构建只检查存在性；family 解析失败回退默认压制字体名
  fontTmpFile = path.join(dir, "SourceHanSansSC-Normal.otf");
  await fs.writeFile(fontTmpFile, "");
  // 带真实 name 表的字体：验证 family 自动解析
  customFontFile = path.join(dir, "custom-font.ttf");
  await fs.writeFile(customFontFile, buildTestFont("My Custom Font"));
});

afterAll(async () => {
  await fs.remove(path.dirname(fontTmpFile));
});

describe("genMergeAssMp4Command 硬件解码显式链路", () => {
  it("CPU 滤镜链（弹幕+时间戳）+ nvenc 硬解：保留 -hwaccel 并自动补 hwdownload，链尾不回传显存", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "hevc_nvenc",
        bitrateControl: "CQ",
        crf: 28,
        audioCodec: "copy",
        decode: true,
        addTimestamp: true,
      },
      { startTimestamp: 1790817300 },
    );
    const args = getArgs(command);
    expect(args).toContain("-hwaccel");
    expect(args).toContain("cuda");
    expect(args).toContain("-hwaccel_output_format");
    const filter = getFilterValue(args);
    expect(filter).toContain("hwdownload");
    expect(filter).toContain("format=nv12");
    expect(filter).toContain("subtitles=");
    expect(filter).toContain("drawtext=");
    // 链尾刻意不补 hwupload：源中途变分辨率时 ffmpeg 会在 GPU 上传之后插入 CPU 的 auto_scale_0，
    // 显存帧喂不进去（Impossible to convert ... 'auto_scale_0'），整条压制失败
    expect(filter).not.toContain("hwupload");
    // 顺序：下载在前、CPU 滤镜居中
    const downloadIdx = filter.indexOf("hwdownload");
    const subtitlesIdx = filter.indexOf("subtitles=");
    const drawtextIdx = filter.indexOf("drawtext=");
    expect(downloadIdx).toBeGreaterThan(-1);
    expect(downloadIdx).toBeLessThan(subtitlesIdx);
    expect(subtitlesIdx).toBeLessThan(drawtextIdx);
  });

  it("CPU 滤镜链 + qsv 硬解：-hwaccel qsv，回内存跑滤镜后不再补 hwupload", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "hevc_qsv",
        bitrateControl: "ICQ",
        crf: 28,
        audioCodec: "copy",
        decode: true,
      },
    );
    const args = getArgs(command);
    expect(args.join(" ")).toContain("-hwaccel qsv");
    expect(args.join(" ")).toContain("-hwaccel_output_format qsv");
    const filter = getFilterValue(args);
    expect(filter).toContain("hwdownload");
    expect(filter).toContain("format=nv12");
    expect(filter).toContain("subtitles=");
    expect(filter).not.toContain("hwupload");
  });

  it("无滤镜纯转码 + 硬解：零拷贝，不生成滤镜链", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: undefined,
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "hevc_nvenc",
        bitrateControl: "CQ",
        crf: 28,
        audioCodec: "copy",
        decode: true,
      },
    );
    const args = getArgs(command);
    expect(args.join(" ")).toContain("-hwaccel cuda");
    expect(args.join(" ")).toContain("-hwaccel_output_format cuda");
    expect(args).not.toContain("-filter_complex");
  });

  it("未开启硬解 + CPU 滤镜：不注入 -hwaccel 与传输滤镜（回归）", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "hevc_nvenc",
        bitrateControl: "CQ",
        crf: 28,
        audioCodec: "copy",
        decode: false,
      },
    );
    const args = getArgs(command);
    expect(args.join(" ")).not.toContain("-hwaccel");
    const filter = getFilterValue(args);
    expect(filter).toContain("subtitles=");
    expect(filter).not.toContain("hwdownload");
    expect(filter).not.toContain("hwupload");
  });

  it("硬件缩放(before) + 弹幕 + 硬解：scale_cuda 直通，缩放后回内存直接交编码器", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "hevc_nvenc",
        bitrateControl: "CQ",
        crf: 28,
        audioCodec: "copy",
        decode: true,
        resetResolution: true,
        resolutionWidth: 1280,
        resolutionHeight: 720,
        scaleMethod: "before",
        swsFlags: "auto",
        hardwareScaleFilter: true,
      },
    );
    const args = getArgs(command);
    const filter = getFilterValue(args);
    // 首滤镜被改写为 scale_cuda（去掉 hwupload，解码帧已在显存）
    expect(filter.startsWith("[0:v]scale_cuda")).toBe(true);
    expect(filter).not.toContain("hwupload_cuda,scale_cuda");
    // 缩放后下载回内存跑 CPU 滤镜后直接输出内存帧，
    // 不再回传显存（否则源中途变分辨率时滤镜图重建会失败）
    expect(filter).not.toContain("hwupload");
    const scaleIdx = filter.indexOf("scale_cuda");
    const downloadIdx = filter.indexOf("hwdownload");
    const subtitlesIdx = filter.indexOf("subtitles=");
    expect(scaleIdx).toBeLessThan(downloadIdx);
    expect(downloadIdx).toBeLessThan(subtitlesIdx);
  });

  it("显式指定字体文件：subtitles 注入 force_style(fontName)+fontsdir，drawtext 注入 fontfile", async () => {
    // 空字体文件：family 解析失败回退默认压制字体名
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "hevc_nvenc",
        bitrateControl: "CQ",
        crf: 28,
        audioCodec: "copy",
        decode: true,
        addTimestamp: true,
        fontFile: fontTmpFile,
      },
      { startTimestamp: 1790817300 },
    );
    const filter = getFilterValue(getArgs(command));
    expect(filter).toContain(`FontName=${burnFontFamily}`);
    expect(filter).toContain("fontsdir=");
    // escaped() 双反斜杠转义 + 不加引号（与字幕路径约定一致）
    const escapedFont = fontTmpFile.replaceAll("\\", "/").replaceAll(":", "\\\\:");
    expect(filter).toContain(`fontfile=${escapedFont}`);
    // 用户显式指定的字幕字体名应排在强制字体之后（后者覆盖前者）
  });

  it("自定义字体文件：FontName 从字体文件内部 family 自动解析", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "libx264",
        bitrateControl: "CRF",
        crf: 23,
        audioCodec: "copy",
        fontFile: customFontFile,
      },
    );
    const filter = getFilterValue(getArgs(command));
    expect(filter).toContain("FontName=My Custom Font");
    expect(filter).toContain("fontsdir=");
  });

  it("readFontFamily：解析 sfnt name 表的 family 名，非法字体返回 undefined", () => {
    expect(readFontFamily(customFontFile)).toBe("My Custom Font");
    expect(readFontFamily(fontTmpFile)).toBeUndefined();
  });

  it("配置的字体文件不存在：跳过字体注入", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "libx264",
        bitrateControl: "CRF",
        crf: 23,
        audioCodec: "copy",
        fontFile: path.join(os.tmpdir(), "blt-font-test", "missing.otf"),
      },
    );
    const filter = getFilterValue(getArgs(command));
    expect(filter).toContain("subtitles=");
    expect(filter).not.toContain("fontsdir=");
    expect(filter).not.toContain("force_style=");
  });

  it("未配置字体文件：不注入字体，按 ass 样式名走系统字体（回归）", async () => {
    const command = await genMergeAssMp4Command(
      {
        videoFilePath: "input.mp4",
        assFilePath: "danmu.ass",
        outputPath: "output.mp4",
        hotProgressFilePath: undefined,
      },
      {
        encoder: "libx264",
        bitrateControl: "CRF",
        crf: 23,
        audioCodec: "copy",
      },
    );
    const filter = getFilterValue(getArgs(command));
    expect(filter).toContain("subtitles=");
    expect(filter).not.toContain("fontsdir=");
    expect(filter).not.toContain("force_style=");
  });
});

describe("滤镜链尾不再补 hwupload（回归）", () => {
  // 直播录制中途改变分辨率（推流换档、断点续录拼接）时 ffmpeg 会重建滤镜图。
  // 若链尾挂着 hwupload_cuda/hwupload，ffmpeg 会在「GPU 上传之后」插入仅支持内存帧的
  // auto_scale_0 做格式/尺寸协商，导致：
  //   Impossible to convert between the formats supported by the filter 'Parsed_hwupload_cuda_4' and the filter 'auto_scale_0'
  // 因此 CPU 滤镜跑完后直接输出内存帧，由硬件编码器内部接管上传
  const cases = [
    { name: "nvenc", encoder: "hevc_nvenc", bitrateControl: "CQ" },
    { name: "qsv", encoder: "hevc_qsv", bitrateControl: "ICQ" },
  ] as const;

  for (const c of cases) {
    it(`CPU 滤镜链 + ${c.name} 硬解：链尾输出内存帧，不带 hwupload`, async () => {
      const command = await genMergeAssMp4Command(
        {
          videoFilePath: "input.mp4",
          assFilePath: "danmu.ass",
          outputPath: "output.mp4",
          hotProgressFilePath: undefined,
        },
        {
          encoder: c.encoder,
          bitrateControl: c.bitrateControl,
          crf: 28,
          audioCodec: "copy",
          decode: true,
        },
      );
      const filter = getFilterValue(getArgs(command));
      // 硬件解码保留，仍走 hwdownload + format 回内存
      expect(filter).toContain("hwdownload");
      expect(filter).toContain("format=nv12");
      expect(filter).toContain("subtitles=");
      // 关键：链尾不再有任何回传显存的滤镜
      expect(filter).not.toContain("hwupload");
      // 最后一个滤镜是 CPU 滤镜，输出流标签直接交给编码器
      const lastFilter = filter.split(";").filter(Boolean).at(-1) ?? "";
      expect(lastFilter).toContain("subtitles=");
    });
  }
});
