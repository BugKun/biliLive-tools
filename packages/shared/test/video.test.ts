import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { genFfmpegParams } from "../src/utils/index";
import { appConfig } from "../src/config.js";
import {
  genMergeAssMp4Command,
  selectScaleMethod,
  ComplexFilter,
  isVoiceRoomResolution,
  resolveVoiceRoomResolution,
  selectHwDownloadFormat,
  VOICE_ROOM_VIDEO_WIDTH,
  VOICE_ROOM_VIDEO_HEIGHT,
  VOICE_ROOM_TARGET_WIDTH,
  VOICE_ROOM_TARGET_HEIGHT,
} from "../src/task/video";
import type { FfmpegOptions, VideoCodec } from "@biliLive-tools/types";

// ffprobe 探测桩：默认返回普通分辨率，语音直播间用例内部改成 256x256
const probe = vi.hoisted(() => ({
  // csv 输出：width,height,pix_fmt
  stream: "1920,1080,yuv420p",
  fail: false,
  // 默认当作文件不存在，避免与分辨率无关的老用例走一次无意义的探测
  exists: false,
}));

vi.mock("../src/utils/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/index.js")>();
  return {
    ...actual,
    pathExists: async () => probe.exists,
    executeCommand: async (command: string) => {
      if (String(command).includes("-show_entries stream=width,height,pix_fmt")) {
        if (probe.fail) throw new Error("ffprobe failed");
        return { stdout: probe.stream, stderr: "" };
      }
      return actual.executeCommand(command);
    },
  };
});

// fluent-ffmpeg 命令对象：取 -filter_complex 的滤镜链
const getFilterValue = (args: string[]): string => {
  const index = args.indexOf("-filter_complex");
  return index === -1 ? "" : (args[index + 1] ?? "");
};

describe.concurrent("通用ffmpeg参数生成", () => {
  it("视频编码器：h264_nvenc", () => {
    const input: FfmpegOptions = {
      encoder: "h264_nvenc",
      bitrateControl: "CQ",
      crf: 34,
      preset: "p4",
      audioCodec: "copy",
      bitrate: 8000,
      decode: true,
      extraOptions: "",
      bit10: false,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v h264_nvenc", "-rc vbr", "-cq 34", "-preset p4", "-c:a copy"]);
  });
  it("preset参数：未过滤", () => {
    const videoEncoders: VideoCodec[] = ["h264_nvenc"];
    for (const encoder of videoEncoders) {
      const input: FfmpegOptions = {
        encoder: encoder,
        bitrateControl: "CQ",
        crf: 34,
        preset: "p4",
        audioCodec: "copy",
        bitrate: 8000,
        decode: true,
        extraOptions: "",
        bit10: false,
        resetResolution: false,
        resolutionWidth: 3840,
        resolutionHeight: 2160,
      };
      const output = genFfmpegParams(input);
      const result = [`-c:v ${encoder}`, "-rc vbr", "-cq 34"];
      result.push("-preset p4");
      result.push("-c:a copy");
      expect(output).toEqual(result);
    }
  });

  it("preset参数：过滤非该编码器", () => {
    const videoEncoders: VideoCodec[] = ["libx264"];
    for (const encoder of videoEncoders) {
      const input: FfmpegOptions = {
        encoder: encoder,
        bitrateControl: "CQ",
        crf: 34,
        preset: "p4",
        audioCodec: "copy",
        bitrate: 8000,
        decode: true,
        extraOptions: "",
        bit10: false,
        resetResolution: false,
        resolutionWidth: 3840,
        resolutionHeight: 2160,
      };
      const output = genFfmpegParams(input);
      const result = [`-c:v ${encoder}`, "-rc vbr", "-cq 34"];
      result.push("-c:a copy");
      expect(output).toEqual(result);
    }
  });
  it("额外参数", () => {
    const input: FfmpegOptions = {
      encoder: "h264_nvenc",
      bitrateControl: "CQ",
      crf: 34,
      preset: "p4",
      audioCodec: "copy",
      bitrate: 8000,
      decode: true,
      extraOptions: "-extra 00:00:00",
      bit10: false,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual([
      "-c:v h264_nvenc",
      "-rc vbr",
      "-cq 34",
      "-preset p4",
      "-c:a copy",
      "-extra",
      "00:00:00",
    ]);
  });
  it("视频和音频编码器都是copy", () => {
    const input: FfmpegOptions = {
      encoder: "copy",
      bitrateControl: "CRF",
      crf: 28,
      preset: "p4",
      audioCodec: "copy",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: false,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v copy", "-c:a copy"]);
  });
  it("音频编码器是flac", () => {
    const input: FfmpegOptions = {
      encoder: "copy",
      bitrateControl: "CRF",
      crf: 28,
      preset: "p4",
      audioCodec: "flac",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: false,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v copy", "-c:a flac"]);
  });
  it("视频编码器是libsvtav1且使用10bit", () => {
    const input: FfmpegOptions = {
      encoder: "libsvtav1",
      bitrateControl: "CRF",
      crf: 28,
      audioCodec: "flac",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: true,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v libsvtav1", "-crf 28", "-pix_fmt yuv420p10le", "-c:a flac"]);
  });
  it("视频编码器是libsvtav1且是CRF模式", () => {
    const input: FfmpegOptions = {
      encoder: "libsvtav1",
      bitrateControl: "CRF",
      crf: 28,
      audioCodec: "flac",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: true,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v libsvtav1", "-crf 28", "-pix_fmt yuv420p10le", "-c:a flac"]);
  });
  it("视频编码器是libsvtav1且是VBR模式", () => {
    const input: FfmpegOptions = {
      encoder: "libsvtav1",
      bitrateControl: "VBR",
      crf: 28,
      audioCodec: "flac",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: true,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v libsvtav1", "-b:v 8000k", "-pix_fmt yuv420p10le", "-c:a flac"]);
  });
  it("视频编码器是h264_nvenc且是CQ模式", () => {
    const input: FfmpegOptions = {
      encoder: "h264_nvenc",
      bitrateControl: "CQ",
      crf: 28,
      preset: "p4",
      audioCodec: "flac",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: true,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v h264_nvenc", "-rc vbr", "-cq 28", "-preset p4", "-c:a flac"]);
  });
  it("视频编码器是h264_qsv且是ICQ模式", () => {
    const input: FfmpegOptions = {
      encoder: "h264_qsv",
      bitrateControl: "ICQ",
      crf: 28,
      audioCodec: "flac",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: true,
      resetResolution: false,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v h264_qsv", "-global_quality 28", "-c:a flac"]);
  });
  it("设置分辨率", () => {
    const input: FfmpegOptions = {
      encoder: "h264_qsv",
      bitrateControl: "ICQ",
      crf: 28,
      audioCodec: "flac",
      bitrate: 8000,
      decode: false,
      extraOptions: "",
      bit10: true,
      resetResolution: true,
      resolutionWidth: 3840,
      resolutionHeight: 2160,
    };
    const output1 = genFfmpegParams(input);
    expect(output1).toEqual(["-c:v h264_qsv", "-global_quality 28", "-c:a flac"]);
  });
});

describe.concurrent("genMergeAssMp4Command", () => {
  it("高能进度条+弹幕", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: "/path/to/hotprogress.txt",
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-i",
      "/path/to/hotprogress.txt",
      "-y",
      "-filter_complex",
      "[0:v]subtitles=/path/to/subtitle.ass[0:video];[1]colorkey=black:0.1:0.1[1:video];[0:video][1:video]overlay=W-w-0:H-h-0[2:video]",
      "-map",
      "[2:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("弹幕+无高能弹幕", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]subtitles=/path/to/subtitle.ass[0:video]",
      "-map",
      "[0:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("无弹幕+无高能弹幕", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: undefined,
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("弹幕+无高能弹幕+有切割参数", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      ss: "00:00:00",
      to: "00:00:10",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-ss",
      "00:00:00",
      "-copyts",
      "-to",
      "00:00:10",
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]subtitles=/path/to/subtitle.ass[0:video]",
      "-map",
      "[0:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-ss",
      "00:00:00",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("nvenc硬件解码：无滤镜", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: undefined,
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "h264_nvenc",
      audioCodec: "copy",
      decode: true,
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-hwaccel",
      "cuda",
      "-hwaccel_output_format",
      "cuda",
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-c:v",
      ffmpegOptions.encoder,
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("qsv硬件解码：无滤镜", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: undefined,
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "h264_qsv",
      audioCodec: "copy",
      decode: true,
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    // 显式链路改造：qsv 硬解改为真正的 -hwaccel qsv（原 init_hw_device 写法并不会启用解码）
    expect(args).toEqual([
      "-hwaccel",
      "qsv",
      "-hwaccel_output_format",
      "qsv",
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-c:v",
      "h264_qsv",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("弹幕+先缩放", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: true,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      scaleMethod: "before",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]scale=1920:1080[0:video];[0:video]subtitles=/path/to/subtitle.ass[1:video]",
      "-map",
      "[1:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("弹幕+后缩放", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: true,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      scaleMethod: "after",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]subtitles=/path/to/subtitle.ass[0:video];[0:video]scale=1920:1080[1:video]",
      "-map",
      "[1:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("弹幕+时间戳", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      addTimestamp: true,
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions, {
      startTimestamp: 1633831810,
    });
    const args = command._getArguments();
    console.log(args);
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]subtitles=/path/to/subtitle.ass[0:video];[0:video]drawtext=text='%{pts\\:localtime\\:1633831810\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}':fontcolor=white:fontsize=24:x=10:y=10[1:video]",
      "-map",
      "[1:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("无弹幕+帧率", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: undefined,
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      fps: 60,
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]fps=60[0:video]",
      "-map",
      "[0:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("弹幕+时间戳+帧率", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      addTimestamp: true,
      fps: 60,
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions, {
      startTimestamp: 1633831810,
    });
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]fps=60[0:video];[0:video]subtitles=/path/to/subtitle.ass[1:video];[1:video]drawtext=text='%{pts\\:localtime\\:1633831810\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}':fontcolor=white:fontsize=24:x=10:y=10[2:video]",
      "-map",
      "[2:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("无弹幕+缩放", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: undefined,
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: true,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      scaleMethod: "after",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]scale=1920:1080[0:video]",
      "-map",
      "[0:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("弹幕+自定义视频滤镜", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: false,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      scaleMethod: "after",
      vf: "hflip;$origin;transpose=1",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]hflip[0:video];[0:video]subtitles=/path/to/subtitle.ass[1:video];[1:video]transpose=1[2:video]",
      "-map",
      "[2:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  it("自定义视频滤镜包含$origin时保留帧率", async () => {
    const files = {
      videoFilePath: "/path/to/video.mp4",
      assFilePath: "/path/to/subtitle.ass",
      outputPath: "/path/to/output.mp4",
      hotProgressFilePath: undefined,
    };

    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      fps: 60,
      vf: "hflip;$origin;transpose=1",
    };

    const command = await genMergeAssMp4Command(files, ffmpegOptions);
    const args = command._getArguments();
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      "[0:v]hflip[0:video];[0:video]fps=60[1:video];[1:video]subtitles=/path/to/subtitle.ass[2:video];[2:video]transpose=1[3:video]",
      "-map",
      "[3:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
  });
  describe("硬件scale过滤器", () => {
    describe("nvidia", () => {
      it("只有scale过滤器", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: undefined,
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_nvenc",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();
        expect(args).toEqual([
          "-hwaccel",
          "cuda",
          "-hwaccel_output_format",
          "cuda",
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          "[0:v]scale_cuda=1080:1920[0:video]",
          "-map",
          "[0:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_nvenc",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
      it("先缩放后渲染", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: "subtitle.ass",
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_nvenc",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
          scaleMethod: "before",
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();
        // 显式链路改造：before 模式硬件缩放解锁，显存内缩放后回内存跑弹幕，链尾传回显存
        expect(args).toEqual([
          "-hwaccel",
          "cuda",
          "-hwaccel_output_format",
          "cuda",
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          // 链尾不再补 hwupload：源中途变分辨率时，GPU 上传之后插入的 auto_scale 无法处理显存帧
          "[0:v]scale_cuda=1080:1920[0:video];[0:video]hwdownload[2:video];[2:video]format=nv12[3:video];[3:video]subtitles=subtitle.ass[1:video]",
          "-map",
          "[1:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_nvenc",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
      it("先渲染后缩放", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: "subtitle.ass",
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_nvenc",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
          scaleMethod: "after",
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();
        // 显式链路改造：硬解开启后不再因滤镜移除，弹幕前补 hwdownload，链尾显存内缩放直通编码器
        expect(args).toEqual([
          "-hwaccel",
          "cuda",
          "-hwaccel_output_format",
          "cuda",
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          "[0:v]hwdownload[2:video];[2:video]format=nv12[3:video];[3:video]subtitles=subtitle.ass[0:video];[0:video]hwupload_cuda,scale_cuda=1080:1920[1:video]",
          "-map",
          "[1:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_nvenc",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
    });
    describe("qsv", () => {
      it("只有scale过滤器", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: undefined,
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_qsv",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();
        // 显式链路改造：decode 开启时 QSV 解码帧已在显存，去掉链首 hwupload，零拷贝直通
        expect(args).toEqual([
          "-hwaccel",
          "qsv",
          "-hwaccel_output_format",
          "qsv",
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          "[0:v]scale_qsv=1080:1920[0:video]",
          "-map",
          "[0:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_qsv",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
      it("先缩放后渲染", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: "subtitle.ass",
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_qsv",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
          scaleMethod: "before",
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();

        // 显式链路改造：before 模式硬件缩放解锁，scale_qsv 在显存内完成，回内存跑弹幕后直接交编码器
        expect(args).toEqual([
          "-hwaccel",
          "qsv",
          "-hwaccel_output_format",
          "qsv",
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          // 链尾不再补 hwupload：源中途变分辨率时，GPU 上传之后插入的 auto_scale 无法处理显存帧
          "[0:v]scale_qsv=1080:1920[0:video];[0:video]hwdownload[2:video];[2:video]format=nv12[3:video];[3:video]subtitles=subtitle.ass[1:video]",
          "-map",
          "[1:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_qsv",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
      it("先渲染后缩放", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: "subtitle.ass",
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_qsv",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
          scaleMethod: "after",
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();
        // 显式链路改造：硬解开启后不再因滤镜移除，弹幕前补 hwdownload，链尾显存内缩放直通编码器
        expect(args).toEqual([
          "-hwaccel",
          "qsv",
          "-hwaccel_output_format",
          "qsv",
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          "[0:v]hwdownload[2:video];[2:video]format=nv12[3:video];[3:video]subtitles=subtitle.ass[0:video];[0:video]hwupload,scale_qsv=1080:1920[1:video]",
          "-map",
          "[1:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_qsv",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
    });
    describe("amd", () => {
      it("只有scale过滤器", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: undefined,
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_amf",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();

        expect(args).toEqual([
          // "-hwaccel",
          // "amf",
          // "-init_hw_device",
          // "amf=amf",
          // "-filter_hw_device",
          // "amf",
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          "[0:v]scale=1080:1920[0:video]",
          "-map",
          "[0:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_amf",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
      it("先缩放后渲染", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: "subtitle.ass",
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_amf",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
          scaleMethod: "before",
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();

        expect(args).toEqual([
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          "[0:v]scale=1080:1920[0:video];[0:video]subtitles=subtitle.ass[1:video]",
          "-map",
          "[1:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_amf",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
      it("先渲染后缩放", async () => {
        const files = {
          videoFilePath: "/path/to/video.mp4",
          assFilePath: "subtitle.ass",
          outputPath: "/path/to/output.mp4",
          hotProgressFilePath: undefined,
        };

        const ffmpegOptions: FfmpegOptions = {
          encoder: "h264_amf",
          audioCodec: "copy",
          decode: true,
          resolutionHeight: 1920,
          resolutionWidth: 1080,
          resetResolution: true,
          hardwareScaleFilter: true,
          scaleMethod: "after",
        };

        const command = await genMergeAssMp4Command(files, ffmpegOptions);
        const args = command._getArguments();
        console.log(args);
        expect(args).toEqual([
          "-i",
          "/path/to/video.mp4",
          "-y",
          "-filter_complex",
          "[0:v]subtitles=subtitle.ass[0:video];[0:video]scale=1080:1920[1:video]",
          "-map",
          "[1:video]",
          "-map",
          "0:a",
          "-c:v",
          "h264_amf",
          "-c:a",
          "copy",
          "/path/to/output.mp4",
        ]);
      });
    });
  });
});

describe.concurrent("selectScaleMethod", () => {
  it("should return 'none' if resetResolution is false", () => {
    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: false,
    };
    const result = selectScaleMethod(ffmpegOptions);
    expect(result).toBe("none");
  });

  it("should return 'none' if resetResolution is true but resolutionWidth and resolutionHeight are not set", () => {
    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: true,
    };
    const result = selectScaleMethod(ffmpegOptions);
    expect(result).toBe("none");
  });

  it("should return 'auto' if resetResolution is true and resolutionWidth and resolutionHeight are set but scaleMethod is not set", () => {
    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: true,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
    };
    const result = selectScaleMethod(ffmpegOptions);
    expect(result).toBe("auto");
  });

  it("should return the value of scaleMethod if resetResolution is true and resolutionWidth and resolutionHeight are set", () => {
    const ffmpegOptions: FfmpegOptions = {
      encoder: "libx264",
      audioCodec: "copy",
      resetResolution: true,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      scaleMethod: "before",
    };
    const result = selectScaleMethod(ffmpegOptions);
    expect(result).toBe("before");
  });
});

describe.concurrent("ComplexFilter", () => {
  it("should initialize with default input stream", () => {
    const filter = new ComplexFilter();
    expect(filter.getLatestOutputStream()).toBe("0:v");
  });

  it("should add a filter and update the latest output stream", () => {
    const filter = new ComplexFilter();
    const outputStream = filter.addFilter("scale", "1920:1080");
    expect(outputStream).toBe("0:video");
    expect(filter.getLatestOutputStream()).toBe("0:video");
    expect(filter.getFilters()).toEqual([
      {
        filter: "scale",
        options: "1920:1080",
        inputs: ["0:v"],
        outputs: "0:video",
      },
    ]);
  });

  it("should add a scale filter", () => {
    const filter = new ComplexFilter();
    const outputStream = filter.addScaleFilter({
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      swsFlags: "bicubic",
      encoder: "libx264",
      useHardware: false,
    });
    expect(outputStream).toBe("0:video");
    expect(filter.getLatestOutputStream()).toBe("0:video");
    expect(filter.getFilters()).toEqual([
      {
        filter: "scale",
        options: "1920:1080:flags=bicubic",
        inputs: ["0:v"],
        outputs: "0:video",
      },
    ]);
  });

  it("should add a cuda scale filter", () => {
    const filter = new ComplexFilter();
    const outputStream = filter.addScaleFilter({
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      swsFlags: "bicubic",
      encoder: "h264_nvenc",
      useHardware: true,
    });
    expect(outputStream).toBe("0:video");
    expect(filter.getLatestOutputStream()).toBe("0:video");
    console.log(filter.getFilters());
    expect(filter.getFilters()).toEqual([
      {
        filter: "hwupload_cuda,scale_cuda",
        options: "1920:1080:interp_algo=bicubic:passthrough=1",
        inputs: ["0:v"],
        outputs: "0:video",
      },
    ]);
  });

  it("should add a subtitle filter", () => {
    const filter = new ComplexFilter();
    const outputStream = filter.addSubtitleFilter("/path/to/subtitle.ass");
    expect(outputStream).toBe("0:video");
    expect(filter.getLatestOutputStream()).toBe("0:video");
    expect(filter.getFilters()).toEqual([
      {
        filter: "subtitles",
        options: "/path/to/subtitle.ass",
        inputs: ["0:v"],
        outputs: "0:video",
      },
    ]);
  });

  it("should add a colorkey filter", () => {
    const filter = new ComplexFilter();
    const outputStream = filter.addColorkeyFilter();
    expect(outputStream).toBe("0:video");
    expect(filter.getLatestOutputStream()).toBe("0:video");
    expect(filter.getFilters()).toEqual([
      {
        filter: "colorkey",
        options: "black:0.1:0.1",
        inputs: ["0:v"],
        outputs: "0:video",
      },
    ]);
  });

  it("should add an overlay filter", () => {
    const filter = new ComplexFilter();
    const outputStream = filter.addOverlayFilter(["0:v", "1:v"]);
    expect(outputStream).toBe("0:video");
    expect(filter.getLatestOutputStream()).toBe("0:video");
    expect(filter.getFilters()).toEqual([
      {
        filter: "overlay",
        options: "W-w-0:H-h-0",
        inputs: ["0:v", "1:v"],
        outputs: "0:video",
      },
    ]);
  });

  it("should add a drawtext filter", () => {
    const filter = new ComplexFilter();
    const outputStream = filter.addDrawtextFilter({
      startTimestamp: 1633831810,
      fontColor: "white",
      fontSize: 24,
      x: 10,
      y: 10,
    });
    expect(outputStream).toBe("0:video");
    expect(filter.getLatestOutputStream()).toBe("0:video");
    expect(filter.getFilters()).toEqual([
      {
        filter: "drawtext",
        options:
          "text='%{pts\\:localtime\\:1633831810\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}':fontcolor=white:fontsize=24:x=10:y=10",
        inputs: ["0:v"],
        outputs: "0:video",
      },
    ]);
  });
});

describe("语音直播间分辨率判定", () => {
  it("封面尺寸判定为语音直播间", () => {
    expect(isVoiceRoomResolution(VOICE_ROOM_VIDEO_WIDTH, VOICE_ROOM_VIDEO_HEIGHT)).toBe(true);
    expect(isVoiceRoomResolution(256, 256)).toBe(true);
  });
  it("其余尺寸均不判定为语音直播间", () => {
    expect(isVoiceRoomResolution(1920, 1080)).toBe(false);
    expect(isVoiceRoomResolution(256, 144)).toBe(false);
    expect(isVoiceRoomResolution(1440, 256)).toBe(false);
    expect(isVoiceRoomResolution(undefined, undefined)).toBe(false);
  });
  it("语音直播间：放大到目标分辨率", () => {
    expect(resolveVoiceRoomResolution(256, 256)).toEqual({
      raw: "256x256",
      isVoiceRoom: true,
      width: VOICE_ROOM_TARGET_WIDTH,
      height: VOICE_ROOM_TARGET_HEIGHT,
      resolution: `${VOICE_ROOM_TARGET_WIDTH}x${VOICE_ROOM_TARGET_HEIGHT}`,
    });
  });
  it("普通视频：保持原始分辨率", () => {
    expect(resolveVoiceRoomResolution(1920, 1080)).toEqual({
      raw: "1920x1080",
      isVoiceRoom: false,
      width: 1920,
      height: 1080,
      resolution: "1920x1080",
    });
  });
});

// 共享 ffprobe 桩状态，不能并发执行
describe("genMergeAssMp4Command 语音直播间自动分辨率", () => {
  const files = {
    videoFilePath: "/path/to/video.mp4",
    assFilePath: "/path/to/subtitle.ass",
    outputPath: "/path/to/output.mp4",
    hotProgressFilePath: undefined,
  };

  beforeEach(() => {
    probe.stream = "256,256,yuv420p";
    probe.fail = false;
    probe.exists = true;
    // getBinPath 依赖容器，测试环境未初始化，这里只让它能拿到 ffprobe 路径
    vi.spyOn(appConfig, "getAll").mockReturnValue({
      customExecPath: true,
      ffprobePath: "ffprobe",
    } as any);
  });
  afterEach(() => {
    probe.stream = "1920,1080,yuv420p";
    probe.exists = false;
    vi.restoreAllMocks();
  });

  it("语音直播间：叠字幕前插入放大滤镜", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy" },
    );
    const args = command._getArguments();
    const scale = `scale=${VOICE_ROOM_TARGET_WIDTH}:${VOICE_ROOM_TARGET_HEIGHT}`;
    expect(args).toEqual([
      "-i",
      "/path/to/video.mp4",
      "-y",
      "-filter_complex",
      `[0:v]${scale}[0:video];[0:video]subtitles=/path/to/subtitle.ass[1:video]`,
      "-map",
      "[1:video]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "/path/to/output.mp4",
    ]);
    // 必须先放大再叠字幕，字幕按放大后的分辨率渲染
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter.indexOf(scale)).toBeLessThan(filter.indexOf("subtitles="));
  });

  it("手动转码（无弹幕无字幕）：不介入，与 webhook 未开启弹幕压制一致", async () => {
    // 对应 转码页面不选弹幕文件 → taskApi.transcode → 纯转码
    const command = await genMergeAssMp4Command(
      { ...files, assFilePath: undefined },
      { encoder: "libx264", audioCodec: "copy" },
    );
    const args = command._getArguments();
    expect(args).not.toContain("-filter_complex");
  });

  it("视频剪辑带字幕（cut 的 subtitlePath）：不属于弹幕压制，不放大", async () => {
    const command = await genMergeAssMp4Command(
      { ...files, assFilePath: undefined, subtitlePath: "/path/to/sub.srt" },
      { encoder: "libx264", audioCodec: "copy" },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).not.toContain("scale=");
    expect(filter).toContain("subtitles=");
  });

  it("普通分辨率：不插入放大滤镜", async () => {
    probe.stream = "1920,1080,yuv420p";
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy" },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toBe("[0:v]subtitles=/path/to/subtitle.ass[0:video]");
  });

  it("用户已显式配置分辨率时以用户配置为准", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "libx264",
        audioCodec: "copy",
        resetResolution: true,
        resolutionWidth: 1920,
        resolutionHeight: 1080,
        scaleMethod: "before",
      },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toBe(
      "[0:v]scale=1920:1080[0:video];[0:video]subtitles=/path/to/subtitle.ass[1:video]",
    );
    expect(filter).not.toContain(`scale=${VOICE_ROOM_TARGET_WIDTH}:${VOICE_ROOM_TARGET_HEIGHT}`);
  });

  it("仅开启 resetResolution 但未填宽高时，不影响放大判定", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy", resetResolution: true },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain(`scale=${VOICE_ROOM_TARGET_WIDTH}:${VOICE_ROOM_TARGET_HEIGHT}`);
  });

  it("流复制：不注入滤镜，避免强制重编码", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "copy", audioCodec: "copy" },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toBe("[0:v]subtitles=/path/to/subtitle.ass[0:video]");
  });

  it("ffprobe 探测失败：降级为原始分辨率压制", async () => {
    probe.fail = true;
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy" },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toBe("[0:v]subtitles=/path/to/subtitle.ass[0:video]");
  });

  it("视频文件不存在：跳过探测，按原始分辨率压制", async () => {
    probe.exists = false;
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy" },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toBe("[0:v]subtitles=/path/to/subtitle.ass[0:video]");
  });

  it("透传宽高优先于 ffprobe：burn 链路复用 readVideoMeta 结果", async () => {
    // ffprobe 桩说这是普通视频，但透传说 256x256 → 应放大，证明走的是透传值
    probe.stream = "1920,1080,yuv420p";
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy" },
      { videoWidth: 256, videoHeight: 256 },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain(`scale=${VOICE_ROOM_TARGET_WIDTH}:${VOICE_ROOM_TARGET_HEIGHT}`);
  });

  it("透传普通宽高：不放大（即使 ffprobe 说是 256x256）", async () => {
    probe.stream = "256,256,yuv420p";
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy" },
      { videoWidth: 1920, videoHeight: 1080 },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).not.toContain("scale=");
  });

  it("硬件缩放链路：nvenc 下放大走 scale_cuda 并在之后回内存叠字幕", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "hevc_nvenc",
        audioCodec: "copy",
        decode: true,
        hardwareScaleFilter: true,
        swsFlags: "auto",
      },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter.startsWith(`[0:v]scale_cuda=${VOICE_ROOM_TARGET_WIDTH}`)).toBe(true);
    expect(filter).not.toContain("hwupload_cuda,scale_cuda");
    const downloadIdx = filter.indexOf("hwdownload");
    const subtitlesIdx = filter.indexOf("subtitles=");
    expect(downloadIdx).toBeGreaterThan(-1);
    expect(downloadIdx).toBeLessThan(subtitlesIdx);
  });

  it("高能进度条+硬件解码：输入选项必须挂在主视频上，而不是进度条上", async () => {
    // 回归：fluent-ffmpeg 的 inputOptions 只作用于「最后注册的输入」。
    // 之前进度条先注册，导致 -hwaccel/-ss 全落到进度条输入：主视频软解却被 prepend 了
    // hwdownload（auto_scale_0 转换失败），进度条反被硬解成显存帧喂给 colorkey
    const command = await genMergeAssMp4Command(
      { ...files, hotProgressFilePath: "/path/to/hotprogress.mp4" },
      {
        encoder: "hevc_nvenc",
        audioCodec: "copy",
        decode: true,
        ss: "100",
      },
    );
    const args = command._getArguments();
    const videoIdx = args.indexOf("/path/to/video.mp4");
    const hotIdx = args.indexOf("/path/to/hotprogress.mp4");
    const hwaccelIdx = args.indexOf("-hwaccel");
    const ssIdx = args.indexOf("-ss");

    expect(videoIdx).toBeGreaterThan(-1);
    expect(hotIdx).toBeGreaterThan(videoIdx);
    // 硬件解码参数在主视频 -i 之前
    expect(hwaccelIdx).toBeGreaterThan(-1);
    expect(hwaccelIdx).toBeLessThan(videoIdx);
    // 切片参数同样在主视频 -i 之前
    expect(ssIdx).toBeGreaterThan(-1);
    expect(ssIdx).toBeLessThan(videoIdx);

    const filter = getFilterValue(args);
    expect(filter).toContain(`scale=${VOICE_ROOM_TARGET_WIDTH}:${VOICE_ROOM_TARGET_HEIGHT}`);
    // hwdownload 作用于主视频输入；进度条仍走软解喂 CPU 的 colorkey
    expect(filter.startsWith("[0:v]hwdownload")).toBe(true);
    expect(filter).toContain("[1]colorkey=black:0.1:0.1");
  });

  it("关闭语音直播间自动放大开关：256x256 不再放大", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy", voiceRoomAutoScale: false },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).not.toContain("scale=");
    expect(filter).toContain("subtitles=");
  });

  it("未设置开关字段时默认开启（存量预设兼容）", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      { encoder: "libx264", audioCodec: "copy" },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain(`scale=${VOICE_ROOM_TARGET_WIDTH}:${VOICE_ROOM_TARGET_HEIGHT}`);
  });
});

describe("hwdownload 下载格式决策", () => {
  it("10bit 源像素格式返回 p010le", () => {
    expect(selectHwDownloadFormat("yuv420p10le")).toBe("p010le");
    expect(selectHwDownloadFormat("yuv420p10be")).toBe("p010le");
    expect(selectHwDownloadFormat("p010le")).toBe("p010le");
  });
  it("8bit 与未知像素格式返回 nv12", () => {
    expect(selectHwDownloadFormat("yuv420p")).toBe("nv12");
    expect(selectHwDownloadFormat("nv12")).toBe("nv12");
    expect(selectHwDownloadFormat(undefined)).toBe("nv12");
    expect(selectHwDownloadFormat("")).toBe("nv12");
    expect(selectHwDownloadFormat("some_unknown_fmt")).toBe("nv12");
  });
});

describe("genMergeAssMp4Command hwdownload 下载格式", () => {
  const files = {
    videoFilePath: "/path/to/video.mp4",
    assFilePath: "/path/to/subtitle.ass",
    outputPath: "/path/to/output.mp4",
    hotProgressFilePath: undefined,
  };

  beforeEach(() => {
    probe.stream = "1920,1080,yuv420p";
    probe.fail = false;
    probe.exists = true;
    vi.spyOn(appConfig, "getAll").mockReturnValue({
      customExecPath: true,
      ffprobePath: "ffprobe",
    } as any);
  });
  afterEach(() => {
    probe.stream = "1920,1080,yuv420p";
    probe.exists = false;
    vi.restoreAllMocks();
  });

  it("10bit 源 + nvenc 硬解 + CPU 滤镜：下载格式用 p010le", async () => {
    probe.stream = "1920,1080,yuv420p10le";
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "hevc_nvenc",
        audioCodec: "copy",
        decode: true,
      },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain("hwdownload");
    expect(filter).toContain("format=p010le");
    expect(filter).not.toContain("format=nv12");
  });

  it("8bit 源 + nvenc 硬解 + CPU 滤镜：下载格式维持 nv12（回归）", async () => {
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "hevc_nvenc",
        audioCodec: "copy",
        decode: true,
      },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain("format=nv12");
    expect(filter).not.toContain("format=p010le");
  });

  it("透传 videoPixFmt 优先于 ffprobe：透传 10bit 走 p010le", async () => {
    // ffprobe 桩说 8bit，透传说 10bit → 应 p010le，证明走的是透传值
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "hevc_nvenc",
        audioCodec: "copy",
        decode: true,
      },
      { videoWidth: 1920, videoHeight: 1080, videoPixFmt: "yuv420p10le" },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain("format=p010le");
  });

  it("探测失败：下载格式降级为 nv12（回归）", async () => {
    probe.fail = true;
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "hevc_nvenc",
        audioCodec: "copy",
        decode: true,
      },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain("format=nv12");
  });

  it("10bit 源 + qsv 硬解：下载格式用 p010le", async () => {
    probe.stream = "1920,1080,yuv420p10le";
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "hevc_qsv",
        audioCodec: "copy",
        decode: true,
      },
    );
    const filter = getFilterValue(command._getArguments());
    expect(filter).toContain("format=p010le");
  });

  it("10bit 源 + 硬件缩放链路（scale_cuda 首滤镜）：缩放后下载同样保位深", async () => {
    probe.stream = "1920,1080,yuv420p10le";
    const command = await genMergeAssMp4Command(
      { ...files },
      {
        encoder: "hevc_nvenc",
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
    const filter = getFilterValue(command._getArguments());
    expect(filter.startsWith("[0:v]scale_cuda")).toBe(true);
    expect(filter).toContain("format=p010le");
  });
});
