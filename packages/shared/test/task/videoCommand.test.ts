import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

import { genMergeAssMp4Command, burnFontFamily } from "../../src/task/video.js";

// fluent-ffmpeg 命令对象：取最终传给 ffmpeg 的参数
const getArgs = (command: unknown): string[] => (command as any)._getArguments();

const getFilterValue = (args: string[]): string => {
  const index = args.indexOf("-filter_complex");
  if (index === -1) return "";
  return args[index + 1] ?? "";
};

let fontTmpFile = "";

beforeAll(async () => {
  fontTmpFile = path.join(os.tmpdir(), "blt-font-test", "SourceHanSansSC-Normal.otf");
  await fs.ensureDir(path.dirname(fontTmpFile));
  await fs.writeFile(fontTmpFile, ""); // 命令构建只检查存在性，不需要真实字体内容
});

afterAll(async () => {
  await fs.remove(path.dirname(fontTmpFile));
});

describe("genMergeAssMp4Command 硬件解码显式链路", () => {
  it("CPU 滤镜链（弹幕+时间戳）+ nvenc 硬解：保留 -hwaccel 并自动补 hwdownload/hwupload", async () => {
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
    expect(filter).toContain("hwupload_cuda");
    // 顺序：下载在前、CPU 滤镜居中、上传在尾
    const downloadIdx = filter.indexOf("hwdownload");
    const subtitlesIdx = filter.indexOf("subtitles=");
    const drawtextIdx = filter.indexOf("drawtext=");
    const uploadIdx = filter.indexOf("hwupload_cuda");
    expect(downloadIdx).toBeGreaterThan(-1);
    expect(downloadIdx).toBeLessThan(subtitlesIdx);
    expect(subtitlesIdx).toBeLessThan(drawtextIdx);
    expect(drawtextIdx).toBeLessThan(uploadIdx);
  });

  it("CPU 滤镜链 + qsv 硬解：-hwaccel qsv + hwupload=extra_hw_frames=64", async () => {
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
    expect(filter).toContain("hwupload=extra_hw_frames=64");
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

  it("硬件缩放(before) + 弹幕 + 硬解：scale_cuda 直通，缩放后回内存、链尾回显存", async () => {
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
    // 缩放后下载回内存跑 CPU 滤镜，链尾回传显存
    const scaleIdx = filter.indexOf("scale_cuda");
    const downloadIdx = filter.indexOf("hwdownload");
    const subtitlesIdx = filter.indexOf("subtitles=");
    const uploadIdx = filter.indexOf("hwupload_cuda");
    expect(scaleIdx).toBeLessThan(downloadIdx);
    expect(downloadIdx).toBeLessThan(subtitlesIdx);
    expect(subtitlesIdx).toBeLessThan(uploadIdx);
  });

  it("指定字体文件：subtitles 注入 force_style(fontName)+fontsdir，drawtext 注入 fontfile", async () => {
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

  it("字体文件不存在（未显式指定）：不注入 fontsdir", async () => {
    // 不传 fontFile，且 getBinPath 依赖容器（测试环境未初始化），resolveBurnFontFile 应安全返回 undefined
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
